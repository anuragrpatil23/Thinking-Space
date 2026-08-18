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
  /** Everything that fed this undertaking: the old organizer's tasks it took up
   *  (keys like `F9-QT-E-318`) and chain-strands filed elsewhere that carry work
   *  for it (keys like `F9::native/…`). The two are told apart by shape. A task
   *  that fed no undertaking is, by that fact, still open — the wake list. */
  fedBy: string[]
  /** Tasks this undertaking produced — new questions or findings the work threw
   *  up. Pointers to task keys; the task's own kind says whether it's still to
   *  explore. */
  produced: string[]
  /** Chains that primarily belong to this undertaking. Pointers, not content. */
  chains: string[]
  /** Vault/repo pointers — the index's page numbers. */
  files: string[]
  /** Provenance: which pass created this record. */
  origin: string
  /**
   * This record is a *bucket*, not real work — the per-project
   * "not an undertaking" pile that a chain lands in when the judgement was that
   * it isn't worth an undertaking (a two-minute lookup, an abandoned attempt).
   *
   * Deliberately an ordinary undertaking with a flag rather than a `dismissed`
   * boolean on the chain. A second axis would have to be learned by every
   * reader, filter and count, and "where does this chain belong" would stop
   * having one answer; un-dismissing would be its own operation instead of the
   * remove-chain that every other retarget already is. What the flag buys is
   * narrow and stated once: keep the pile out of calibration stats and out of
   * the DAG, so it can't masquerade as throughput. See
   * [ASSIGNMENT.md](../../../../../docs/contracts/ASSIGNMENT.md).
   */
  bucket: boolean
  /** The head. One line: what came out. The first paragraph of the body. */
  head: string
  /** Margin comments — Anurag's annotations over time. They live in the *body*
   *  under a `## Comments` heading, not in YAML: they are prose he reads and edits
   *  in Obsidian, and YAML is machine-only. Newest first. */
  comments: UndertakingComment[]
}

/** One margin comment on an undertaking. Stored in the body as a paragraph led by
 *  `**YYYY-MM-DD**` (optionally `· Author`); a hand-typed paragraph with no such
 *  lead parses as an undated comment so an Obsidian edit never breaks. */
export interface UndertakingComment {
  /** `YYYY-MM-DD`, or '' for a hand-typed undated comment. */
  date: string
  /** Author after the date (`· Kai`); '' means the default single user. */
  author: string
  /** The comment prose (markdown). */
  text: string
}

export const UNDERTAKING_RECORD_KIND = 'undertaking'

/** The heading that splits head (above) from comments (below) in the body. */
const COMMENTS_HEADING_RE = /^[ \t]*##[ \t]+Comments[ \t]*$/m
/** A comment paragraph's lead: `**2026-07-31** — text` or, with an author,
 *  `**2026-07-31** · Kai — text`. The `—`/`-` separator is required so the
 *  author group binds to the whole name rather than its first letter; a block
 *  without this exact shape parses as an undated comment. */
const COMMENT_LEAD_RE = /^\*\*(\d{4}-\d{2}-\d{2})\*\*(?:[ \t]*·[ \t]*(.+?))?[ \t]*[—-][ \t]+/

/** Split a `## Comments` region into structured comments: one per blank-line-separated
 *  paragraph. A `**date**` lead makes it dated; anything else — a paragraph typed
 *  straight into Obsidian — parses as an undated comment rather than being dropped
 *  or glued to its neighbour. One block ⇒ one comment keeps the round-trip exact. */
function parseCommentsRegionBlock(region: string): UndertakingComment[] {
  const blocks = region.split(/\n[ \t]*\n/).map(b => b.trim()).filter(Boolean)
  return blocks.map(block => {
    const lead = COMMENT_LEAD_RE.exec(block)
    return lead
      ? { date: lead[1], author: (lead[2] ?? '').trim(), text: block.slice(lead[0].length).trim() }
      : { date: '', author: '', text: block }
  })
}

/** Render one comment back to its body paragraph. Internal blank lines are collapsed
 *  so a comment stays a single block — the invariant `parseCommentsRegionBlock` relies on
 *  (one block ⇒ one comment), so a comment can never split itself on the next read. */
function serializeCommentBlock(comment: UndertakingComment): string {
  const text = comment.text.replace(/\n[ \t]*\n+/g, '\n').trim()
  if (!comment.date && !comment.author) return text
  const prefix = comment.author ? `**${comment.date}** · ${comment.author}` : `**${comment.date}**`
  return `${prefix} — ${text}`
}

