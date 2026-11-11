// When each kind of F9 data is due again. Daily data is tied to the market's
// day, not a rolling clock: it is due when it was last synced before the most
// recent settled close, so it runs once after each trading day, never drifts
// through the day, and does nothing twice over a weekend.
//
// A day's figures are settled at 5 PM New York, an hour after the bell: the
// daily price bar is final only then (pricesCsvBlock.marketDayBlock).

export type F9SyncCadenceBlock =
  /** Once after each trading day settles */
  | 'daily'
  | 'weekly'
  | 'monthly'
  /** Never on its own: only when asked */
  | 'on-demand'

export const F9_SYNC_DAY_MS_BLOCK = 24 * 60 * 60 * 1000
const SETTLE_MINUTES = 17 * 60

/** New York's wall clock for a moment: its weekday (0 = Sunday) and minutes past midnight. */
function newYorkClockBlock(at: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/** The most recent weekday 5 PM New York at or before `now` (holidays count as trading days). */
export function lastSettleBlock(now: Date): Date {
  // Step back a day at a time to the first weekday whose 5 PM has passed
  for (let back = 0; back < 8; back += 1) {
    const probe = new Date(now.getTime() - back * F9_SYNC_DAY_MS_BLOCK)
    const ny = newYorkClockBlock(probe)
    if (ny.weekday === 0 || ny.weekday === 6) continue
    if (back === 0 && ny.minutes < SETTLE_MINUTES) continue
    // 5 PM that New York day: from the probe, move by the minutes between its clock and 17:00
    return new Date(probe.getTime() + (SETTLE_MINUTES - ny.minutes) * 60_000 - probe.getSeconds() * 1000 - probe.getMilliseconds())
  }
  return new Date(now.getTime() - 7 * F9_SYNC_DAY_MS_BLOCK)
}

/** Whether data with this cadence, last synced at `lastAt` (ms), is due at `now`. */
export function cadenceDueBlock(cadence: F9SyncCadenceBlock, lastAt: number, now: Date): boolean {
  if (cadence === 'on-demand') return false
  if (cadence === 'weekly') return now.getTime() - lastAt > 7 * F9_SYNC_DAY_MS_BLOCK
  if (cadence === 'monthly') return now.getTime() - lastAt > 30 * F9_SYNC_DAY_MS_BLOCK
  return lastAt < lastSettleBlock(now).getTime()
}
