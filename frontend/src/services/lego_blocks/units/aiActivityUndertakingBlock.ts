import yaml from 'js-yaml'

/**
 * Undertaking records — the judgment half of the Thinking Organizer index.
 *
 * An undertaking has a mutable *head* (one line stating what came out, written
 * by Anurag, sharpened over time) and an append-only *tail* (what it took).
 * Only the head half is stored here. The tail is derived from `ai-activity/chains/`
 * on read and is never copied in — copying it would make this file a stale cache,
 * which is the mistake `ranges/` already makes.
 *
 * Records live at `ai-activity/thinking-organizer/<project>/undertakings/*.md`.
 * They are hand-editable: unlike `ranges/`, nothing regenerates them from a hash,
 * so an edit here survives.
 *
 * ## The tag rule
 *
 * Two fields, and the split is the whole point:
 *
 * - `tags`      — Anurag's. Authoritative. Nothing automated ever writes here.
 * - `proposedTags` — Kai's guesses. Cheap to ignore, cheap to promote.
 *
 * The dry run put Kai's inventions straight into the field the app reads, which
 * would have let machine vocabulary quietly become the real vocabulary. Keeping
 * them apart means a tag only becomes real when a human promotes it, and
 * promotion is one call.
 *
 * Vocabulary is validated against a per-project list so the store doesn't
 * fragment the way the old organizer's did — it accumulated both `bucket 2` and
 * `bucket 2 - momentum phase` as separate tags across only six tagged records.
 */

export interface UndertakingRecord {
  uuid: string
  key: string
  title: string
  projectId: string
  /** Section key this undertaking files under. */
  section: string
  createdAt: string
  updatedAt: string
  sortOrder: number
  /** Anurag's tags. Authoritative — never written by automation. */
  tags: string[]
  /** Kai's suggestions, pending promotion or dismissal. */
  proposedTags: string[]
  /** The undertaking this one grew out of — doing→doing lineage. Sparse. */
  grewOutOf: string[]
  /** Everything that fed this undertaking: the old organizer's notes it took up
   *  (keys like `F9-QT-E-318`) and chain-strands filed elsewhere that carry work
   *  for it (keys like `F9::native/…`). The two are told apart by shape. A note
   *  that fed no undertaking is, by that fact, still open — the wake list. */
  fedBy: string[]
  /** Notes this undertaking produced — new questions or findings the work threw
   *  up. Pointers to note keys; the note's own kind says whether it's still to
   *  explore. */
  produced: string[]
  /** Chains that primarily belong to this undertaking. Pointers, not content. */
  chains: string[]
  /** Vault/repo pointers — the index's page numbers. */
  files: string[]
  /** Provenance: which pass created this record. */
  origin: string
  /** The head. One line: what came out. The first paragraph of the body. */
  head: string
  /** Margin notes — Anurag's annotations over time. They live in the *body*
   *  under a `## Notes` heading, not in YAML: they are prose he reads and edits
   *  in Obsidian, and YAML is machine-only. Newest first. */
  notes: UndertakingNote[]
}

/** One margin note on an undertaking. Stored in the body as a paragraph led by
 *  `**YYYY-MM-DD**` (optionally `· Author`); a hand-typed paragraph with no such
 *  lead parses as an undated note so an Obsidian edit never breaks. */
export interface UndertakingNote {
  /** `YYYY-MM-DD`, or '' for a hand-typed undated note. */
  date: string
  /** Author after the date (`· Kai`); '' means the default single user. */
  author: string
  /** The note prose (markdown). */
  text: string
}

export const UNDERTAKING_RECORD_KIND = 'undertaking'

/** The heading that splits head (above) from notes (below) in the body. */
const NOTES_HEADING_RE = /^[ \t]*##[ \t]+Notes[ \t]*$/m
/** A note paragraph's lead: `**2026-07-31** — text` or, with an author,
 *  `**2026-07-31** · Kai — text`. The `—`/`-` separator is required so the
 *  author group binds to the whole name rather than its first letter; a block
 *  without this exact shape parses as an undated note. */
const NOTE_LEAD_RE = /^\*\*(\d{4}-\d{2}-\d{2})\*\*(?:[ \t]*·[ \t]*(.+?))?[ \t]*[—-][ \t]+/

/** Split a `## Notes` region into structured notes: one per blank-line-separated
 *  paragraph. A `**date**` lead makes it dated; anything else — a paragraph typed
 *  straight into Obsidian — parses as an undated note rather than being dropped
 *  or glued to its neighbour. One block ⇒ one note keeps the round-trip exact. */
