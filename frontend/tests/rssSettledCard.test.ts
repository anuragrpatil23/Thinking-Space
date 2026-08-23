import { describe, expect, it } from 'vitest'
import { rssSettledCardIndexBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

// A phone-sized deck: ten cards, one viewport tall.
const uniform = Array.from({ length: 10 }, (_, i) => i * 844)

describe('rssSettledCardIndexBlock', () => {
  it('lands exactly on a card at rest', () => {
    expect(rssSettledCardIndexBlock(uniform, 0)).toBe(0)
    expect(rssSettledCardIndexBlock(uniform, 844 * 4)).toBe(4)
    expect(rssSettledCardIndexBlock(uniform, 844 * 9)).toBe(9)
  })

  it('reports the nearer card mid-swipe', () => {
    expect(rssSettledCardIndexBlock(uniform, 844 * 3 + 100)).toBe(3)
    expect(rssSettledCardIndexBlock(uniform, 844 * 3 + 800)).toBe(4)
  })

  it('does not drift when the viewport height changes under it', () => {
    // The iOS toolbar-collapse case. Card offsets are layout facts and do not
    // move, so the answer holds however the window is measured. Dividing
    // scrollTop by a clientHeight that just changed is what produced the
    // off-by-one the reader saw as "two swipes per article".
    // Deep in the deck, where a small divisor error has compounded: card 12 of
    // a 20-card deck, with the toolbar having freed 44px of viewport.
    const deck = Array.from({ length: 20 }, (_, i) => i * 844)
    const scrollTop = 844 * 12
    expect(rssSettledCardIndexBlock(deck, scrollTop)).toBe(12)
    expect(Math.round(scrollTop / 888)).toBe(11)
  })

  it('handles cards of differing heights', () => {
    const ragged = [0, 900, 1700, 2800]
    expect(rssSettledCardIndexBlock(ragged, 1700)).toBe(2)
    expect(rssSettledCardIndexBlock(ragged, 1750)).toBe(2)
    expect(rssSettledCardIndexBlock(ragged, 2600)).toBe(3)
  })

  it('clamps past either end rather than going out of range', () => {
    expect(rssSettledCardIndexBlock(uniform, -500)).toBe(0)
    expect(rssSettledCardIndexBlock(uniform, 999_999)).toBe(9)
  })

  it('is empty-safe', () => {
    expect(rssSettledCardIndexBlock([], 1234)).toBe(0)
  })
})
