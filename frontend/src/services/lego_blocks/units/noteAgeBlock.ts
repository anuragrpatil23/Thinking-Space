// How old a note is, as one short token.
//
// Notes sort by when they were opened — in the index and in the wake list both —
// so a list with no age on it is in a meaningful order with nothing on screen
// saying what that order is. The label is deliberately coarse: for an open loop
// the fact you need is "recent or stale", not the calendar date.
//
// Days up to 45, then months: past six weeks the day count stops being a number
// you reason with and becomes one you have to divide.

const DAY_MS = 86_400_000

/** `''` when the date is missing or unparseable — a wrong age is worse than
 *  none, and the callers all render nothing for the empty string. */
export function noteAgeLabelBlock(openedDate: string, nowMs: number = Date.now()): string {
  if (!openedDate) return ''
  const opened = Date.parse(openedDate)
  if (Number.isNaN(opened)) return ''
  const days = Math.max(0, Math.floor((nowMs - opened) / DAY_MS))
  if (days < 45) return `${days}d`
  const months = days / 30.4
  return `${months.toFixed(months < 10 ? 1 : 0)} mo`
}
