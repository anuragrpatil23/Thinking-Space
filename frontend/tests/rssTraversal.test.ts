import { describe, expect, it } from 'vitest'
import { rssTraversalStepBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

describe('rssTraversalStepBlock', () => {
  it('reads the single card passed on a one-card swipe', () => {
    expect(rssTraversalStepBlock(3, 4, false)).toEqual({ commitFrom: 3, commitTo: 4, nextCursor: 4 })
  })

  it('reads every card a fast flick crossed, not just the landing one', () => {
    expect(rssTraversalStepBlock(2, 7, false)).toEqual({ commitFrom: 2, commitTo: 7, nextCursor: 7 })
  })

  it('reads nothing when scrolling back', () => {
    const step = rssTraversalStepBlock(7, 3, false)
    expect(step.commitTo - step.commitFrom).toBe(0)
    expect(step.nextCursor).toBe(3)
  })

  it('reads nothing when the position has not changed', () => {
    const step = rssTraversalStepBlock(5, 5, false)
    expect(step.commitTo - step.commitFrom).toBe(0)
  })

  it('re-bases without reading when navigating — a calendar jump must not mark the span it flew over', () => {
    const step = rssTraversalStepBlock(2, 900, true)
    expect(step.commitTo - step.commitFrom).toBe(0)
    expect(step.nextCursor).toBe(900)
  })

  it('re-bases without reading on a backward jump too', () => {
    const step = rssTraversalStepBlock(900, 2, true)
    expect(step.commitTo - step.commitFrom).toBe(0)
    expect(step.nextCursor).toBe(2)
  })

  it('never leaves the cursor behind where the reader landed', () => {
    for (const [cursor, landed, nav] of [[0, 0, false], [4, 9, false], [9, 4, false], [1, 50, true]] as const) {
      expect(rssTraversalStepBlock(cursor, landed, nav).nextCursor).toBe(landed)
    }
  })
})
