import yaml from 'js-yaml'

// A "task" is a record from the OLD organizer — a question, idea, missed idea,
// or company-to-study that Anurag wrote by hand, mostly before the chains
// begin (2026-05-18). Tasks are the hand-written half of the loop; undertakings
// are the derived doing half. They are never migrated into undertakings (that
// would give them permanently empty tails and destroy the fact that a task can
// stay open). They are read here and joined to undertakings by `fed_by` edges.
//
// The kind lives in `task_kind` on the record, falling back to the code encoded
// in the key (`F9-QT-E-318` → QT → "Questions to research") for anything not yet
// backfilled.
//
// Disposition is `task_status`, falling back to `status`. The reader used to
// drop both, on a finding that `status` was stuck permanently on "active" —
// true of F9's 49 records (46 active) and false of Thinking Space's 325, where
// it reads 274 done / 41 in progress / 9 ready / 1 blocked. Those are two kinds
// of record wearing one schema: F9's are thinking (an idea has no lifecycle to
// finish), Thinking Space's are work. Dropping the field meant 274 finished
// items rendering as open loops, each with an age quietly asking why it had
// been sitting since February.
//
// The two status fields are one field. `status` was a strict coarsening of
// `task_status` (completed↔done, active↔in_progress/ready, paused↔blocked) with
// zero disagreements across all 325, so it is gone from the store and survives
// here only as the fallback for F9, which never had `task_status`.
//
// Done is *not* the same as engaged. Engagement (◇/◆) says whether a task
// belongs to an undertaking; disposition says whether it is finished. 48
// Thinking Space tasks are attached to an undertaking and still open — you
// attach a task when the work belongs to that strand, which is when it starts.

export interface Task {
  key: string
  title: string
  /** Normalized category code from the key (QT, IDE, MIDE, IC, …). */
  categoryCode: string
  /** Human label for the category. */
  category: string
  /** ISO date the task was opened (`created_at`). */
  openedDate: string
  /** The task's own tags (`project_preset_tags`) — Anurag's confidence grid
   *  (`for sure for value`, `bucket 1`, …). Shown as pills on the row. */
  tags: string[]
  /** The plain ticket (`F9-QT-E-541`), derived from the slugged key. This is
   *  what `fed_by`/`produced` edges reference, so it's the join key — the key
   *  itself carries a title slug that edges don't. */
  ticket: string
  /** Where the task stands, lowercased and unmapped (`done`, `in_progress`,
   *  `ready`, `blocked`). Empty for a record that states none — which is not
   *  the same as open, and is why this isn't a boolean. */
  disposition: string
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
  TAX: 'Tax',
}

// Fold near-duplicate kinds onto one code: "Identified ideas" is just Ideas, and
// "Missed ideas" reads as a variant of Ideas (MIDE). The raw code comes from the
// historical key, which we never rewrite; the fold happens here on read.
const CODE_ALIASES: Record<string, string> = {
  II: 'IDE',
  MI: 'MIDE',
}

/**
 * The kind, read from the record rather than from its name.
 *
 * The code used to live only in the key, which is fine while keys are never
 * rewritten and every record is legacy — and stops being fine at exactly the
 * moment of migration. A re-minted record has no `F9-QT-E-###` shape to parse,
 * so its kind would evaporate silently, and a record created tomorrow could not
 * carry a kind at all. Deriving meaning out of an address is the mirror of the
 * rule that forbids deriving the address itself.
 *
 * So `task_kind` in the frontmatter is the truth, and the key parse stays as
 * the fallback for anything not yet backfilled. Aliases fold on both paths, so
 * a declared `II` and a parsed `II` land on the same `IDE`.
 */
export function taskKindCodeBlock(declared: unknown, key: string): string {
  const raw = (typeof declared === 'string' ? declared : '').trim().toUpperCase()
  if (raw) return CODE_ALIASES[raw] ?? raw
  return taskCategoryCodeBlock(key)
}

/** Category code embedded in a task key (`f9-qt-e-318` → `QT`), folded onto its
 *  canonical form, or '' if the key doesn't match the `<project>-<CODE>-E-<n>`
 *  shape. */
export function taskCategoryCodeBlock(key: string): string {
  const m = /^[a-z0-9]+-([a-z]+)-e-\d+/i.exec(key)
  if (!m) return ''
  const raw = m[1].toUpperCase()
  return CODE_ALIASES[raw] ?? raw
}

/**
 * The plain ticket embedded in a slugged key (`f9-qt-e-541-history…` →
 * `F9-QT-E-541`) — the form `fed_by`/`produced` edges use. Falls back to the
 * whole key uppercased when it doesn't match the task shape.
 *
 * The type segment is any single letter, not a literal `e`. F9 mints epics
 * (`F9-QT-E-541`) and Thinking Space mints tasks (`TP-AF-T-108`); pinning the
 * letter meant every Thinking Space ticket came back as the entire slug, so no
 * `fed_by` edge could ever match one and 325 tasks silently failed to join the
 * undertakings that fed on them. An address parser that works on one project's
 * addresses is not a parser.
 */
