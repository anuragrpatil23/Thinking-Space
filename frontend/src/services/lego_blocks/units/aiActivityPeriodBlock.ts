
// Rhythm math for AI Activity date ranges: which week / set / month a date
// falls in, and how to decompose an arbitrary span into subunits. Tells the
// view and the range composer how to group by the user's chosen rhythm.
// Pure — no I/O, no date-fns, uses the same JS `Date` semantics that the
// existing set-mode trend chart uses so boundaries line up exactly.

export type AiActivityPeriodType = 'week' | 'set' | 'month'

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

// ── Month (calendar month, YYYY-MM-01 → last day of month) ─────────────

function monthPeriodParts(dateStr: string) {
  const d = toLocalDate(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth()
  const start = isoDayLocal(new Date(year, month, 1))
  const end = isoDayLocal(new Date(year, month + 1, 0))
  return { year, month, start, end }
}

export function monthPeriodContaining(dateStr: string): AiActivityPeriod {
  const { year, month, start, end } = monthPeriodParts(dateStr)
  return {
    type: 'month',
    id: `${year}-${String(month + 1).padStart(2, '0')}`,
    startDate: start,
    endDate: end,
    dates: enumerateDates(start, end),
  }
}

// ── Range decomposition ────────────────────────────────────────────────

export type RangeSubunitType = 'month' | 'week' | 'day'

export interface RangeSubunit {
  type: RangeSubunitType
  /** Same id convention as AiActivityPeriod (`YYYY-MM` / `YYYY-Www` / `YYYY-MM-DD`). */
  id: string
  startDate: string
  endDate: string
}

/**
 * Peel a `[startDate, endDate]` range (inclusive, ISO day strings) into
 * fixed subunits. Two-pass to prefer the coarsest unit that fully fits:
 *
 *  1. Find the "month spine" — the widest window of consecutive whole
 *     calendar months fully contained in the range. Emit each as a month
 *     subunit.
 *  2. For the leading + trailing edges around the spine, find the "week
 *     spine" — widest window of whole ISO weeks (Mon..Sun) inside the
 *     edge. Emit each as a week subunit.
 *  3. The remaining un-covered days at each edge become day subunits.
 *
 * Used by the decomposed-range summary path so any arbitrary user-picked
 * range reuses already-generated month/week/day summaries and only pays
 * model cost for the top-level compose step.
 *
 * Ordering: subunits are returned in chronological order by `startDate`.
 * Adjacent subunits never overlap; together they cover exactly the input
 * range with no gaps.
 */
export interface DecomposeRangeOptions {
  /** When false, skip the month spine step entirely — the range is peeled
   *  into weeks + days only. Used when the caller is itself decomposing a
   *  whole-month range and would otherwise recurse into itself. */
  allowMonthSubunits?: boolean
}

export function decomposeRangeIntoSubunitsBlock(
  startDate: string,
  endDate: string,
  options: DecomposeRangeOptions = {},
): RangeSubunit[] {
  const allowMonths = options.allowMonthSubunits ?? true
  if (startDate > endDate) return []

  // ── Month spine ────────────────────────────────────────────────
  // First candidate month = the month that contains startDate. Use it
  // only if the range covers its full extent (startDate ≤ its 1st AND
  // endDate ≥ its last day).
  let monthSpineStart: string | null = null
  let monthSpineEnd: string | null = null
  if (allowMonths) {
    // First whole month at/after startDate.
    const firstCandidate = monthPeriodContaining(startDate)
    const firstStart =
      startDate === firstCandidate.startDate
        ? firstCandidate.startDate
        : monthPeriodContaining(addDaysLocal(firstCandidate.endDate, 1)).startDate
    // Last whole month at/before endDate.
    const lastCandidate = monthPeriodContaining(endDate)
    const lastEnd =
      endDate === lastCandidate.endDate
        ? lastCandidate.endDate
        : (() => {
            // Step back to the previous month's end.
            const prevDay = addDaysLocal(lastCandidate.startDate, -1)
            return prevDay < startDate ? '' : monthPeriodContaining(prevDay).endDate
          })()
    if (firstStart <= endDate && lastEnd >= firstStart && lastEnd !== '') {
      monthSpineStart = firstStart
      monthSpineEnd = lastEnd
    }
  }

  const subunits: RangeSubunit[] = []
  const emitEdge = (edgeStart: string, edgeEnd: string) => {
    if (edgeStart > edgeEnd) return
    // Week spine inside the edge: first Monday at/after edgeStart, last
    // Sunday at/before edgeEnd.
    const firstWeek = weekPeriodContaining(edgeStart)
    const weekSpineStart =
      edgeStart === firstWeek.startDate
        ? firstWeek.startDate
        : addDaysLocal(firstWeek.endDate, 1) // next Monday
    const lastWeek = weekPeriodContaining(edgeEnd)
    const weekSpineEnd =
      edgeEnd === lastWeek.endDate
        ? lastWeek.endDate
        : addDaysLocal(lastWeek.startDate, -1) // previous Sunday
    const haveWeekSpine =
      weekSpineStart <= edgeEnd &&
      weekSpineEnd >= edgeStart &&
      weekSpineStart <= weekSpineEnd
    // Leading days before week spine.
    const leadingDaysEnd = haveWeekSpine ? addDaysLocal(weekSpineStart, -1) : edgeEnd
    for (let d = edgeStart; d <= leadingDaysEnd; d = addDaysLocal(d, 1)) {
      subunits.push({ type: 'day', id: d, startDate: d, endDate: d })
    }
    // Week spine.
    if (haveWeekSpine) {
      for (let mon = weekSpineStart; mon <= weekSpineEnd; mon = addDaysLocal(mon, 7)) {
        const wk = weekPeriodContaining(mon)
        subunits.push({
          type: 'week',
          id: wk.id,
          startDate: wk.startDate,
          endDate: wk.endDate,
        })
      }
      // Trailing days after week spine.
      const trailStart = addDaysLocal(weekSpineEnd, 1)
      for (let d = trailStart; d <= edgeEnd; d = addDaysLocal(d, 1)) {
        subunits.push({ type: 'day', id: d, startDate: d, endDate: d })
      }
    }
  }

  if (monthSpineStart && monthSpineEnd) {
    emitEdge(startDate, addDaysLocal(monthSpineStart, -1))
    for (let m = monthSpineStart; m <= monthSpineEnd; ) {
      const month = monthPeriodContaining(m)
      subunits.push({
        type: 'month',
        id: month.id,
        startDate: month.startDate,
        endDate: month.endDate,
      })
      m = addDaysLocal(month.endDate, 1)
    }
    emitEdge(addDaysLocal(monthSpineEnd, 1), endDate)
  } else {
    emitEdge(startDate, endDate)
  }
  return subunits
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
  if (type === 'week') return weekPeriodContaining(dateStr)
  if (type === 'month') return monthPeriodContaining(dateStr)
  return setPeriodContaining(dateStr)
}