function parseNotesRegionBlock(region: string): UndertakingNote[] {
  const blocks = region.split(/\n[ \t]*\n/).map(b => b.trim()).filter(Boolean)
  return blocks.map(block => {
    const lead = NOTE_LEAD_RE.exec(block)
    return lead
      ? { date: lead[1], author: (lead[2] ?? '').trim(), text: block.slice(lead[0].length).trim() }
      : { date: '', author: '', text: block }
  })
}

/** Render one note back to its body paragraph. Internal blank lines are collapsed
 *  so a note stays a single block — the invariant `parseNotesRegionBlock` relies on
 *  (one block ⇒ one note), so a note can never split itself on the next read. */
function serializeNoteBlock(note: UndertakingNote): string {
  const text = note.text.replace(/\n[ \t]*\n+/g, '\n').trim()
  if (!note.date && !note.author) return text
  const prefix = note.author ? `**${note.date}** · ${note.author}` : `**${note.date}**`
  return `${prefix} — ${text}`
}

/** Assemble the body from its two halves: head on top, a `## Notes` section
 *  below when there are any. The one place the body's shape is defined. */
export function buildUndertakingBodyBlock(head: string, notes: UndertakingNote[]): string {
  const h = head.trim()
  if (!notes.length) return h
  const rendered = notes.map(serializeNoteBlock).join('\n\n')
  return h ? `${h}\n\n## Notes\n\n${rendered}` : `## Notes\n\n${rendered}`
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim())
  }
  return out
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Canonical tag form: lowercase, single-spaced, no surrounding punctuation.
 *
 * Matching only — the display form is whatever the vocabulary file says, so
 * `For Sure For Value` and `for sure for value` resolve to one tag instead of two.
 */
export function normalizeTagBlock(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/^[^a-z0-9]+|[^a-z0-9?]+$/g, '')
    .trim()
}

