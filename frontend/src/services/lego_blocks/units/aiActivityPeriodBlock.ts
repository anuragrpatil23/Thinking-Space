import type { ProjectDayAtom } from './aiActivityAtomBlock'

// Rhythm math for AI Activity atoms. Atoms are stored per-day; this block
// tells the view layer how to group them into the user's chosen rhythm.
// Pure — no I/O, no date-fns, uses the same JS `Date` semantics that the
// existing set-mode trend chart uses so boundaries line up exactly.

export type AiActivityPeriodType = 'week' | 'set'

export interface AiActivityPeriod {
  type: AiActivityPeriodType
  /** Stable id for cache / URL: `2026-W27` or `2026-06-set-3`. */
  id: string
  /** ISO calendar date (`YYYY-MM-DD`), inclusive. */
  startDate: string
  /** ISO calendar date (`YYYY-MM-DD`), inclusive. */
  endDate: string
  /** All calendar dates in the period, in order. */
  dates: string[]
}

// ── Date helpers (mirror the existing set-mode chart) ────────────────────

function toLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysLocal(dateStr: string, days: number): string {
  const d = toLocalDate(dateStr)
  d.setDate(d.getDate() + days)
  return isoDayLocal(d)
}

// ── Week (Monday-anchored, matching gitInsightsBlock.weekStart) ──────────

function weekStartFor(dateStr: string): string {
  const d = toLocalDate(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = 0
  d.setDate(d.getDate() - diff)
  return isoDayLocal(d)
}

function isoWeekId(dateStr: string): string {
  // ISO week number computed from the Thursday of the target week — matches
  // the standard ISO 8601 definition that most week pickers use.
  const d = toLocalDate(dateStr)
  const day = d.getDay() || 7
  d.setDate(d.getDate() + 4 - day)
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

export function weekPeriodContaining(dateStr: string): AiActivityPeriod {
  const start = weekStartFor(dateStr)
  const end = addDaysLocal(start, 6)
  return {
    type: 'week',
    id: isoWeekId(start),
    startDate: start,
    endDate: end,
    dates: enumerateDates(start, end),
  }
}

// ── Set (month-anchored 3-day block, matching AiActivityTrendChartBlock) ─

function setPeriodParts(dateStr: string) {
  const d = toLocalDate(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth()
  const day = d.getDate()
  const setNumber = Math.floor((day - 1) / 3) + 1
  const startDay = 3 * (setNumber - 1) + 1
  const monthLen = new Date(year, month + 1, 0).getDate()
  const endDay = Math.min(3 * setNumber, monthLen)
  return { year, month, setNumber, startDay, endDay }
}

export function setPeriodContaining(dateStr: string): AiActivityPeriod {
  const { year, month, setNumber, startDay, endDay } = setPeriodParts(dateStr)
  const start = isoDayLocal(new Date(year, month, startDay))
  const end = isoDayLocal(new Date(year, month, endDay))
  return {
    type: 'set',
    id: `${year}-${String(month + 1).padStart(2, '0')}-set-${setNumber}`,
    startDate: start,
    endDate: end,
    dates: enumerateDates(start, end),
  }
}

// ── Enumeration + grouping ───────────────────────────────────────────────

function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  let cursor = startIso
  while (cursor <= endIso) {
    out.push(cursor)
    cursor = addDaysLocal(cursor, 1)
  }
  return out
}

export function periodContaining(
  dateStr: string,
  type: AiActivityPeriodType,
): AiActivityPeriod {
  return type === 'week' ? weekPeriodContaining(dateStr) : setPeriodContaining(dateStr)
}

/**
 * Group atoms into consecutive periods of the given type. Atoms outside any
 * emitted period are dropped — callers pass the range they want covered by
 * passing atoms from that range. Order preserved by start date ascending.
 */
export function groupAtomsByPeriodBlock(
  atoms: ProjectDayAtom[],
  type: AiActivityPeriodType,
): Array<{ period: AiActivityPeriod; atoms: ProjectDayAtom[] }> {
  if (atoms.length === 0) return []
  const byId = new Map<string, { period: AiActivityPeriod; atoms: ProjectDayAtom[] }>()
  for (const atom of atoms) {
    const period = periodContaining(atom.date, type)
    let bucket = byId.get(period.id)
    if (!bucket) {
      bucket = { period, atoms: [] }
      byId.set(period.id, bucket)
    }
    bucket.atoms.push(atom)
  }
  const sorted = Array.from(byId.values()).sort((a, b) =>
    a.period.startDate < b.period.startDate ? -1 : 1,
  )
  for (const bucket of sorted) {
    bucket.atoms.sort((a, b) => (a.date < b.date ? -1 : 1))
  }
  return sorted
}
