import { describe, it, expect } from 'vitest'
import {
  IDLE_CEILING_MS,
  MIN_ATTENTION_MS,
  createPendingReadingAttentionBlock,
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  isReadingSittingBreakBlock,
  isReportableAttentionBlock,
  suspendReadingAttentionBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'

const T0 = 1_756_500_000_000

describe('readingAttentionBlock', () => {
  it('credits the exact gap between two close signals', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 30_000)
    expect(s.creditedMs).toBe(30_000)
    expect(s.lastEventMs).toBe(T0 + 30_000)
  })

  it('accumulates across a run of signals', () => {
    let s = createReadingAttentionBlock(T0)
    for (let i = 1; i <= 10; i += 1) {
      s = creditReadingAttentionBlock(s, T0 + i * 60_000)
    }
    expect(s.creditedMs).toBe(10 * 60_000)
  })

  // The whole point of the block: a long absence costs the ceiling, not the
  // absence. Wall-clock would have said 40 minutes here.
  it('clamps a walk-away to the idle ceiling', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 40 * 60_000)
    expect(s.creditedMs).toBe(IDLE_CEILING_MS)
  })

  it('clamps each gap independently rather than in aggregate', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 40 * 60_000)
    s = creditReadingAttentionBlock(s, T0 + 80 * 60_000)
    expect(s.creditedMs).toBe(2 * IDLE_CEILING_MS)
  })

  // Arrival is not evidence. A sitting that has seen one signal has observed a
  // moment, not a duration, and must credit nothing for the time before it —
  // this is what stopped every app launch with a restored document from
  // minting up to one ceiling of reading nobody did.
  it('credits nothing for the first signal of a sitting', () => {
    let s = createPendingReadingAttentionBlock()
    s = creditReadingAttentionBlock(s, T0 + 40 * 60_000)
    expect(s.creditedMs).toBe(0)
    expect(s.firstEventMs).toBe(T0 + 40 * 60_000)
    s = creditReadingAttentionBlock(s, T0 + 41 * 60_000)
    expect(s.creditedMs).toBe(60_000)
  })

  // Departure is not evidence either. Suspending freezes without paying for
  // the gap that led up to it, and the next signal resumes from itself.
  it('credits nothing across a suspension', () => {
    let s = createPendingReadingAttentionBlock()
    s = creditReadingAttentionBlock(s, T0)
    s = creditReadingAttentionBlock(s, T0 + 120_000) // read two minutes
    s = suspendReadingAttentionBlock(s)              // blur
    s = creditReadingAttentionBlock(s, T0 + 240_000) // back two minutes later
    expect(s.creditedMs).toBe(120_000)
    s = creditReadingAttentionBlock(s, T0 + 300_000) // read another minute
    expect(s.creditedMs).toBe(180_000)
  })

  // The bounds are the sitting's extent, and they come only from observations.
  it('bounds the sitting by its first and last signal', () => {
    let s = createPendingReadingAttentionBlock()
    s = creditReadingAttentionBlock(s, T0 + 10_000)
    s = creditReadingAttentionBlock(s, T0 + 70_000)
    s = suspendReadingAttentionBlock(s)
    expect(s.firstEventMs).toBe(T0 + 10_000)
    expect(s.lastEventMs).toBe(T0 + 70_000)
  })

  describe('breaking a sitting on a long absence', () => {
    // Without this a document left open overnight is ONE span, and since a span
    // is filed by the day it started, the next day's real reading is swallowed
    // into yesterday. A 945-minute record did exactly that.
    it('calls a gap wider than the ceiling a different sitting', () => {
      let s = createPendingReadingAttentionBlock()
      s = creditReadingAttentionBlock(s, T0)
      expect(isReadingSittingBreakBlock(s, T0 + IDLE_CEILING_MS)).toBe(false)
      expect(isReadingSittingBreakBlock(s, T0 + IDLE_CEILING_MS + 1)).toBe(true)
    })

    // Suspended or not makes no difference: the question is how long ago the
    // last observation was, not whether the clock happened to be running.
    it('breaks on a long absence even while suspended', () => {
      let s = createPendingReadingAttentionBlock()
      s = creditReadingAttentionBlock(s, T0)
      s = suspendReadingAttentionBlock(s)
      expect(isReadingSittingBreakBlock(s, T0 + 10 * 60 * 60_000)).toBe(true)
    })

    it('never breaks a sitting that has observed nothing', () => {
      const s = createPendingReadingAttentionBlock()
      expect(isReadingSittingBreakBlock(s, T0 + 10 * 60 * 60_000)).toBe(false)
    })
  })

  it('credits nothing when the clock jumps backwards', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 - 10_000)
    expect(s.creditedMs).toBe(0)
  })

  it('ignores a non-finite timestamp instead of poisoning the total', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 1_000)
    const before = { ...s }
    s = creditReadingAttentionBlock(s, Number.NaN)
    expect(s).toEqual(before)
    expect(isReadingSittingBreakBlock(s, Number.NaN)).toBe(false)
  })

  it('accepts an explicit ceiling so callers can tighten it', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 10 * 60_000, 60_000)
    expect(s.creditedMs).toBe(60_000)
  })

  it('reports only sittings at or past the floor', () => {
    expect(isReportableAttentionBlock(MIN_ATTENTION_MS - 1)).toBe(false)
    expect(isReportableAttentionBlock(MIN_ATTENTION_MS)).toBe(true)
    expect(isReportableAttentionBlock(Number.NaN)).toBe(false)
  })
})
