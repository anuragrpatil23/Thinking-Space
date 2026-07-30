import yaml from 'js-yaml'

// A "note" is a record from the OLD organizer — a question, idea, missed idea,
// or company-to-study that Anurag wrote by hand, mostly before the chains
// begin (2026-05-18). Notes are the hand-written half of the loop; undertakings
// are the derived doing half. They are never migrated into undertakings (that
// would give them permanently empty tails and destroy the fact that a note can
// stay open). They are read here and joined to undertakings by `fed_by` edges.
//
// The category is encoded in the key: `F9-QT-E-318` → QT → "Questions to
// research". That is more reliable than the old `status` field, which the
// design found stuck permanently on "active".

export interface Note {
  key: string
  title: string
  /** Category code from the key (QT, IDE, MI, IC, …). */
  categoryCode: string
  /** Human label for the category. */
  category: string
  /** ISO date the note was opened (`created_at`). */
  openedDate: string
}

const CATEGORY_LABELS: Record<string, string> = {
  QT: 'Questions to research',
  IDE: 'Ideas',
  II: 'Identified ideas',
  MI: 'Missed ideas',
  IC: 'Interesting companies',
  KT: 'Key things',
  EL: 'Execution learnings',
  EM: 'Execution mistakes',
  EO: 'Execution opportunities',
  ET: 'Execution to-dos',
  TD: 'Too difficult',
  TT: 'Things to remember',
  TAX: 'Tax',
}

/** Category code embedded in a note key (`f9-qt-e-318` → `QT`), or '' if the
 *  key doesn't match the old organizer's `<project>-<CODE>-E-<n>` shape. */
export function noteCategoryCodeBlock(key: string): string {
  const m = /^[a-z0-9]+-([a-z]+)-e-\d+/i.exec(key)
  return m ? m[1].toUpperCase() : ''
}

export function noteCategoryLabelBlock(code: string): string {
  return CATEGORY_LABELS[code] ?? (code || 'Other')
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Parse one old-organizer epic file into an Note. Null when it isn't an epic
 *  or has no key — hand-editable files must not take the reader down. */
export function parseNoteMarkdownBlock(content: string): Note | null {
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
  if (!key) return null
  // Only epics are notes; programs/thoughts/idea_buckets are structure.
  if (asString(parsed.record_kind) && asString(parsed.record_kind) !== 'epic') return null

  const code = noteCategoryCodeBlock(key)
  return {
    key,
    title: asString(parsed.title) || key,
    categoryCode: code,
    category: noteCategoryLabelBlock(code),
    openedDate: asString(parsed.created_at).slice(0, 10),
  }
}
