import {
  applyTagsBlock,
  extendVocabularyBlock,
  type UndertakingNote,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import {
  deleteSectionBlock,
  getSectionBlock,
  getUndertakingBlock,
  listSectionRecordsBlock,
  listSectionsBlock,
  listUndertakingsBlock,
  readTagVocabularyBlock,
  writeSectionBlock,
  writeTagVocabularyBlock,
  writeUndertakingBlock,
} from '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
import {
  sectionKeyFromTitleBlock,
  type SectionRecord,
} from '@/services/lego_blocks/units/aiActivitySectionBlock'
import {
  findChainBlock,
  listChainsBlock,
  patchChainBlock,
  type ChainEntry,
} from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'
import { recordAssignmentBlock } from '@/services/lego_blocks/integrations/aiActivityAssignmentBlock'
import { listNotesBlock } from '@/services/lego_blocks/integrations/aiActivityNoteStoreBlock'
import { noteCategoryLabelBlock, type Note } from '@/services/lego_blocks/units/aiActivityNoteBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import { readCachedProjectRegistryBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  bucketDensityBlock,
  type DensityBucket,
  type DensityDay,
} from '@/services/lego_blocks/units/aiActivityDensityBlock'
import {
  layoutUndertakingDagBlock,
  type DagLayout,
} from '@/services/lego_blocks/units/undertakingDagLayoutBlock'

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
  /** The chains this undertaking is built from, collapsed by sitting — the same
   *  set the tail is derived from. Present on `getUndertakingOrch` (the detail
   *  page needs the per-chain trail); omitted from list views for weight. */
  chains?: ChainEntry[]
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

// `projectId` is the chain-directory id (e.g. `F9`), not `record.projectId` —
// that field carries the project's stable UUID, and chains live under
// `chains/<dir-id>/`. Passing the UUID here reads a directory that doesn't
// exist and silently yields zero chains (every detail page shows "0 sessions"),
// which is exactly the bug this replaced. The id the index path already uses is
// the one threaded in from the caller.
async function chainsFor(projectId: string, record: UndertakingRecord): Promise<ChainEntry[]> {
  const all = await listChainsBlock({ projectId })
  const wanted = new Set([...record.chains, ...record.fedBy])
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
    const wanted = new Set([...record.chains, ...record.fedBy])
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
  const chains = collapseChainWindowsBlock(await chainsFor(projectId, record))
  return { record, tail: buildTail(chains), chains }
}

// ── The wake list (open notes from the old organizer) ──────────────────────

export interface OpenNotesResult {
  /** Notes no undertaking has fed on — the wake list, oldest first. */
  open: Note[]
  /** Notes the seam edges account for (fed), for a "N of M answered" read. */
  answeredCount: number
  totalNotes: number
}

export interface NoteProject {
  /** Registry display name. */
  name: string
  /** ai-activity project id (undertakings dir) — the project-root basename. */
  projectId: string
  /** Vault-relative root holding the old organizer (`<root>/thinking-organizer`). */
  projectRoot: string
  /** Total notes in the old organizer — cheap signal for chip ordering. */
  askCount: number
}

/**
 * Projects that have an old organizer with notes — the chips for the wake list.
 * Discovered off the project registry: for each registered project, the first
 * vault-relative path whose `thinking-organizer/epics` holds notes. Code-repo
 * roots (absolute, outside the vault) can't hold an organizer, so they're
 * skipped. Empty when no project has been given a registry path yet.
 */
export async function listNoteProjectsOrch(): Promise<NoteProject[]> {
  await loadProjectRegistryBlock()
  const entries = readCachedProjectRegistryBlock()
  const vaultRoot = (getStoredVaultRoot() ?? '').replace(/\/+$/, '')
  const out: NoteProject[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const abs of entry.paths) {
      let rel: string | null = null
      if (vaultRoot && abs === vaultRoot) rel = ''
      else if (vaultRoot && abs.startsWith(`${vaultRoot}/`)) rel = abs.slice(vaultRoot.length + 1)
      else if (!abs.startsWith('/')) rel = abs
      if (rel === null) continue
      const notes = await listNotesBlock(rel)
      if (notes.length === 0) continue
      const projectId = rel.split('/').pop() || entry.project
      if (seen.has(projectId)) continue
      seen.add(projectId)
      out.push({ name: entry.project, projectId, projectRoot: rel, askCount: notes.length })
      break
    }
  }
  out.sort((a, b) => b.askCount - a.askCount || a.name.localeCompare(b.name))
  return out
}

