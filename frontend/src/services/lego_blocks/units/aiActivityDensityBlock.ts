// Pure re-bucketing for the density sparkline.
//
// The undertaking tail already carries per-day density (one entry per calendar
// day worked). That is enough to draw one strip, but the design's whole point
// is that strips are *comparable down a column* — "all strips span the same
// window", so a flat line with a zero count reads as "written down, never
// worked on" against its neighbours. Comparability needs a shared window and a
// fixed bucket count, which only the caller (rendering a column) knows. So this
// takes the day-level density plus an explicit window and folds it into N
// equal-width buckets.
//
// Active duration, not wall-clock, is what a bucket sums — the sparkline's job
// is honesty about how much work happened (see ParsedSession.activeDurationMs).

export interface DensityDay {
  /** `YYYY-MM-DD`. */
  date: string
  chains: number
  activeDurationMs: number
}

export interface DensityBucket {
  /** Inclusive calendar bounds of the bucket (`YYYY-MM-DD`). */
  startDate: string
  endDate: string
  chains: number
  activeDurationMs: number
}

export interface BucketDensityOptions {
  /** Window start (`YYYY-MM-DD`). Defaults to the earliest day present. */
  from?: string
  /** Window end (`YYYY-MM-DD`). Defaults to the latest day present. */
  to?: string
  /** Number of equal-width buckets. Values < 1 are treated as 1. */
  buckets: number
}

const MS_PER_DAY = 86_400_000

/** Epoch-day number for a `YYYY-MM-DD` string, or null when unparseable.
 *  Uses UTC noon so DST never shifts the day. */
function epochDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return Math.floor(ms / MS_PER_DAY)
}

function dayToDate(day: number): string {
  const d = new Date(day * MS_PER_DAY)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/**
 * Fold day-level density into `buckets` equal-width calendar slices across
 * [from, to]. Days outside the window are dropped; days inside land in
 * `floor((day - from) / span * buckets)`, clamped to the last bucket so the
 * final day never spills past the end. Returns [] when the window can't be
 * resolved (no days and no explicit bounds).
 */
export function bucketDensityBlock(
  days: DensityDay[],
  options: BucketDensityOptions,
): DensityBucket[] {
  const bucketCount = Math.max(1, Math.floor(options.buckets))

  const dayNums = days
    .map(d => ({ day: epochDay(d.date), chains: d.chains, active: d.activeDurationMs }))
    .filter((d): d is { day: number; chains: number; active: number } => d.day !== null)

  const fromDay = options.from ? epochDay(options.from) : dayNums.length ? Math.min(...dayNums.map(d => d.day)) : null
  const toDay = options.to ? epochDay(options.to) : dayNums.length ? Math.max(...dayNums.map(d => d.day)) : null
  if (fromDay === null || toDay === null || toDay < fromDay) return []

  const span = toDay - fromDay + 1
  const buckets: DensityBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    // Slice boundaries by day, so bucket i covers [fromDay + i*span/N, …).
    const start = fromDay + Math.floor((i * span) / bucketCount)
    const endExclusive = fromDay + Math.floor(((i + 1) * span) / bucketCount)
    const end = Math.max(start, endExclusive - 1)
    return { startDate: dayToDate(start), endDate: dayToDate(end), chains: 0, activeDurationMs: 0 }
  })

  for (const d of dayNums) {
    if (d.day < fromDay || d.day > toDay) continue
    const idx = Math.min(bucketCount - 1, Math.floor(((d.day - fromDay) / span) * bucketCount))
    buckets[idx].chains += d.chains
    buckets[idx].activeDurationMs += d.active
  }

  return buckets
}