/** Assemble the body from its two halves: head on top, a `## Comments` section
 *  below when there are any. The one place the body's shape is defined. */
export function buildUndertakingBodyBlock(head: string, comments: UndertakingComment[]): string {
  const h = head.trim()
  if (!comments.length) return h
  const rendered = comments.map(serializeCommentBlock).join('\n\n')
  return h ? `${h}\n\n## Comments\n\n${rendered}` : `## Comments\n\n${rendered}`
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

/**
 * A key for a new undertaking: `<project>-und-<title-slug>`, matching the
 * migration's form (`f9-und-cerebras-wafer-scale`).
 *
 * Minted once from the title and frozen there. The title is free to change
 * afterwards and the key must not follow it: the key is the address — chains
 * point at it, records file under it — so re-deriving it on a rename would
 * orphan every pointer (DERIVATION.md, first rule). That is also why renaming
 * is the queue's cheap correction and re-keying is not offered at all.
 *
 * De-duplicated against the keys already in use, so two undertakings that
 * happen to be named alike get separate addresses rather than one shared file.
 */
/**
 * Undertakings whose titles resemble a proposed new one.
 *
 * Exists because minting is the one irreversible move in this feature — a key
 * is an address — and the in-session ask had no way to notice it was about to
 * mint a second address for a strand that already had one. `assignmentDraftOrch`
 * already hands a model the existing titles before it drafts, for exactly this
 * reason; an agent calling `assignment.record` from a terminal sees nothing.
 *
 * Deliberately lexical and deliberately dumb. This is not trying to decide
 * whether two strands are the same piece of work — a human decides that, from
 * the queue, with the resemblance shown next to the mint. It only has to be
 * good enough to surface "this looks like The Cognition Tide" and quiet enough
 * that it does not cry wolf on every title sharing the word "the".
 *
 * Advisory only. Nothing here blocks a mint: a genuinely new strand may
 * legitimately resemble its neighbours, and refusing it would be worse than the
 * duplicate it prevents.
 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of',
  'on', 'or', 'the', 'to', 'vs', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
])

function titleTokensBlock(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !TITLE_STOPWORDS.has(word))
  return new Set(words)
}

/** Jaccard over content words. Symmetric, so a short title cannot score high
 *  merely by being a subset of a long one — which is what made an earlier
 *  overlap-over-shortest scoring flag every two-word title as a duplicate. */
export function titleSimilarityBlock(a: string, b: string): number {
  const left = titleTokensBlock(a)
  const right = titleTokensBlock(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

export const SIMILAR_TITLE_THRESHOLD = 0.34

export function similarUndertakingsBlock(
  title: string,
  records: ReadonlyArray<{ key: string; title: string }>,
  limit = 3,
): Array<{ key: string; title: string }> {
  return records
    .map(record => ({ record, score: titleSimilarityBlock(title, record.title) }))
    .filter(entry => entry.score >= SIMILAR_TITLE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.record.key.localeCompare(b.record.key))
    .slice(0, limit)
    .map(entry => ({ key: entry.record.key, title: entry.record.title }))
}

export function undertakingKeyFromTitleBlock(
  projectId: string,
  title: string,
  existingKeys: string[],
): string {
  const slug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const base = `${slug(projectId) || 'p'}-und-${slug(title) || 'undertaking'}`
  const taken = new Set(existingKeys)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
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
  // The body carries the head (first paragraph) and, below a `## Comments` heading,
  // the margin comments. A record with no such heading is all head — which is every
  // record written before comments existed, so they keep loading unchanged.
  const commentsHeading = COMMENTS_HEADING_RE.exec(body)
  const head = (commentsHeading ? body.slice(0, commentsHeading.index) : body).trim()
  const comments = commentsHeading
    ? parseCommentsRegionBlock(body.slice(commentsHeading.index + commentsHeading[0].length))
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
    // `fed_by` merges what were once two fields: `discharges` (tasks) and
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
    bucket: parsed.bucket === true,
    head,
    comments,
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
  // Same reasoning: `bucket: false` is the ordinary case, not a recorded gap.
  // Emitting it on every record would also make the flag look like a dimension
  // records are expected to vary along, when there is exactly one per project.
  if (record.bucket) frontmatter.bucket = true

  const yamlStr = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' })
    .trimEnd()

  const body = buildUndertakingBodyBlock(record.head, record.comments)
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
