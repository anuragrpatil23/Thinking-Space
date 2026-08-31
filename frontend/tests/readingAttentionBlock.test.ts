import { describe, it, expect } from 'vitest'
import {
  IDLE_CEILING_MS,
  MIN_ATTENTION_MS,
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  resumeReadingAttentionBlock,
  isReportableAttentionBlock,
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

  it('credits nothing for the gap a resume spans', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 60_000) // read for a minute
    s = resumeReadingAttentionBlock(s, T0 + 60 * 60_000) // away an hour, came back
    expect(s.creditedMs).toBe(60_000)
    expect(s.lastEventMs).toBe(T0 + 60 * 60_000)
  })

  // A blur credits the real elapsed time and freezes; the focus that follows
  // resumes. The hour in between must not appear anywhere.
  it('models blur-then-focus as credit-then-resume', () => {
    let s = createReadingAttentionBlock(T0)
    s = creditReadingAttentionBlock(s, T0 + 120_000) // blur after 2 min
    s = resumeReadingAttentionBlock(s, T0 + 62 * 60_000) // focus an hour later
    s = creditReadingAttentionBlock(s, T0 + 63 * 60_000) // read another minute
    expect(s.creditedMs).toBe(180_000)
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
    expect(resumeReadingAttentionBlock(s, Number.NaN)).toEqual(before)
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