export function taskTicketBlock(key: string): string {
  const m = /^[a-z0-9]+-[a-z]+-[a-z]-\d+/i.exec(key)
  return (m ? m[0] : key).toUpperCase()
}

/** A kind's display name. An unlabelled code is title-cased rather than passed
 *  through raw: headings are names now, and a bare `TAX` sitting among "Ideas"
 *  and "Key things" reads as a bug, not as a kind. Uppercase headings used to
 *  hide the gap — every label looked like a code, so a code looked like a
 *  label. Add the kind to the table when one turns up; this only keeps the
 *  unlabelled case from looking broken. */
export function taskCategoryLabelBlock(code: string): string {
  const known = CATEGORY_LABELS[code]
  if (known) return known
  // No code at all is not a gap — it is a project whose records simply have no
  // kinds. Thinking Space is one: 325 rows that are all just tasks, where F9 has
  // twelve species. "Other" was right when every record was expected to carry a
  // code and a blank meant something had gone wrong.
  if (!code) return 'Tasks'
  return code.charAt(0) + code.slice(1).toLowerCase()
}

// Reference kinds are captured knowledge — Key things, Things to remember,
// Execution learnings/mistakes, Missed ideas (permanent lessons). They never
// have an open→worked lifecycle, so they don't wear the ◇/◆ engagement glyph
// (an "open" mark would be meaningless on a record). Every other kind is an
// open loop that can sit untouched (◇) or be engaged (◆).
const REFERENCE_TASK_CODES = new Set(['KT', 'TT', 'EL', 'EM', 'MIDE'])

/** True when the task is captured knowledge rather than an open loop — so the
 *  row shows no open/engaged glyph (its `→`/`←` link, if any, still shows). */
export function taskIsReferenceBlock(code: string): boolean {
  return REFERENCE_TASK_CODES.has(code)
}

// The finished dispositions. Both words appear because the two stores name the
// same state differently — Thinking Space's `task_status: done`, F9's fallback
// `status: completed` — and neither is worth rewriting to agree.
const DONE_DISPOSITIONS = new Set(['done', 'completed'])

/** True when the task is finished. A finished task wears no age (it is not late
 *  for anything) and no open-loop glyph. */
export function taskIsDoneBlock(disposition: string): boolean {
  return DONE_DISPOSITIONS.has(disposition)
}

/** The disposition, from `task_status` with `status` behind it. Lowercased so
 *  the two stores' casing can't produce two states with one meaning. */
export function taskDispositionBlock(taskStatus: unknown, status: unknown): string {
  const primary = (typeof taskStatus === 'string' ? taskStatus : '').trim().toLowerCase()
  if (primary) return primary
  return (typeof status === 'string' ? status : '').trim().toLowerCase()
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
//
// Any type letter, not a literal `e`, for the same reason `taskTicketBlock`
// takes any: pinned to `e` this only stripped F9's epics, so every one of
// Thinking Space's task rows printed its own address in front of its title.
function stripTicketPrefix(title: string): string {
  const stripped = title.replace(/^[a-z0-9]+-[a-z]+-[a-z]-\d+\s*[-–—:]\s*/i, '').trim()
  return stripped || title
}

/** Parse one old-organizer epic file into a Task. Null when it isn't an epic
 *  or has no key — hand-editable files must not take the reader down. */
export function parseTaskMarkdownBlock(content: string): Task | null {
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
  // Only epics are tasks; programs/thoughts/idea_buckets are structure. `task`
  // is accepted alongside `epic` so the record_kind migration can run without
  // this reader going blind on the day it flips.
  const recordKind = asString(parsed.record_kind)
  if (recordKind && recordKind !== 'epic' && recordKind !== 'task') return null

  const code = taskKindCodeBlock(parsed.task_kind, key)
  return {
    key,
    title: stripTicketPrefix(asString(parsed.title) || key),
    categoryCode: code,
    category: taskCategoryLabelBlock(code),
    openedDate: asString(parsed.created_at).slice(0, 10),
    // One universal tag field. `project_preset_tags` was retired — the vault
    // migration merged it into `tags`.
    tags: asStringArray(parsed.tags),
    // The record's own `ticket` wins over the one parsed out of its key. The
    // ticket is an address, and a record that states its address is telling the
    // truth about it; the key parse is the fallback for records that don't.
    ticket: asString(parsed.ticket).trim().toUpperCase() || taskTicketBlock(key),
    disposition: taskDispositionBlock(parsed.task_status, parsed.status),
  }
}

/**
 * The markdown after the frontmatter — a task's own words.
 *
 * Separate from `parseTaskMarkdownBlock` because the index reads every task in
 * the project on every load and never wants the body; only the drawer, opening
 * one task, does.
 */
export function taskBodyBlock(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return ''
  const rest = trimmed.slice(afterOpen + 1)
  const close = /^---\s*$/m.exec(rest)
  if (!close) return ''
  return rest.slice(close.index + close[0].length).replace(/^\n+/, '')
}