/** Parse an undertaking markdown file. Returns null if it isn't one. */
export function parseUndertakingBlock(content: string): UndertakingRecord | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return null
  const rest = trimmed.slice(afterOpen + 1)
  const close = /^---\s*$/m.exec(rest)
  if (!close) return null

  let parsed: Record<string, unknown>
  try {
    parsed = yaml.load(rest.slice(0, close.index)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const key = asString(parsed.key)
  const uuid = asString(parsed.uuid)
  if (!key || !uuid) return null
  if (asString(parsed.record_kind) !== UNDERTAKING_RECORD_KIND) return null

  const body = rest.slice(close.index + close[0].length).replace(/^\n+/, '')
  // The body carries the head (first paragraph) and, below a `## Notes` heading,
  // the margin notes. A record with no such heading is all head — which is every
  // record written before notes existed, so they keep loading unchanged.
  const notesHeading = NOTES_HEADING_RE.exec(body)
  const head = (notesHeading ? body.slice(0, notesHeading.index) : body).trim()
  const notes = notesHeading
    ? parseNotesRegionBlock(body.slice(notesHeading.index + notesHeading[0].length))
    : []

  return {
    uuid,
    key,
    title: asString(parsed.title),
    projectId: asString(parsed.project_id),
    section: asString(parsed.parent),
    createdAt: asString(parsed.created_at),
    updatedAt: asString(parsed.updated_at),
    sortOrder: asNumber(parsed.sort_order),
    tags: asStringArray(parsed.tags),
    proposedTags: asStringArray(parsed.proposed_tags),
    grewOutOf: asStringArray(parsed.grew_out_of),
    // `fed_by` merges what were once two fields: `discharges` (notes) and
    // `also_fed_by` (chain-strands). Legacy names are still read so a record
    // written before the rename keeps loading; serialize only ever writes
    // `fed_by`, so it heals on the next save.
    fedBy: [
      ...asStringArray(parsed.fed_by),
      ...asStringArray(parsed.discharges),
      ...asStringArray(parsed.also_fed_by),
    ],
    produced: [...asStringArray(parsed.produced), ...asStringArray(parsed.produces)],
    chains: asStringArray(parsed.chains),
    files: asStringArray(parsed.files),
    origin: asString(parsed.origin),
    head,
    notes,
  }
}

/**
 * Serialize back to markdown.
 *
 * Field order is fixed and empty arrays are kept rather than dropped: an empty
 * `files: []` is a recorded gap (chains carry no file references yet), not an
 * absence of the concept. Dropping it would make the gap invisible.
 */
export function serializeUndertakingBlock(record: UndertakingRecord): string {
  const frontmatter: Record<string, unknown> = {
    uuid: record.uuid,
    key: record.key,
    title: record.title,
    type: UNDERTAKING_RECORD_KIND,
    level: 1,
    record_kind: UNDERTAKING_RECORD_KIND,
    project_id: record.projectId,
    parent: record.section,
    parent_type: 'section',
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    sort_order: record.sortOrder,
    tags: record.tags,
    proposed_tags: record.proposedTags,
    grew_out_of: record.grewOutOf,
    chains: record.chains,
    files: record.files,
    origin: record.origin,
  }
  // Seam edges are emitted only when present. Unlike `files` (an empty array is
  // a recorded gap), most undertakings feed or produce nothing, and that is the
  // ordinary case, not a gap worth a line on every record.
  if (record.fedBy.length) frontmatter.fed_by = record.fedBy
  if (record.produced.length) frontmatter.produced = record.produced

  const yamlStr = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' })
    .trimEnd()

  const body = buildUndertakingBodyBlock(record.head, record.notes)
  return `---\n${yamlStr}\n---\n${body ? `\n${body}\n` : ''}`
}

export interface TagVocabulary {
  /** Display forms, in the order the project wants them shown. */
  tags: string[]
}

/** Look up a tag's display form in the vocabulary, matching case-insensitively. */
export function resolveTagBlock(tag: string, vocabulary: TagVocabulary): string | null {
  const wanted = normalizeTagBlock(tag)
  if (!wanted) return null
  for (const candidate of vocabulary.tags) {
    if (normalizeTagBlock(candidate) === wanted) return candidate
  }
  return null
}

export interface ApplyTagsOptions {
  add?: string[]
  remove?: string[]
  /** Promote these from `proposedTags` into `tags`. */
  accept?: string[]
  /** Drop these from `proposedTags` without accepting. */
  reject?: string[]
  /**
   * Allow tags outside the vocabulary. Off by default — an unrecognized tag is
   * usually a typo or a near-duplicate of one that already exists, and silently
   * accepting it is how a vocabulary fragments.
   */
  allowNew?: boolean
}

export interface ApplyTagsResult {
  tags: string[]
  proposedTags: string[]
  /** New display forms that should be appended to the vocabulary file. */
  added: string[]
  /** Tags refused because they aren't in the vocabulary and `allowNew` was off. */
  rejected: string[]
}

/**
 * Apply a tag edit to a record. Pure — the caller persists the result.
 *
 * Order is remove/reject before add/accept, so a single call can replace a tag
 * without the removal clobbering the addition.
 */
export function applyTagsBlock(
  record: Pick<UndertakingRecord, 'tags' | 'proposedTags'>,
  options: ApplyTagsOptions,
  vocabulary: TagVocabulary,
): ApplyTagsResult {
  const tags = [...record.tags]
  let proposed = [...record.proposedTags]
  const added: string[] = []
  const rejected: string[] = []

  const indexOf = (list: string[], tag: string): number =>
    list.findIndex(existing => normalizeTagBlock(existing) === normalizeTagBlock(tag))

  const drop = (list: string[], tag: string): void => {
    const at = indexOf(list, tag)
    if (at >= 0) list.splice(at, 1)
  }

  for (const tag of options.remove ?? []) drop(tags, tag)
  for (const tag of options.reject ?? []) drop(proposed, tag)

  const promote = (tag: string, fromProposed: boolean): void => {
    const normalized = normalizeTagBlock(tag)
    if (!normalized) return
    const display = resolveTagBlock(tag, vocabulary)
    if (!display) {
      if (!options.allowNew) {
        rejected.push(tag)
        return
      }
      added.push(tag.trim())
    }
    const value = display ?? tag.trim()
    if (indexOf(tags, value) < 0) tags.push(value)
    if (fromProposed) drop(proposed, tag)
  }

  for (const tag of options.accept ?? []) promote(tag, true)
  for (const tag of options.add ?? []) promote(tag, false)

  // A proposal that has been accepted by any route is no longer pending.
  proposed = proposed.filter(candidate => indexOf(tags, candidate) < 0)

  return { tags, proposedTags: proposed, added, rejected }
}

/** Merge newly accepted tags into the vocabulary, preserving existing order. */
export function extendVocabularyBlock(vocabulary: TagVocabulary, added: string[]): TagVocabulary {
  const tags = [...vocabulary.tags]
  for (const tag of added) {
    if (!resolveTagBlock(tag, { tags })) tags.push(tag.trim())
  }
  return { tags }
}