/**
 * The wake list: old-organizer notes that no undertaking has fed on. Open is
 * derived, never stored — add a `fed_by` edge and the note drops off the
 * list on the next read. Keys are compared case-insensitively because the old
 * store lowercases them (`f9-qt-e-318`) while the seam edges carry the display
 * form (`F9-QT-E-318`).
 */
export async function getOpenNotesOrch(params: {
  projectId: string
  projectRoot: string
}): Promise<OpenNotesResult> {
  const [notes, undertakings] = await Promise.all([
    listNotesBlock(params.projectRoot),
    listUndertakingsBlock(params.projectId),
  ])
  const fed = new Set<string>()
  for (const u of undertakings) {
    for (const key of u.fedBy) {
      if (!key.includes('::')) fed.add(key.toUpperCase()) // note tickets only, not chains
    }
  }
  const open = notes.filter(a => !fed.has(a.ticket))
  open.sort((a, b) => (a.openedDate || '').localeCompare(b.openedDate || ''))
  return { open, answeredCount: notes.length - open.length, totalNotes: notes.length }
}

// ── The lineage view (grew_out_of DAG) ────────────────────────────────────

export interface UndertakingDag {
  layout: DagLayout
  /** Count of undertakings with no lineage edge — shown in the list, not here. */
  isolatedCount: number
}

/**
 * The grew_out_of DAG for a project: which undertakings grew out of which.
 * Edge direction is ancestor → descendant, the way understanding flowed — for a
 * record with `grew_out_of: [P]`, the edge is P → this. Only undertakings that
 * take part in an edge appear; the rest are counted so the UI can say how many
 * have no lineage yet.
 */
export async function getUndertakingDagOrch(projectId: string): Promise<UndertakingDag> {
  const records = await listUndertakingsBlock(projectId)
  const nodes = records.map(r => ({ key: r.key, title: r.title }))
  const edges = records.flatMap(r => r.grewOutOf.map(from => ({ from, to: r.key })))
  const layout = layoutUndertakingDagBlock(nodes, edges)
  const included = new Set(layout.nodes.map(n => n.key))
  const isolatedCount = records.filter(r => !included.has(r.key)).length
  return { layout, isolatedCount }
}

// ── The index view ───────────────────────────────────────────────────────

/** A note (old-organizer question/idea) resolved to its title, for display. */
export interface NoteRef {
  key: string
  title: string
}

export interface UndertakingIndexRow {
  record: UndertakingRecord
  tail: UndertakingTail
  /** Density bucketed over the window shared by the whole index, so a column of
   *  strips is comparable — a flat zero-count strip reads as "written down,
   *  never worked on" against its neighbours. */
  buckets: DensityBucket[]
  /** Migrating notes (Questions) that fed this undertaking, resolved to titles.
   *  Rendered as `◇→` sublines: the question, under the doing that answered it.
   *  Empty when nothing migrating fed it. */
  fedNotes: NoteRef[]
}

export interface UndertakingIndexSection {
  key: string
  title: string
  rows: UndertakingIndexRow[]
}

/** One hand-written note (from the old organizer). A note is "engaged" when it
 *  either fed an undertaking (`fedInto`) or was produced by one (`producedBy`);
 *  a note with neither is still untouched — the wake list. */
export interface NoteEntry {
  note: Note
  /** Set when a standing note fed an undertaking — a `→` link to what it fed. */
  fedInto?: { key: string; title: string }
  /** Set when the note was produced by an undertaking — a `←` link to its
   *  source. The forward arm of the loop: the work threw up this note. */
  producedBy?: { key: string; title: string }
}

/** Notes of one kind (Ideas, Questions, Missed Ideas, …), in their own section
 *  — the other taxonomy, sitting as a peer beside the undertaking sections. */
export interface NoteSection {
  code: string
  title: string
  notes: NoteEntry[]
}

export interface UndertakingIndex {
  sections: UndertakingIndexSection[]
  /** The note taxonomy — the hand-written half — as peer sections after the
   *  undertaking zone. Empty when the project has no old organizer. */
  noteSections: NoteSection[]
  /** The shared window every strip is bucketed over (`YYYY-MM-DD`), or '' when
   *  there is no dated activity anywhere in the index. */
  windowStart: string
  windowEnd: string
}

// Note kinds that MIGRATE when worked: a researched question stops being an open
// question, so it leaves its section and shows under the undertaking that
// answered it. Every other kind is STANDING — an idea is a thesis, a missed idea
// a permanent lesson, a learning is knowledge — so it stays in its section when
// worked and only gains a link to what it fed. (Category codes from the note key:
// QT = Questions to research.)
const MIGRATING_NOTE_CODES = new Set(['QT', 'IC', 'ET', 'EO', 'TD'])

