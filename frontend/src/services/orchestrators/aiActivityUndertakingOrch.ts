import {
  applyTagsBlock,
  extendVocabularyBlock,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import {
  getUndertakingBlock,
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
  /** Distinct calendar days worked — a truer measure of span than duration. */
  dayCount: number
  firstDate: string
  lastDate: string
  /** Union of the chains' file pointers. The index's page numbers. */
  files: string[]
  /** Per-day chain counts, oldest first — pre-bucketed for the sparkline. */
  density: Array<{ date: string; chains: number; durationMs: number }>
}

export interface UndertakingView {
  record: UndertakingRecord
  tail: UndertakingTail
}

/**
 * Duration is summed over *distinct* chain keys.
 *
 * `PreCompact` and `SessionEnd` both fire on a single session, producing two
 * near-identical chains whose keys differ only by a `#w1` / `#w2` window
 * suffix. Summing them naively is what inflated the dry run's per-entry minutes
 * by roughly 2x. Collapsing on the pre-suffix key is the honest count, and the
 * density sparkline's entire job is to be honest about how much work happened.
 */
export function collapseChainWindowsBlock(chains: ChainEntry[]): ChainEntry[] {
  const bySession = new Map<string, ChainEntry>()
  for (const chain of chains) {
    const base = chain.chainKey.replace(/#w\d+$/, '')
    const existing = bySession.get(base)
    // Keep the longest window: it is the fuller record of the same session.
    if (!existing || chain.durationMs > existing.durationMs) bySession.set(base, chain)
  }
  return Array.from(bySession.values()).sort((a, b) => a.startedIso.localeCompare(b.startedIso))
}

function buildTail(chains: ChainEntry[]): UndertakingTail {
  const collapsed = collapseChainWindowsBlock(chains)
  const byDate = new Map<string, { chains: number; durationMs: number }>()
  const files = new Set<string>()
  let durationMs = 0

  for (const chain of collapsed) {
    durationMs += chain.durationMs
    const bucket = byDate.get(chain.date) ?? { chains: 0, durationMs: 0 }
    bucket.chains += 1
    bucket.durationMs += chain.durationMs
    byDate.set(chain.date, bucket)
    for (const file of chain.filesWritten) files.add(file)
  }

  const dates = Array.from(byDate.keys()).sort()
  return {
    chainCount: collapsed.length,
    durationMs,
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
    chain => wanted.has(chain.chainKey) || chain.undertaking === record.key,
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
      chain => wanted.has(chain.chainKey) || chain.undertaking === record.key,
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
  undertaking: string
  newTitle?: string
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
