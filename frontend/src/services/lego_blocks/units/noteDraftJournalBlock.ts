// Recovery journal — the pure half. See docs/contracts/DURABILITY.md.
//
// The journal is the second copy of typed text. It exists because every other
// copy has a failure mode that the app is required to assume happens:
//
//  - the editor buffer dies with the renderer;
//  - the note file is only as fresh as the last successful save, and saves fail;
//  - `localStorage` dies with an app reinstall (iOS sandbox wipe, Electron
//    userData reset — and userData here has already been renamed once).
//
// So there are two tiers, and they are not redundant: the hot tier is
// synchronous, which is the only way to write during `pagehide`, and the
// durable tier lives in the vault, which is the only store that outlives the
// app. This file decides *what* a journal entry is and when one is finished
// with; `integrations/noteDraftJournalStoreBlock` does the writing.
//
// Format note: the durable tier is plain markdown at a predictable path, on
// purpose. If the app never launches again the draft has to open in TextEdit or
// Obsidian. Recovery must never depend on the software that crashed.

export const DRAFT_JOURNAL_HOT_KEY_BLOCK = 'ltm-note-draft-journal'
export const DRAFT_JOURNAL_DIR_BLOCK = '.thinking-space/drafts'

/** Hot tier debounce. Well inside the 1200ms auto-save debounce, so the gap
 *  auto-save leaves open is covered rather than mirrored. */
export const DRAFT_HOT_DEBOUNCE_MS_BLOCK = 250
/** Durable tier debounce. Longer because it writes into the vault, which may be
 *  iCloud-backed — the ENERGY contract's "coalesce, don't churn". */
export const DRAFT_DURABLE_DEBOUNCE_MS_BLOCK = 2000

/** What a journal entry holds.
 *
 *  `note` is the whole editor buffer. `excalidraw-delta` is a JSON delta
 *  against the drawing as it was loaded — a drawing is far too large to write
 *  whole on a timer (3,030,148 bytes for one measured file, against 71,525 for
 *  its delta twenty strokes into a session). */
export type NoteDraftKindBlock = 'note' | 'excalidraw-delta'

export interface NoteDraftEntryBlock {
  /** Stable for the life of one composer session. */
  id: string
  /** Absent in entries written before drawings were journaled; those are all
   *  notes, so the parser defaults accordingly rather than discarding them. */
  kind?: NoteDraftKindBlock
  /** Where the text was headed. `null` when no destination was chosen yet —
   *  which is a state worth journaling, not a reason to skip it. */
  targetPath: string | null
  content: string
  updatedAt: string
  /** Whether this session brought the target file into existence. Recorded here
   *  rather than in memory because memory does not survive the crash this
   *  journal exists for. */
  createdTarget: boolean
}

