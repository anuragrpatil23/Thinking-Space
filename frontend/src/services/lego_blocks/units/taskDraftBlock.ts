import yaml from 'js-yaml'

// Minting one new authored record — the composer's half of the store.
//
// The hard part is not the file, it is the address. Every project mints tickets
// in its own scheme (`F9-TT-E-767`, `TP-DA-T-108`) under its own hierarchy, and
// none of that is written down anywhere the app can read: it lives in the shape
// of the records already on disk. So a new record is minted **in the image of
// its siblings** — the ticket stem, the parent, the type, the level, the kind
// are all copied off the records already in that section, and only the identity
// fields (uuid, key, ticket, title, dates) are new.
//
// That is deliberate rather than lazy. Hardcoding a schema here would mean
// guessing at two projects' conventions and silently diverging from whatever
// the organizer CLI writes tomorrow; inheriting means the first record a
// project ever mints by hand looks exactly like the last one its CLI minted.

/**
 * Frontmatter a new record inherits from its siblings — everything that says
 * *what kind of thing this is and where it sits*, and nothing that identifies
 * one particular record.
 *
 * `owner` is not here: a record Anurag types into the composer is his, not the
 * agent that happened to write the sibling.
 */
const INHERITED_FIELDS = [
  'type',
  'level',
  'status',
  'parent',
  'parent_uuid',
  'parent_type',
  'record_kind',
  'task_kind',
  'project_root',
  'schema_version',
] as const

/** The inheritable shape of a sibling record, read off its raw markdown. Empty
 *  when the file has no frontmatter — the caller then has no template, which is
 *  a refusal to mint, not a reason to invent one. */
export function taskTemplateFromMarkdownBlock(raw: string): Record<string, unknown> {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return {}
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return {}
  const rest = trimmed.slice(afterOpen + 1)
  const close = /^---\s*$/m.exec(rest)
  if (!close) return {}
  let parsed: unknown
  try {
    parsed = yaml.load(rest.slice(0, close.index))
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const source = parsed as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const field of INHERITED_FIELDS) {
    if (source[field] !== undefined && source[field] !== null) out[field] = source[field]
  }
  return out
}

/**
 * The next free ticket in the scheme the given tickets are already using.
 *
 * A project's stem is not one value — Thinking Space has 308 `TP-DA-T`, 16
 * `TP-AF-T` and a stray `TP-PG-T` — so the most-used stem wins and the number
 * runs past the highest one in *that* stem. Ties break on the higher number, so
 * a project mid-migration between two stems grows the newer one.
 *
 * Returns '' when nothing in the list carries a `<stem>-<number>` shape. The
 * caller must refuse to mint rather than invent a scheme: an address the
 * project's own tools don't recognise is worse than no record.
 */
export function nextTaskTicketBlock(tickets: string[]): string {
  const maxByStem = new Map<string, number>()
  const countByStem = new Map<string, number>()
  for (const ticket of tickets) {
    const m = /^(.*)-(\d+)$/.exec(ticket.trim().toUpperCase())
    if (!m) continue
    const [, stem, digits] = m
    const n = Number(digits)
    countByStem.set(stem, (countByStem.get(stem) ?? 0) + 1)
    maxByStem.set(stem, Math.max(maxByStem.get(stem) ?? 0, n))
  }
  let best = ''
  for (const [stem, count] of countByStem) {
    if (!best) { best = stem; continue }
    const bestCount = countByStem.get(best) ?? 0
    if (count > bestCount) best = stem
    else if (count === bestCount && (maxByStem.get(stem) ?? 0) > (maxByStem.get(best) ?? 0)) best = stem
  }
  if (!best) return ''
  return `${best}-${(maxByStem.get(best) ?? 0) + 1}`
}

/** The record's key — its ticket plus a slug of the title, which is the shape
 *  every key in both stores already has. Capped so a paragraph typed into the
 *  title field can't produce a filename the OS refuses. */
export function taskFileKeyBlock(ticket: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  const base = ticket.toLowerCase()
  return slug ? `${base}-${slug}` : base
}

export interface TaskDraft {
  /** Inherited shape, from `taskTemplateFromMarkdownBlock`. */
  template: Record<string, unknown>
  uuid: string
  key: string
  ticket: string
  /** What Anurag typed — without the ticket prefix, which is added here. */
  title: string
  description: string
  /** ISO timestamp for both `created_at` and `updated_at`. */
  nowIso: string
  /** Rendered body, already sectioned (`## Description`). */
  body: string
}

/**
 * The whole file: inherited frontmatter, then the identity fields, then the
 * body.
 *
 * Identity is written last so it wins over anything the sibling carried under
 * the same name — a template that somehow kept a `key` must not hand this
 * record the sibling's address.
 */
export function renderTaskMarkdownBlock(draft: TaskDraft): string {
  // Declared empty first so identity keeps the top of the file — a record whose
  // key is buried under the inherited fields is harder to read in Obsidian, and
  // these files are read there as often as here. The spread cannot take those
  // slots because they are assigned *after* it: a template that somehow kept a
  // `key` must never hand this record the sibling's address.
  const front: Record<string, unknown> = {
    uuid: '',
    key: '',
    title: '',
    ...draft.template,
  }
  front.uuid = draft.uuid
  front.key = draft.key
  // Both stores prefix the title with the ticket. The row strips it back off
  // for display; keeping it here is what makes the file readable in Obsidian,
  // where there is no row to do the stripping.
  front.title = `${draft.ticket} - ${draft.title}`
  front.created_at = draft.nowIso
  front.updated_at = draft.nowIso
  // The frontmatter description is the one-line summary the CLI indexes on; the
  // body's `## Description` is the prose the drawer shows. They start out the
  // same and are allowed to diverge — nothing reads both.
  front.description = draft.description
  front.ticket = draft.ticket
  const yamlText = yaml.dump(front, { lineWidth: -1, quotingType: '"', forceQuotes: false }).trimEnd()
  const body = draft.body.trim()
  return `---\n${yamlText}\n---\n\n${body}${body ? '\n' : ''}`
}
