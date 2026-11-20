// How far a day is from today, the one way it is counted everywhere (the
// positions table's Expiry column, every what-if): calendar days, and trading
// days — weekdays from tomorrow through that day. Market holidays are not
// taken off. Negative calendar days for a day already past (trading days 0).

export function daysAheadBlock(iso: string, now: number = Date.now()): { calendar: number; trading: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const calendar = Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00`) - start.getTime()) / 86_400_000)
  let trading = 0
  for (let i = 1; i <= calendar; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000 + 12 * 3_600_000).getDay()
    if (d !== 0 && d !== 6) trading += 1
  }
  return { calendar, trading }
}
