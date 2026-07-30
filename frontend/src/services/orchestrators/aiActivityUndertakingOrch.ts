import {
  applyTagsBlock,
  extendVocabularyBlock,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import {
  getUndertakingBlock,
  listSectionsBlock,
  listUndertakingsBlock,
  readTagVocabularyBlock,
  writeTagVocabularyBlock,
  writeUndertakingBlock,
} from '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
import {
  findChainBlock,
  listChainsBlock,
  patchChainBlock,
  type ChainEntry,
} from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'
import { recordAssignmentBlock } from '@/services/lego_blocks/integrations/aiActivityAssignmentBlock'
import {
  bucketDensityBlock,
  type DensityBucket,
  type DensityDay,
} from '@/services/lego_blocks/units/aiActivityDensityBlock'

/**
 * The index view: a head Anurag wrote, plus a tail derived on read.
 *
 * The split is the design. The head is judgment and is stored. The tail is
 * evidence and is computed from `ai-activity/chains/` every time, so it cannot
 * drift from the chains it claims to summarize.
 */

export interface UndertakingTail {
  chainCount: number
  /** Wall-clock across the assigned chains. */
  durationMs: number
  /** Active duration across the assigned chains — inter-message time with long
   *  pauses clamped. The honest "how much work" number; the sparkline uses this,
   *  not wall-clock. Falls back to wall-clock per chain for digests written
   *  before the field existed and not yet healed on read. */
  activeDurationMs: number
  /** Distinct calendar days worked — a truer measure of span than duration. */
  dayCount: number
  firstDate: string
  lastDate: string
  /** Union of the chains' file pointers. The index's page numbers. */
  files: string[]
  /** Per-day counts, oldest first — pre-bucketed for the sparkline. */
  density: Array<{ date: string; chains: number; durationMs: number; activeDurationMs: number }>
}

export interface UndertakingView {
  record: UndertakingRecord
  tail: UndertakingTail
}

/**
 * Duration is summed over *distinct sittings*, which is not the same thing as
 * distinct chain keys — and, importantly, not the same thing as distinct
 * session ids either.
 *
 * `PreCompact` and `SessionEnd` both fire on a single session, so one sitting
 * can get recorded twice; summing both inflates duration. But the `#w1` / `#w2`
 * suffix does *not* mark those duplicates. It comes from the parser splitting a
 * transcript at idle gaps, and those windows are genuine separate sittings —
 * across the vault, 106 window pairs sharing a session id are disjoint in time
 * (often days apart, with different titles and message counts) against 2 that
 * actually overlap. Collapsing on the pre-suffix key therefore threw away most
 * of a long-running session's history and kept only its longest sitting.
 *
 * So the test is temporal, not lexical: within one session id, merge windows
 * whose intervals overlap and keep the longest of each cluster; let disjoint
 * windows through. The density sparkline's entire job is to be honest about how
 * much work happened, in both directions.
 */
export function collapseChainWindowsBlock(chains: ChainEntry[]): ChainEntry[] {
  const bySession = new Map<string, ChainEntry[]>()
  for (const chain of chains) {
    const base = chain.chainKey.replace(/#w\d+$/, '')
    const bucket = bySession.get(base)
    if (bucket) bucket.push(chain)
    else bySession.set(base, [chain])
  }

  const kept: ChainEntry[] = []
  for (const bucket of bySession.values()) {
    bucket.sort((a, b) => a.startedIso.localeCompare(b.startedIso))
    // Interval sweep. `best` is the longest window in the cluster being built;
    // `clusterEnd` is the cluster's running high-water end, so A–B–C chains
    // into one sitting even when A and C don't touch.
    let best: ChainEntry | null = null
    let clusterEnd = ''
    for (const chain of bucket) {
      if (best && chain.startedIso < clusterEnd) {
        if (chain.durationMs > best.durationMs) best = chain
        if (chain.endedIso > clusterEnd) clusterEnd = chain.endedIso
        continue
      }
      if (best) kept.push(best)
      best = chain
      clusterEnd = chain.endedIso
    }
    if (best) kept.push(best)
  }

  return kept.sort((a, b) => a.startedIso.localeCompare(b.startedIso))
}

/** Active duration for one chain, falling back to wall-clock when the chain
 *  predates the field and hasn't been healed on read yet (0 ⇒ not measured). */
function activeOf(chain: ChainEntry): number {
  return chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs
}

function buildTail(chains: ChainEntry[]): UndertakingTail {
  const collapsed = collapseChainWindowsBlock(chains)
  const byDate = new Map<string, { chains: number; durationMs: number; activeDurationMs: number }>()
  const files = new Set<string>()
  let durationMs = 0
  let activeDurationMs = 0

  for (const chain of collapsed) {
    const active = activeOf(chain)
    durationMs += chain.durationMs
    activeDurationMs += active
    const bucket = byDate.get(chain.date) ?? { chains: 0, durationMs: 0, activeDurationMs: 0 }
    bucket.chains += 1
    bucket.durationMs += chain.durationMs
    bucket.activeDurationMs += active
    byDate.set(chain.date, bucket)
    for (const file of chain.filesWritten) files.add(file)
  }

  const dates = Array.from(byDate.keys()).sort()
  return {
    chainCount: collapsed.length,
    durationMs,
    activeDurationMs,
    dayCount: dates.length,
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    files: Array.from(files).sort(),
    density: dates.map(date => ({ date, ...byDate.get(date)! })),
  }
}

async function chainsFor(record: UndertakingRecord): Promise<ChainEntry[]> {
  const all = await listChainsBlock({ projectId: record.projectId })
  const wanted = new Set([...record.chains, ...record.alsoFedBy])
  return all.filter(
    chain => wanted.has(chain.chainKey) || chain.undertaking.includes(record.key),
  )
}

export async function listUndertakingsOrch(
  projectId: string,
  section?: string,
): Promise<UndertakingView[]> {
  const records = await listUndertakingsBlock(projectId)
  const filtered = section ? records.filter(record => record.section === section) : records
  // One chain read, reused across every record — the alternative is a full
  // vault walk per undertaking, which on F9 alone is 32 walks of the same tree.
  const all = await listChainsBlock({ projectId })
  return filtered.map(record => {
    const wanted = new Set([...record.chains, ...record.alsoFedBy])
    const mine = all.filter(
      chain => wanted.has(chain.chainKey) || chain.undertaking.includes(record.key),
    )
    return { record, tail: buildTail(mine) }
  })
}

export async function getUndertakingOrch(
  projectId: string,
  key: string,
): Promise<UndertakingView | null> {
  const record = await getUndertakingBlock(projectId, key)
  if (!record) return null
  return { record, tail: buildTail(await chainsFor(record)) }
}

// ── The index view ───────────────────────────────────────────────────────

export interface UndertakingIndexRow {
  record: UndertakingRecord
  tail: UndertakingTail
  /** Density bucketed over the window shared by the whole index, so a column of
   *  strips is comparable — a flat zero-count strip reads as "written down,
   *  never worked on" against its neighbours. */
  buckets: DensityBucket[]
}

export interface UndertakingIndexSection {
  key: string
  title: string
  rows: UndertakingIndexRow[]
}

export interface UndertakingIndex {
  sections: UndertakingIndexSection[]
  /** The shared window every strip is bucketed over (`YYYY-MM-DD`), or '' when
   *  there is no dated activity anywhere in the index. */
  windowStart: string
  windowEnd: string
}

const INDEX_SPARKLINE_BUCKETS = 24
/** Group key for undertakings whose section isn't among the project's sections
 *  (hand-edited parent, or sections dir absent). Rendered last. */
const UNFILED_SECTION_KEY = '__unfiled__'

/**
 * The whole index for a project, grouped by section, each entry carrying a
 * sparkline bucketed over one shared window so strips are comparable.
 *
 * This is what the Thinking Organizer index view renders. Kept in the orch (not
 * the UI) so the CLI and the tab derive identical data — the parity rule.
 */
export async function getUndertakingIndexOrch(
  projectId: string,
  options?: { buckets?: number },
): Promise<UndertakingIndex> {
  const [views, sections] = await Promise.all([
    listUndertakingsOrch(projectId),
    listSectionsBlock(projectId),
  ])

  // Shared window across every dated entry, so all strips align.
  let windowStart = ''
  let windowEnd = ''
  for (const view of views) {
    if (view.tail.firstDate && (!windowStart || view.tail.firstDate < windowStart)) {
      windowStart = view.tail.firstDate
    }
    if (view.tail.lastDate && (!windowEnd || view.tail.lastDate > windowEnd)) {
      windowEnd = view.tail.lastDate
    }
  }

  const buckets = options?.buckets ?? INDEX_SPARKLINE_BUCKETS
  const rowFor = (view: UndertakingView): UndertakingIndexRow => ({
    record: view.record,
    tail: view.tail,
    buckets: windowStart
      ? bucketDensityBlock(
          view.tail.density.map(d => ({
            date: d.date,
            chains: d.chains,
            activeDurationMs: d.activeDurationMs,
          })),
          { from: windowStart, to: windowEnd, buckets },
        )
      : [],
  })

  const rowsBySection = new Map<string, UndertakingIndexRow[]>()
  for (const view of views) {
    const key = view.record.section || UNFILED_SECTION_KEY
    const bucket = rowsBySection.get(key) ?? []
    bucket.push(rowFor(view))
    rowsBySection.set(key, bucket)
  }

  const ordered: UndertakingIndexSection[] = []
  for (const section of sections) {
    const rows = rowsBySection.get(section.key)
    if (rows?.length) {
      ordered.push({ key: section.key, title: section.title, rows })
      rowsBySection.delete(section.key)
    }
  }
  // Anything left is a section the project doesn't declare — keep it visible
  // rather than dropping entries, under a plain heading, ordered after the
  // declared sections.
  for (const [key, rows] of rowsBySection) {
    if (!rows.length) continue
    const title = key === UNFILED_SECTION_KEY ? 'Unfiled' : key
    ordered.push({ key, title, rows })
  }

  return { sections: ordered, windowStart, windowEnd }
}

/**
 * Sparkline data for one undertaking, pre-bucketed so the UI doesn't recompute.
 *
 * Optional `from`/`to` set a shared window so strips in a column are comparable
 * (see the density block); absent, the undertaking's own span is used. Throws
 * on a missing undertaking rather than returning empty buckets, which would be
 * indistinguishable from a real never-worked-on entry.
 */
export async function getUndertakingDensityOrch(
  projectId: string,
  key: string,
  options: { buckets: number; from?: string; to?: string },
): Promise<{ buckets: DensityBucket[]; firstDate: string; lastDate: string }> {
  const view = await getUndertakingOrch(projectId, key)
  if (!view) throw new Error(`Undertaking not found: ${key}`)
  const days: DensityDay[] = view.tail.density.map(d => ({
    date: d.date,
    chains: d.chains,
    activeDurationMs: d.activeDurationMs,
  }))
  return {
    buckets: bucketDensityBlock(days, options),
    firstDate: view.tail.firstDate,
    lastDate: view.tail.lastDate,
  }
}

/**
 * Sharpen the head.
 *
 * The head is explicitly mutable — it is the one line stating what came out,
 * and it gets better as the undertaking is understood. `updated_at` moves;
 * `created_at` never does.
 */
export async function updateUndertakingHeadOrch(
  projectId: string,
  key: string,
  head: string,
): Promise<{ path: string; record: UndertakingRecord }> {
  const record = await getUndertakingBlock(projectId, key)
  if (!record) throw new Error(`Undertaking not found: ${key}`)
  const next: UndertakingRecord = {
    ...record,
    head: head.trim(),
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  return { path: await writeUndertakingBlock(projectId, next), record: next }
}

export interface TagUndertakingOptions {
  add?: string[]
  remove?: string[]
  accept?: string[]
  reject?: string[]
  allowNew?: boolean
}

/**
 * Tag an undertaking.
 *
 * Anurag drives this whenever he wants — the mechanism exists so that tagging
 * is one call, not a chore. Unknown tags are refused unless explicitly forced,
 * which is what keeps the vocabulary from fragmenting the way the old
 * organizer's did (six tagged records, and it still managed to hold both
 * `bucket 2` and `bucket 2 - momentum phase`).
 */
export async function tagUndertakingOrch(
  projectId: string,
  key: string,
  options: TagUndertakingOptions,
): Promise<{ path: string; record: UndertakingRecord; rejected: string[]; added: string[] }> {
  const record = await getUndertakingBlock(projectId, key)
  if (!record) throw new Error(`Undertaking not found: ${key}`)

  const vocabulary = await readTagVocabularyBlock(projectId)
  const result = applyTagsBlock(record, options, vocabulary)

  const next: UndertakingRecord = {
    ...record,
    tags: result.tags,
    proposedTags: result.proposedTags,
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  const path = await writeUndertakingBlock(projectId, next)

  if (result.added.length) {
    await writeTagVocabularyBlock(projectId, extendVocabularyBlock(vocabulary, result.added))
  }

  return { path, record: next, rejected: result.rejected, added: result.added }
}

/** Answer the end-of-session ask. Keyed on session id — see the block's note. */
export async function recordAssignmentOrch(params: {
  sessionId: string
  undertakings: string[]
  newTitle?: string
  head?: string
  section?: string
  projectId?: string
}): Promise<{ path: string }> {
  const { path } = await recordAssignmentBlock(params)
  return { path }
}

/** Misattribution repair. ~3% of chains land under the wrong project. */
export async function setChainProjectOrch(
  fromProjectId: string,
  chainKey: string,
  toProjectId: string,
): Promise<{ path: string }> {
  const chain = await findChainBlock(fromProjectId, chainKey)
  if (!chain) throw new Error(`Chain not found: ${chainKey}`)
  const { path } = await patchChainBlock(chain, { projectId: toProjectId })
  return { path }
}

/** Backfill pointers onto a chain that predates extraction. */
export async function setChainFilesOrch(
  projectId: string,
  chainKey: string,
  files: { written?: string[]; read?: string[] },
): Promise<{ path: string }> {
  const chain = await findChainBlock(projectId, chainKey)
  if (!chain) throw new Error(`Chain not found: ${chainKey}`)
  const { path } = await patchChainBlock(chain, {
    filesWritten: files.written ?? chain.filesWritten,
    filesRead: files.read ?? chain.filesRead,
  })
  return { path }
}

export async function listChainsOrch(params: {
  projectId: string
  from?: string
  to?: string
  undertaking?: string
}): Promise<ChainEntry[]> {
  return listChainsBlock(params)
}
