// Day-strip helpers for the AI-activity heatmap: the range predicate that
// decides between a week grid and a day strip, and the date formatting its
// heading uses. Lives here rather than in the block because the panel needs
// both — the section header changes shape with the layout, so the two must
// agree on one predicate — and a component file that also exports functions
// breaks fast refresh.

/** Longest range still rendered as a strip of days rather than a grid of
 *  weeks. At a fortnight or less the week-over-week comparison the grid exists
 *  for has nothing to compare, and padding out to whole weeks renders more
 *  empty cells than real ones. */
export const STRIP_MAX_DAYS_BLOCK = 14

/** Whether a range is short enough to render as a day strip rather than a week
 *  grid. Exported because the panel's section header changes with it — the
 *  strip carries its own date heading, so "Heatmap" would be a second title
 *  over one row of days. Both sides must agree, so they share this predicate. */
export function isStripRangeBlock(startIso: string, endIso: string): boolean {
  const a = Date.parse(startIso + 'T00:00:00')
  const b = Date.parse(endIso + 'T00:00:00')
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return Math.round((b - a) / 86_400_000) + 1 <= STRIP_MAX_DAYS_BLOCK
}

/** Day, its ordinal suffix, and month for a date heading — no weekday. The
 *  suffix is split out rather than concatenated so the heading can set it a
 *  size down from the numeral; "18th" with both at 52px reads as a word, and
 *  the numeral is what should carry the line. Suffix is English-only, like the
 *  rest of the card's copy. */
export function fmtDayMonthBlock(iso: string): {
  day: string
  ordinal: string
  month: string
} {
  const d = new Date(iso + 'T00:00:00')
  const month = d.toLocaleDateString(undefined, { month: 'short' })
  const year = d.getFullYear()
  const n = d.getDate()
  const teen = n % 100 >= 11 && n % 100 <= 13
  const ordinal = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return {
    day: String(n),
    ordinal,
    month: year === new Date().getFullYear() ? month : `${month} ${year}`,
  }
}
/** Strip cells grow into the card's width instead of sitting at one size: a
 *  7-column strip at a fixed 44px huddles in the left third of a wide panel.
 *  Capped, because past ~56px the cell stops reading as a day and starts
 *  reading as a tile with a lot of empty middle. */
