import { describe, expect, it } from 'vitest'
import { rssTraversalStepBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

const span = (s: { commitFrom: number; commitTo: number }) =>
  Array.from({ length: s.commitTo - s.commitFrom }, (_, i) => s.commitFrom + i)

describe('rssTraversalStepBlock — arrival marks read', () => {
  it('marks the card landed on, so one swipe turns over one article', () => {
    // The whole bug: under the old departure rule this returned [3,4), so card
    // 4 was only marked on the NEXT swipe and every article took two.
    expect(span(rssTraversalStepBlock(3, 4, false))).toEqual([3, 4])
  })

  it('marks everything a fast flick crossed, including where it landed', () => {
    expect(span(rssTraversalStepBlock(2, 6, false))).toEqual([2, 3, 4, 5, 6])
  })

  it('marks only the landing card when scrolling back', () => {
    // Cards between were passed forward earlier and counted then.
    expect(span(rssTraversalStepBlock(7, 3, false))).toEqual([3])
  })

  it('marks the current card when the deck settles without moving', () => {
    // Arrival includes opening the deck: card 0 is on screen, so it is read.
    expect(span(rssTraversalStepBlock(5, 5, false))).toEqual([5])
  })

  it('a jump marks only where it lands, never the month it flew over', () => {
    expect(span(rssTraversalStepBlock(2, 900, true))).toEqual([900])
    expect(span(rssTraversalStepBlock(900, 2, true))).toEqual([2])
  })

  it('always leaves the cursor where the reader landed', () => {
    for (const [cursor, landed, nav] of [[0, 0, false], [4, 9, false], [9, 4, false], [1, 50, true]] as const) {
      expect(rssTraversalStepBlock(cursor, landed, nav).nextCursor).toBe(landed)
    }
  })

  it('never commits an empty span — every settle marks at least the card on screen', () => {
    for (const [cursor, landed, nav] of [[0, 0, false], [7, 3, false], [2, 6, false], [1, 50, true]] as const) {
      const step = rssTraversalStepBlock(cursor, landed, nav)
      expect(step.commitTo).toBeGreaterThan(step.commitFrom)
    }
  })
})
