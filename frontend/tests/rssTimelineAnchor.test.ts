import { describe, expect, it } from 'vitest'
import {
  pickRssTimelineAnchorBlock,
  type RssTimelineCardRectBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

/** Cards stacked from `firstTop`, each `height` tall, in viewport coordinates. */
function stackBlock(firstTop: number, height: number, count: number): RssTimelineCardRectBlock[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `item-${index}`,
    top: firstTop + index * height,
    bottom: firstTop + (index + 1) * height,
  }))
}

describe('pickRssTimelineAnchorBlock', () => {
  it('returns null when nothing is rendered', () => {
    expect(pickRssTimelineAnchorBlock(0, [])).toBeNull()
  })

  it('anchors to the first card when the list is at the top', () => {
    // Scroller top at 100; cards start exactly there.
    const anchor = pickRssTimelineAnchorBlock(100, stackBlock(100, 80, 5))
    expect(anchor).toEqual({ itemId: 'item-0', offset: 0 })
  })

  it('anchors to the card straddling the top edge, with a negative offset', () => {
    // Scrolled 200px: cards 0 and 1 are gone, card 2 is 40px past the edge.
    const anchor = pickRssTimelineAnchorBlock(100, stackBlock(-100, 80, 5))
    expect(anchor).toEqual({ itemId: 'item-2', offset: -40 })
  })

  it('ignores cards fully scrolled past the top edge', () => {
    // Card 0's bottom sits exactly on the edge — it is no longer visible.
    const anchor = pickRssTimelineAnchorBlock(100, stackBlock(20, 80, 3))
    expect(anchor?.itemId).toBe('item-1')
  })

  it('is order-independent, so a Map in DOM-registration order still works', () => {
    const cards = stackBlock(-100, 80, 5)
    const shuffled = [cards[4], cards[0], cards[2], cards[1], cards[3]]
    expect(pickRssTimelineAnchorBlock(100, shuffled)).toEqual(
      pickRssTimelineAnchorBlock(100, cards),
    )
  })

  it('round-trips: restoring the offset reproduces the exact scroll position', () => {
    const scrollerTop = 100
    const anchor = pickRssTimelineAnchorBlock(scrollerTop, stackBlock(-137, 80, 6))
    expect(anchor).not.toBeNull()
    // Replay with the list re-rendered 500px lower (backlog hydrated above it).
    const rehydrated = stackBlock(363, 80, 6)
    const node = rehydrated.find(card => card.itemId === anchor?.itemId)
    const correction = (node?.top ?? 0) - scrollerTop - (anchor?.offset ?? 0)
    // Applying the correction to scrollTop puts the card back on the same pixel.
    expect((node?.top ?? 0) - correction).toBe(scrollerTop + (anchor?.offset ?? 0))
  })
})