export interface NoteSeam {
  noteSections: NoteSection[]
  /** Undertaking key → the *migrating* notes that fed it (rendered as ◇→
   *  sublines under the doing). Standing notes are not here — they stay in their
   *  own section, carrying a link back instead. */
  fedNotes: Map<string, NoteRef[]>
}

/**
 * The note↔undertaking join, derived — never stored. An undertaking's `fedBy`
 * holds both note keys and chain keys; only the notes matter here (chain keys
 * carry `::`). Split by kind:
 *
 * - A **migrating** note (a Question) that fed an undertaking leaves its section
 *   and is handed back as a subline under the undertaking it fed.
 * - A **standing** note (Idea, Missed Idea, learning…) always keeps its row in
 *   its own section; if it fed an undertaking it carries a link (`fedInto`)
 *   rather than vacating — because a thesis or a lesson doesn't stop existing
 *   once it's been acted on.
 *
 * So the wake list needs no label: it's simply the notes still sitting in their
 * sections with no link. Keys compare case-insensitively — the old store
 * lowercases them, the seam edges carry the display form.
 */
export function buildNoteSeamBlock(notes: Note[], records: UndertakingRecord[], _nowMs: number): NoteSeam {
  // Keyed on the ticket (`F9-QT-E-541`), not the slugged key — edges reference
  // the ticket, the note's key carries a title slug the edges don't have.
  const byKey = new Map<string, Note>()
  for (const note of notes) byKey.set(note.ticket, note)

  const migratedAway = new Set<string>()
  const fedNotes = new Map<string, NoteRef[]>()
  const fedInto = new Map<string, { key: string; title: string }>()
  const producedBy = new Map<string, { key: string; title: string }>()
  for (const record of records) {
    const refs: NoteRef[] = []
    for (const raw of record.fedBy) {
      if (raw.includes('::')) continue // a chain-strand, not a note
      const up = raw.toUpperCase()
      const note = byKey.get(up)
      // A dangling edge (no matching note) is treated as migrating — shown as a
      // subline, never a phantom section-dweller.
      const migrating = note ? MIGRATING_NOTE_CODES.has(note.categoryCode) : true
      if (migrating) {
        refs.push({ key: note?.key ?? raw, title: note?.title ?? raw })
        migratedAway.add(up)
      } else {
        fedInto.set(up, { key: record.key, title: record.title })
      }
    }
    if (refs.length) fedNotes.set(record.key, refs)
    // Notes this undertaking produced stay in their own sections, tagged with a
    // back-link to their source.
    for (const raw of record.produced) {
      producedBy.set(raw.toUpperCase(), { key: record.key, title: record.title })
    }
  }

  const byCategory = new Map<string, NoteEntry[]>()
  for (const note of notes) {
    if (migratedAway.has(note.ticket)) continue
    const list = byCategory.get(note.categoryCode) ?? []
    list.push({ note, fedInto: fedInto.get(note.ticket), producedBy: producedBy.get(note.ticket) })
    byCategory.set(note.categoryCode, list)
  }

  const noteSections: NoteSection[] = [...byCategory.entries()].map(([code, list]) => ({
    code,
    title: noteCategoryLabelBlock(code),
    notes: list.sort((a, b) => (a.note.openedDate || '').localeCompare(b.note.openedDate || '')),
  }))
  // Kinds ordered by their oldest note, so the arrangement is stable.
  noteSections.sort(
    (a, b) => (a.notes[0]?.note.openedDate || '').localeCompare(b.notes[0]?.note.openedDate || ''),
  )

  return { noteSections, fedNotes }
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
  const [views, sections, askRoot] = await Promise.all([
    listUndertakingsOrch(projectId),
    listSectionsBlock(projectId),
    noteRootForProjectBlock(projectId),
  ])
  const notes = askRoot !== null ? await listNotesBlock(askRoot) : []
  const seam = buildNoteSeamBlock(notes, views.map(v => v.record), Date.now())

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
    fedNotes: seam.fedNotes.get(view.record.key) ?? [],
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

  // Most recently worked first, within each section. `lastDate` is `YYYY-MM-DD`
  // so it sorts lexically; undertakings with no recorded work (no lastDate) fall
  // to the bottom rather than sorting as the empty string at the top. Ties break
  // on title so the order is stable between loads.
  for (const rows of rowsBySection.values()) {
    rows.sort((a, b) => {
      const aDate = a.tail.lastDate || ''
      const bDate = b.tail.lastDate || ''
      if (aDate !== bDate) {
        if (!aDate) return 1
        if (!bDate) return -1
        return bDate.localeCompare(aDate)
      }
      return (a.record.title || '').localeCompare(b.record.title || '')
    })
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

  return { sections: ordered, noteSections: seam.noteSections, windowStart, windowEnd }
}

/**
 * The vault-relative root of a project's old organizer (`<root>/thinking-
 * organizer`), resolved off the registry by matching the chain-directory id
 * (the path's basename) to `projectId`. Null when no registered path resolves —
 * a code-repo root (absolute, outside the vault) or a project with no registry
 * entry. Kept lean (no note reads) because the index loads on every tab open;
 * listNoteProjectsOrch does the same resolution but also counts notes per project.
 */
async function noteRootForProjectBlock(projectId: string): Promise<string | null> {
  await loadProjectRegistryBlock()
  const vaultRoot = (getStoredVaultRoot() ?? '').replace(/\/+$/, '')
  for (const entry of readCachedProjectRegistryBlock()) {
    for (const abs of entry.paths) {
      let rel: string | null = null
      if (vaultRoot && abs === vaultRoot) rel = ''
      else if (vaultRoot && abs.startsWith(`${vaultRoot}/`)) rel = abs.slice(vaultRoot.length + 1)
      else if (!abs.startsWith('/')) rel = abs
      if (rel === null) continue
      const id = rel.split('/').pop() || entry.project
      if (id === projectId) return rel
    }
  }
  return null
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

/**
 * Add a margin note to an undertaking.
 *
 * Notes are the annotation surface — Anurag's voice on an entry, the "edits are
 * signal" half of the design. They live in the body under `## Notes`, dated,
 * newest first, so they read and edit as prose in Obsidian. Unlike the head
 * (one line, replaced destructively) notes accumulate: append-only by intent,
 * though any of them stays hand-editable in the vault file.
 */
export async function addUndertakingNoteOrch(
  projectId: string,
  key: string,
  text: string,
  author = '',
): Promise<{ path: string; record: UndertakingRecord }> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty note')
  const record = await getUndertakingBlock(projectId, key)
  if (!record) throw new Error(`Undertaking not found: ${key}`)
  const today = new Date().toISOString().slice(0, 10)
  const note: UndertakingNote = { date: today, author: author.trim(), text: trimmed }
  const next: UndertakingRecord = {
    ...record,
    notes: [note, ...record.notes],
    updatedAt: today,
  }
  return { path: await writeUndertakingBlock(projectId, next), record: next }
}

/**
 * Remove a note by its position in the newest-first list the UI shows. Index-
 * based rather than content-based because notes carry no id — position is the
 * only handle, and the drawer's list is the same order this reads.
 */
export async function removeUndertakingNoteOrch(
  projectId: string,
  key: string,
  index: number,
): Promise<{ path: string; record: UndertakingRecord }> {
  const record = await getUndertakingBlock(projectId, key)
  if (!record) throw new Error(`Undertaking not found: ${key}`)
  if (index < 0 || index >= record.notes.length) throw new Error(`No note at ${index}`)
  const next: UndertakingRecord = {
    ...record,
    notes: record.notes.filter((_, i) => i !== index),
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  return { path: await writeUndertakingBlock(projectId, next), record: next }
}

/** Editable non-tag fields on an undertaking. Everything here is Anurag's
 *  judgment — title, where it files, and its relationship edges — so all of it
 *  stays hand-editable (the design's "nothing may depend on upkeep, but
 *  everything may be edited"). Tags go through `tagUndertakingOrch` for
 *  vocabulary validation; the head and notes have their own orchs. */
export interface UndertakingFieldPatch {
  title?: string
  /** Section key (the record's `parent`). Re-files the undertaking. */
  section?: string
  /** Undertaking keys this one grew out of — its causes. */
  grewOutOf?: string[]
  /** Note keys this undertaking produced. */
  produced?: string[]
}

export async function updateUndertakingFieldsOrch(
  projectId: string,
  key: string,
  patch: UndertakingFieldPatch,
): Promise<{ path: string; record: UndertakingRecord }> {
  const record = await getUndertakingBlock(projectId, key)
  if (!record) throw new Error(`Undertaking not found: ${key}`)
  if (patch.title !== undefined && !patch.title.trim()) throw new Error('Title cannot be empty')
  const next: UndertakingRecord = {
    ...record,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.section !== undefined ? { section: patch.section } : {}),
    ...(patch.grewOutOf !== undefined ? { grewOutOf: patch.grewOutOf } : {}),
    ...(patch.produced !== undefined ? { produced: patch.produced } : {}),
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  return { path: await writeUndertakingBlock(projectId, next), record: next }
}

/** The project's sections, for the re-file dropdown. */
export async function listUndertakingSectionsOrch(
  projectId: string,
): Promise<Array<{ key: string; title: string }>> {
  return listSectionsBlock(projectId)
}

/** Lightweight {key,title} for every undertaking in a project — the candidate
 *  set for the grew_out_of picker. Reads records only (no chain walk), unlike
 *  listUndertakingsOrch which also builds tails. */
export async function listUndertakingTitlesOrch(
  projectId: string,
): Promise<Array<{ key: string; title: string }>> {
  const records = await listUndertakingsBlock(projectId)
  return records.map(r => ({ key: r.key, title: r.title || r.head || r.key }))
}

// ── Section management (CRUD) ─────────────────────────────────────────────
//
// Sections are the one level of grouping — "one home per entry by kind." They
// were seeded by the migration and, until now, could only be read. These make
// the set editable from the app: create, rename, reorder, delete. Nothing here
// touches an undertaking; re-filing is a field edit on the undertaking side.

function newUuidBlock(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `sec-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** A section plus how many undertakings file under it — the manager's row. The
 *  count is what gates deletion (a non-empty section can't be removed without
 *  orphaning its undertakings). */
export interface ManagedSection {
  key: string
  title: string
  sortOrder: number
  count: number
}

export async function listManagedSectionsOrch(projectId: string): Promise<ManagedSection[]> {
  const [sections, undertakings] = await Promise.all([
    listSectionRecordsBlock(projectId),
    listUndertakingsBlock(projectId),
  ])
  const counts = new Map<string, number>()
  for (const u of undertakings) counts.set(u.section, (counts.get(u.section) ?? 0) + 1)
  return sections.map(s => ({ key: s.key, title: s.title, sortOrder: s.sortOrder, count: counts.get(s.key) ?? 0 }))
}

export async function createSectionOrch(
  projectId: string,
  title: string,
): Promise<{ path: string; record: SectionRecord }> {
  const t = title.trim()
  if (!t) throw new Error('Section title cannot be empty')
  const existing = await listSectionRecordsBlock(projectId)
  const key = sectionKeyFromTitleBlock(projectId, t, existing.map(s => s.key))
  const maxSort = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0)
  // The stable project id is cosmetic on a section (nothing resolves by it), but
  // keep it consistent with the project's other records when one is available.
  let stableProjectId = existing[0]?.projectId ?? ''
  if (!stableProjectId) {
    const unds = await listUndertakingsBlock(projectId)
    stableProjectId = unds[0]?.projectId ?? ''
  }
  const record: SectionRecord = {
    uuid: newUuidBlock(),
    key,
    title: t,
    projectId: stableProjectId,
    sortOrder: maxSort + 1,
    origin: 'organizer-ui',
    body: 'Section of the index. Holds undertakings.',
  }
  return { path: await writeSectionBlock(projectId, record), record }
}

export async function renameSectionOrch(
  projectId: string,
  key: string,
  title: string,
): Promise<{ path: string; record: SectionRecord }> {
  const t = title.trim()
  if (!t) throw new Error('Section title cannot be empty')
  const record = await getSectionBlock(projectId, key)
  if (!record) throw new Error(`Section not found: ${key}`)
  const next: SectionRecord = { ...record, title: t }
  return { path: await writeSectionBlock(projectId, next), record: next }
}

/** Move a section one place up or down. Renumbers sort_order to 1..n so the
 *  order is exact regardless of the prior values, writing only the rows that
 *  actually moved. A no-op at the ends. */
export async function reorderSectionOrch(
  projectId: string,
  key: string,
  direction: 'up' | 'down',
): Promise<void> {
  const list = await listSectionRecordsBlock(projectId)
  const i = list.findIndex(s => s.key === key)
  if (i < 0) throw new Error(`Section not found: ${key}`)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return
  const reordered = [...list]
  ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
  await Promise.all(
    reordered.map((s, idx) =>
      s.sortOrder === idx + 1
        ? Promise.resolve('')
        : writeSectionBlock(projectId, { ...s, sortOrder: idx + 1 }),
    ),
  )
}

/** Delete a section — refused while it still has undertakings, so nothing is
 *  silently orphaned into "Unfiled". Move them first. */
export async function deleteSectionOrch(projectId: string, key: string): Promise<void> {
  const undertakings = await listUndertakingsBlock(projectId)
  const count = undertakings.filter(u => u.section === key).length
  if (count > 0) throw new Error(`Section still holds ${count} undertaking${count === 1 ? '' : 's'} — move them first`)
  await deleteSectionBlock(projectId, key)
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
