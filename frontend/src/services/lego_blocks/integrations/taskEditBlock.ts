import {
  parseMarkdownFrontmatterBlock,
  stringifyMarkdownFrontmatterBlock,
} from '@/services/lego_blocks/units/markdownFrontmatterBlock'
import {
  parseOrganizerBodySections,
  upsertOrganizerBodySections,
} from '@/services/lego_blocks/integrations/organizerBodyBlock'
import type { YAMLCommentEntry } from '@/services/lego_blocks/units/yamlNoteBlock'

// Editing one authored record, in place.
//
// The store spent its whole life read-only on the reasoning that the seam must
// never write to Anurag's hand-written half. That held while the drawer only
// showed things; it stopped being a principle and became a dead end once the
// drawer became the place you actually read these records from. The line that
// survives is narrower and better: **the app edits only what a human typed.**
// Title, description, tags and comments cross the seam. Section, `fed_by` /
// `produced`, and the disposition do not — those are derived, or owned by the
// undertaking on the other end, and a drawer that let you type into them would
// be inventing facts the deriver is about to overwrite.
//
// ## Why a whole-file round-trip is safe here, and where it isn't
//
// The undertaking store serializes its records from scratch, because the app is
// their only author. These files have three authors — Anurag, the `thinkspc`
// CLI, and agents — so reformatting on save would rewrite work nobody asked to
// touch. That was the standing objection to editing them at all.
//
// It was measured rather than assumed. All 374 records in both stores
// (325 Thinking Space + 49 F9) round-trip through `js-yaml` byte-identical:
// they were machine-written with the same dump options this uses, so the
// frontmatter half is genuinely lossless.
//
// The body half is not, in eight files. Those carry a duplicated
// `## Description` where a comment write went wrong months ago and leaked its
// YAML tail into the prose; re-emitting the body drops the orphaned fragment.
// So this refuses to write them (`assertBodyRoundTripsBlock`) rather than
// quietly tidying them: losing 150 characters of a comment as a side effect of
// renaming something is exactly the silent corruption the read-only rule
// existed to prevent. The guard is not about those eight — it is the invariant
// that any body this cannot re-emit intact is a body it will not write.

export interface TaskEdit {
  /** The title *without* its ticket prefix — what the row and drawer show. The
   *  prefix is re-applied here, and only if the record already carried one. */
  title?: string
  tags?: string[]
  /** The `## Description` section's prose. */
  description?: string
  /** Appended to the `## Comments` thread. Never replaces or reorders it —
   *  comments are the one part of these records that is a log. */
  addComment?: { text: string; author: string }
}

/** How both stores prefix a title with its ticket: `TP-DA-T-514 - Fix the…`. */
const TITLE_PREFIX_RE = /^([a-z0-9]+-[a-z]+-[a-z]-\d+)\s*[-–—:]\s*/i

/**
 * Everything a body carries, ignoring how it is laid out.
 *
 * The comparison has to survive re-emission's blank-line normalisation — seven
 * records differ from their own round-trip by three or four whitespace
 * characters, which is not content changing — while still catching a dropped
 * sentence. Stripping whitespace entirely does both.
 */
function bodySubstanceBlock(body: string): string {
  return body.replace(/\s+/g, '')
}

/**
 * Throw unless the body survives a parse/re-emit unchanged.
 *
 * Run *before* the edit is applied, against the record as it sits on disk, so
 * the question asked is "can this file be written back at all" rather than
 * "did my change lose something" — a malformed record is refused on the way in,
 * not diagnosed from the wreckage on the way out.
 */
export function assertBodyRoundTripsBlock(body: string): void {
  const sections = parseOrganizerBodySections(body)
  const reemitted = upsertOrganizerBodySections(body, {
    description: sections.description,
    comments: sections.comments,
  })
  if (bodySubstanceBlock(reemitted) !== bodySubstanceBlock(body)) {
    throw new Error(
      'This record’s body can’t be rewritten without losing part of it — ' +
        'it has a duplicated or malformed section. Open the file and fix it there.',
    )
  }
}

/**
 * Apply an edit to a record's raw markdown and hand back the new file.
 *
 * Pure, and deliberately so: every judgment about what a record may become is
 * decidable from the record plus the edit, which is what makes it testable
 * against real files without a vault. The orch does the reading and writing.
 */
export function applyTaskEditBlock(raw: string, edit: TaskEdit, nowIso: string): string {
  const note = parseMarkdownFrontmatterBlock(raw)
  if (!note.hasFrontmatter) throw new Error('This record has no frontmatter to edit.')
  assertBodyRoundTripsBlock(note.body)

  const front = { ...note.frontmatter }
  const sections = parseOrganizerBodySections(note.body)
  let description = sections.description
  let comments = sections.comments
  let touched = false

  if (edit.title !== undefined) {
    const next = edit.title.trim()
    if (!next) throw new Error('A record needs a title.')
    // Re-apply the ticket prefix the record already wore, using *its own*
    // prefix rather than the parsed ticket: the two agree on every record in
    // both stores, and where they ever disagree the file is the truth. A record
    // with no prefix keeps none — inventing one would rename it.
    const current = typeof front.title === 'string' ? front.title : ''
    const prefix = TITLE_PREFIX_RE.exec(current)
    front.title = prefix ? `${prefix[1]} - ${next}` : next
    touched = true
  }

  if (edit.tags !== undefined) {
    const next = edit.tags.map(t => t.trim()).filter(Boolean)
    // Dropped rather than written empty: an absent key is how a record with no
    // tags looks everywhere else in both stores, and `tags: []` would make this
    // the one file that says so out loud.
    if (next.length) front.tags = next
    else delete front.tags
    touched = true
  }

  if (edit.description !== undefined) {
    description = edit.description.trim()
    // The frontmatter one-liner and the body section are the same sentence on
    // every record here, and the CLI indexes on the frontmatter one — so they
    // move together. Letting them drift would mean the drawer showed one thing
    // and search returned another.
    if (description) front.description = description
    else delete front.description
    touched = true
  }

  if (edit.addComment && edit.addComment.text.trim()) {
    const entry: YAMLCommentEntry = {
      text: edit.addComment.text.trim(),
      added_at: nowIso,
      added_by: edit.addComment.author,
    }
    // Appended, not prepended. Undertakings show newest-first because their
    // thread is a running commentary on live work; this one is a record's
    // history, and the CLI has always appended to it — reversing here would put
    // the app's comments and the CLI's in opposite orders in the same file.
    comments = [...comments, entry]
    touched = true
  }

  if (!touched) return raw

  front.updated_at = nowIso
  return stringifyMarkdownFrontmatterBlock({
    frontmatter: front,
    body: upsertOrganizerBodySections(note.body, { description, comments }),
  })
}
