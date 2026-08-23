import { describe, expect, it } from 'vitest'
import { rssTraversalStepBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

const span = (s: { commitFrom: number; commitTo: number }) =>
  Array.from({ length: s.commitTo - s.commitFrom }, (_, i) => s.commitFrom + i)

describe('rssTraversalStepBlock — departure marks read', () => {
  it('one swipe reads exactly one article', () => {
    // The two-swipe bug lived here: when the cursor trailed the visible card by
    // one, leaving card 4 committed card 2 and the reader saw nothing happen.
    expect(span(rssTraversalStepBlock(3, 4, false))).toEqual([3])
  })

  it('leaves the card being looked at unread', () => {
    // Arriving is not reading — the card must still show as new while on screen,
    // and only turn over once the reader has moved off it.
    expect(span(rssTraversalStepBlock(5, 5, false))).toEqual([])
  })

  it('reads every card a fast flick crossed, but not the one it landed on', () => {
    expect(span(rssTraversalStepBlock(2, 6, false))).toEqual([2, 3, 4, 5])
  })

  it('reads nothing when scrolling back', () => {
    expect(span(rssTraversalStepBlock(7, 3, false))).toEqual([])
  })

  it('a jump reads nothing, however far it travels', () => {
    expect(span(rssTraversalStepBlock(2, 900, true))).toEqual([])
    expect(span(rssTraversalStepBlock(900, 2, true))).toEqual([])
  })

  it('always leaves the cursor where the reader landed', () => {
    for (const [cursor, landed, nav] of [[0, 0, false], [4, 9, false], [9, 4, false], [1, 50, true]] as const) {
      expect(rssTraversalStepBlock(cursor, landed, nav).nextCursor).toBe(landed)
    }
  })

  it('never commits a card at or beyond where the reader is standing', () => {
    for (const [cursor, landed] of [[0, 1], [3, 4], [2, 9]] as const) {
      expect(rssTraversalStepBlock(cursor, landed, false).commitTo).toBeLessThanOrEqual(landed)
    }
  })
})
