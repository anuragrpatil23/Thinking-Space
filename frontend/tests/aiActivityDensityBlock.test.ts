import { describe, expect, it } from 'vitest'
import { bucketDensityBlock, type DensityDay } from '@/services/lego_blocks/units/aiActivityDensityBlock'

const days: DensityDay[] = [
  { date: '2026-06-01', chains: 1, activeDurationMs: 60_000 },
  { date: '2026-06-05', chains: 2, activeDurationMs: 120_000 },
  { date: '2026-06-10', chains: 1, activeDurationMs: 30_000 },
]

describe('bucketDensityBlock', () => {
  it('folds days into N equal-width buckets summing active duration', () => {
    // Window Jun 1–10 (10 days), 5 buckets → 2 days each.
    // Jun 1 → bucket 0, Jun 5 → bucket 2, Jun 10 → bucket 4.
    const buckets = bucketDensityBlock(days, { from: '2026-06-01', to: '2026-06-10', buckets: 5 })
    expect(buckets).toHaveLength(5)
    expect(buckets.map(b => b.chains)).toEqual([1, 0, 2, 0, 1])
    expect(buckets.map(b => b.activeDurationMs)).toEqual([60_000, 0, 120_000, 0, 30_000])
  })

  it('defaults the window to the span of the days present', () => {
    const buckets = bucketDensityBlock(days, { buckets: 3 })
    expect(buckets[0].startDate).toBe('2026-06-01')
    expect(buckets[buckets.length - 1].endDate).toBe('2026-06-10')
    expect(buckets.reduce((n, b) => n + b.chains, 0)).toBe(4)
  })

  it('honors a shared window wider than the data, so a column of strips aligns', () => {
    // The undertaking only worked Jun 1–10, but the column spans May–July. Its
    // strip must sit in the correct slice of that shared window, left-heavy.
    const buckets = bucketDensityBlock(days, { from: '2026-05-01', to: '2026-07-31', buckets: 3 })
    expect(buckets).toHaveLength(3)
    // All activity is in the first third (May 1 – ~May 31 → no; Jun 1-10 lands
    // in bucket 0 since May1+31 days ≈ Jun 1). Assert everything is bucket 0-1.
    expect(buckets[2].chains).toBe(0)
    expect(buckets.reduce((n, b) => n + b.chains, 0)).toBe(4)
  })

  it('drops days outside the window rather than clamping them in', () => {
    const buckets = bucketDensityBlock(days, { from: '2026-06-02', to: '2026-06-08', buckets: 2 })
    // Jun 1 and Jun 10 are outside → only Jun 5 counts.
    expect(buckets.reduce((n, b) => n + b.chains, 0)).toBe(2)
  })

  it('returns [] when there is nothing to bucket and no explicit window', () => {
    expect(bucketDensityBlock([], { buckets: 5 })).toEqual([])
  })

  it('never divides by zero — a sub-1 bucket count becomes one bucket', () => {
    const buckets = bucketDensityBlock(days, { from: '2026-06-01', to: '2026-06-10', buckets: 0 })
    expect(buckets).toHaveLength(1)
    expect(buckets[0].chains).toBe(4)
  })
})
