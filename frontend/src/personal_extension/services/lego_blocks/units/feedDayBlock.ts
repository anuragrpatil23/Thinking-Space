// The Feed's day: every view of the Feed shows one day, today unless another
// was picked. Days are local YYYY-MM-DD; a day after today is not a day the
// Feed can show.

const DAY_PATTERN_BLOCK = /^\d{4}-\d{2}-\d{2}$/

export function feedDayKeyBlock(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A picked day from the page address, or null for today (or anything that is not a past day). */
export function parseFeedDayBlock(raw: string | null, today: string): string | null {
  if (!raw || !DAY_PATTERN_BLOCK.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00`))) return null
  return raw < today ? raw : null
}

/** The day `delta` days from `day` (noon, so a clock change never skips one). */
export function shiftFeedDayBlock(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return feedDayKeyBlock(d)
}

/** The `count` days ending with `day`, oldest first. */
export function feedDaysEndingBlock(day: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftFeedDayBlock(day, i - count + 1))
}

/** Whole days from `day` back to `today`: 0 for today. */
export function feedDaysAgoBlock(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86_400_000)
}

/** The last moment of a past day, or now for today: what "so far" means on that day. */
export function feedDayNowBlock(day: string, now = new Date()): Date {
  if (day >= feedDayKeyBlock(now)) return now
  return new Date(`${day}T23:59:59.999`)
}

/** "Thu, Oct 29", for headings that name a day that is not today. */
export function feedDayShortLabelBlock(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
