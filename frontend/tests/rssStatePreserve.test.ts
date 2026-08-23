import { describe, expect, it } from 'vitest'
import {
  preserveRssItemStateBlock,
  unionRssFeedItemsBlock,
  type RssFeedItemBlock,
} from '../src/services/lego_blocks/units/rssFeedBlock'

function item(patch: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id: 'feed-1::abc', feedId: 'feed-1', title: 'T', link: 'https://e.com/a',
    description: '', pubDate: '2026-08-10T09:00:00Z', imageUrl: null,
    read: false, viewedAt: null, dismissedAt: null,
    tags: [], keep: false, important: false, ...patch,
  }
}

describe('preserveRssItemStateBlock', () => {
  it('keeps an optimistic read when the refetch has not seen the vault write yet', () => {
    const optimistic = item({ read: true, dismissedAt: '2026-08-23T16:00:00Z' })
    const refetched = item({ read: false, dismissedAt: null, title: 'Updated title' })
    const merged = preserveRssItemStateBlock(optimistic, refetched)
    expect(merged.read).toBe(true)
    expect(merged.dismissedAt).toBe('2026-08-23T16:00:00Z')
  })

  it('still takes fresh content from the fetch', () => {
    const merged = preserveRssItemStateBlock(
      item({ read: true, title: 'Old', imageUrl: null }),
      item({ title: 'New', imageUrl: 'https://e.com/i.png' }),
    )
    expect(merged.title).toBe('New')
    expect(merged.imageUrl).toBe('https://e.com/i.png')
  })

  it('never drops a deliberate mark on refresh', () => {
    const merged = preserveRssItemStateBlock(
      item({ keep: true, important: true, tags: ['research more'] }),
      item(),
    )
    expect(merged.keep).toBe(true)
    expect(merged.important).toBe(true)
    expect(merged.tags).toEqual(['research more'])
  })
})

describe('unionRssFeedItemsBlock', () => {
  it('a live refresh cannot revert a read article to unread', () => {
    const current = [item({ read: true, dismissedAt: '2026-08-23T16:00:00Z' })]
    const incoming = [item({ read: false, dismissedAt: null })]
    expect(unionRssFeedItemsBlock(current, incoming, true)[0].read).toBe(true)
  })

  it('still adds articles the refresh brings that were not held', () => {
    const merged = unionRssFeedItemsBlock(
      [item({ id: 'feed-1::a', pubDate: '2026-08-10T09:00:00Z' })],
      [item({ id: 'feed-1::b', pubDate: '2026-08-11T09:00:00Z' })],
      true,
    )
    expect(merged.map(i => i.id)).toEqual(['feed-1::b', 'feed-1::a'])
  })

  it('cached pages still lose to the live copy on content', () => {
    const merged = unionRssFeedItemsBlock(
      [item({ title: 'Live' })], [item({ title: 'Cached' })], false,
    )
    expect(merged[0].title).toBe('Live')
  })
})
