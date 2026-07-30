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
  /** Normalized category code from the key (QT, IDE, MIDE, IC, …). */
  categoryCode: string
  /** Human label for the category. */
  category: string
  /** ISO date the note was opened (`created_at`). */
  openedDate: string
  /** The note's own tags (`project_preset_tags`) — Anurag's confidence grid
   *  (`for sure for value`, `bucket 1`, …). Shown as pills on the row. */
  tags: string[]
  /** The plain ticket (`F9-QT-E-541`), derived from the slugged key. This is
   *  what `fed_by`/`produced` edges reference, so it's the join key — the key
   *  itself carries a title slug that edges don't. */
  ticket: string
}

const CATEGORY_LABELS: Record<string, string> = {
  QT: 'Questions to research',
  IDE: 'Ideas',
  MIDE: 'Missed ideas',
  IC: 'Interesting companies',
  KT: 'Key things',
  EL: 'Execution learnings',
  EM: 'Execution mistakes',
  EO: 'Execution opportunities',
  ET: 'Execution to-dos',
  TD: 'Too difficult',
  TT: 'Things to remember',
}

// Fold near-duplicate kinds onto one code: "Identified ideas" is just Ideas, and
// "Missed ideas" reads as a variant of Ideas (MIDE). The raw code comes from the
// historical key, which we never rewrite; the fold happens here on read.
const CODE_ALIASES: Record<string, string> = {
  II: 'IDE',
  MI: 'MIDE',
}

/** Category code embedded in a note key (`f9-qt-e-318` → `QT`), folded onto its
 *  canonical form, or '' if the key doesn't match the `<project>-<CODE>-E-<n>`
 *  shape. */
export function noteCategoryCodeBlock(key: string): string {
  const m = /^[a-z0-9]+-([a-z]+)-e-\d+/i.exec(key)
  if (!m) return ''
  const raw = m[1].toUpperCase()
  return CODE_ALIASES[raw] ?? raw
}

/** The plain ticket embedded in a slugged key (`f9-qt-e-541-history…` →
 *  `F9-QT-E-541`) — the form `fed_by`/`produced` edges use. Falls back to the
 *  whole key uppercased when it doesn't match the note shape. */
export function noteTicketBlock(key: string): string {
  const m = /^[a-z0-9]+-[a-z]+-e-\d+/i.exec(key)
  return (m ? m[0] : key).toUpperCase()
}

export function noteCategoryLabelBlock(code: string): string {
  return CATEGORY_LABELS[code] ?? (code || 'Other')
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
}

// The old organizer's title carries the ticket as a prefix ("F9-IDE-E-429 -
// MSFT is great value"). The ticket now lives on the detail page, so strip it
// for the row — but only when real text follows, so a title that is *only* a
// ticket doesn't collapse to nothing.
function stripTicketPrefix(title: string): string {
  const stripped = title.replace(/^[a-z0-9]+-[a-z]+-e-\d+\s*[-–—:]\s*/i, '').trim()
  return stripped || title
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
    title: stripTicketPrefix(asString(parsed.title) || key),
    categoryCode: code,
    category: noteCategoryLabelBlock(code),
    openedDate: asString(parsed.created_at).slice(0, 10),
    tags: asStringArray(parsed.project_preset_tags),
    ticket: noteTicketBlock(key),
  }
}