/** Draft ids are used as filenames, so they must be safe as one and stable. */
export function createDraftIdBlock(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${Math.random().toString(36).slice(2, 10)}`
}

export function draftFilePathBlock(id: string): string {
  return `${DRAFT_JOURNAL_DIR_BLOCK}/${sanitizeDraftIdBlock(id)}.md`
}

/** Defensive: an id reaching the filesystem must not carry separators or dots
 *  that could walk out of the drafts folder. */
export function sanitizeDraftIdBlock(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, '-').replace(/\.{2,}/g, '-')
  return cleaned.replace(/^[.-]+/, '') || 'draft'
}

const DRAFT_MARKER_BLOCK = 'thinkspc_draft: true'

/** Serialize an entry as human-openable markdown.
 *
 *  The note's own content may itself begin with `---`. That is fine: the header
 *  below is closed before the content starts, and `parseNoteDraftBlock` splits
 *  on the *first* closing fence, so a nested frontmatter block round-trips
 *  intact. It also means a human opening the file sees the recovery metadata
 *  and then their note, in that order, which is the point. */
export function serializeNoteDraftBlock(entry: NoteDraftEntryBlock): string {
  const header = [
    '---',
    DRAFT_MARKER_BLOCK,
    `draft_id: ${JSON.stringify(entry.id)}`,
    `target_path: ${JSON.stringify(entry.targetPath ?? '')}`,
    `updated_at: ${JSON.stringify(entry.updatedAt)}`,
    `created_target: ${entry.createdTarget ? 'true' : 'false'}`,
    `draft_kind: ${entry.kind ?? 'note'}`,
    '---',
    // Two entries, so the join emits the closing fence's newline *and* one
    // blank separator line. `parseNoteDraftBlock` consumes exactly one blank
    // line, so content beginning with its own newlines round-trips intact —
    // without the separator here, the parser ate the first one.
    '',
    '',
  ].join('\n')
  return header + entry.content
}

function readHeaderValueBlock(lines: string[], key: string): string {
  const prefix = `${key}:`
  for (const line of lines) {
    if (!line.startsWith(prefix)) continue
    const raw = line.slice(prefix.length).trim()
    if (raw.startsWith('"')) {
      try {
        return String(JSON.parse(raw))
      } catch {
        return raw.replace(/^"|"$/g, '')
      }
    }
    return raw
  }
  return ''
}

/** Parse a durable draft file. Returns `null` for anything that is not one —
 *  the drafts folder is in the vault, so a user could put anything there, and
 *  misreading a real note as a draft would offer to "recover" it over itself. */
export function parseNoteDraftBlock(text: string): NoteDraftEntryBlock | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return null
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return null
  const header = lines.slice(1, closingIndex)
  if (!header.includes(DRAFT_MARKER_BLOCK)) return null

  const id = readHeaderValueBlock(header, 'draft_id')
  if (!id) return null
  const targetPath = readHeaderValueBlock(header, 'target_path')
  // A single blank line after the header is the separator the serializer wrote;
  // anything beyond that is content and must survive verbatim.
  const body = lines.slice(closingIndex + 1)
  if (body[0] === '') body.shift()
  return {
    id,
    targetPath: targetPath || null,
    content: body.join('\n'),
    updatedAt: readHeaderValueBlock(header, 'updated_at'),
    createdTarget: readHeaderValueBlock(header, 'created_target') === 'true',
    kind: readHeaderValueBlock(header, 'draft_kind') === 'excalidraw-delta'
      ? 'excalidraw-delta'
      : 'note',
  }
}

/** Is the journaled text already accounted for on disk?
 *
 *  Deliberately containment rather than equality. A save re-reads the file, and
 *  the capability generates frontmatter on the way, so the text that lands is
 *  never byte-identical to what was journaled. Containment of the *body* is the
 *  honest question: is every character the user typed present at the target.
 *
 *  Empty drafts are covered by definition — there is nothing to lose. */
export function isDraftCoveredByDiskBlock(
  draftContent: string,
  diskContent: string | null,
  kind: NoteDraftKindBlock = 'note',
): boolean {
  // A drawing delta is JSON against a scene, so text containment says nothing
  // about it. These are cleared explicitly when a save's read-back confirms the
  // write, so one that is still here survived a crash — which is exactly when
  // it should be offered. Erring toward offering is the safe direction.
  if (kind === 'excalidraw-delta') return false
  return isNoteDraftCoveredByDiskBlock(draftContent, diskContent)
}

function isNoteDraftCoveredByDiskBlock(draftContent: string, diskContent: string | null): boolean {
  const draftBody = stripFrontmatterForCompareBlock(draftContent).trim()
  if (!draftBody) return true
  if (diskContent === null) return false
  return stripFrontmatterForCompareBlock(diskContent).includes(draftBody)
}

function stripFrontmatterForCompareBlock(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return normalized
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return normalized
  return lines.slice(closingIndex + 1).join('\n')
}

/** Which drafts still hold text that is nowhere else.
 *
 *  This is the list a user is offered on launch. It must never include a draft
 *  whose text landed — a false offer trains people to dismiss the real one. */
export function unresolvedDraftsBlock(
  entries: readonly NoteDraftEntryBlock[],
  diskContentByPath: ReadonlyMap<string, string | null>,
): NoteDraftEntryBlock[] {
  return entries.filter((entry) => {
    const disk = entry.targetPath ? (diskContentByPath.get(entry.targetPath) ?? null) : null
    return !isDraftCoveredByDiskBlock(entry.content, disk, entry.kind ?? 'note')
  })
}

/** Newest first, so a recovery list reads in the order a person expects. */
export function sortDraftsByRecencyBlock(entries: readonly NoteDraftEntryBlock[]): NoteDraftEntryBlock[] {
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
