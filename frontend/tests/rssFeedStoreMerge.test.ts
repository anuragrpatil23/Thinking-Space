import { describe, expect, it } from 'vitest'
import {
  dropRssFeedItemsBlock,
  patchRssFeedItemsBlock,
  unionRssFeedItemsBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

function itemBlock(id: string, pubDate: string | null, patch: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id,
    feedId: 'feed-1',
    title: id,
    link: `https://example.com/${id}`,
    description: '',
    pubDate,
    read: false,
    viewedAt: null,
    dismissedAt: null,
    tags: [],
    keep: false,
    important: false,
    ...patch,
  }
}

function feedBlock(feedId: string, items: RssFeedItemBlock[]): RssFeedResultBlock {
  return { feedId, feedTitle: feedId, items, error: null }
}

describe('unionRssFeedItemsBlock', () => {
  it('keeps retained backlog that the live window no longer contains', () => {
    // The publisher's feed only carries the newest two; the store holds older ones.
    const stored = [itemBlock('c', '2026-08-01T00:00:00Z'), itemBlock('d', '2026-07-01T00:00:00Z')]
    const live = [itemBlock('a', '2026-08-20T00:00:00Z'), itemBlock('b', '2026-08-10T00:00:00Z')]
    const merged = unionRssFeedItemsBlock(stored, live, true)
    expect(merged.map(item => item.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lets a live fetch supersede the stored copy of the same article', () => {
    const stored = [itemBlock('a', '2026-08-20T00:00:00Z', { title: 'old title' })]
    const live = [itemBlock('a', '2026-08-20T00:00:00Z', { title: 'new title' })]
    expect(unionRssFeedItemsBlock(stored, live, true)[0].title).toBe('new title')
  })

  it('protects an optimistic update from a stale cache page', () => {
    // The reader just marked this read; the backlog page still says unread.
    const optimistic = [itemBlock('a', '2026-08-20T00:00:00Z', { read: true, viewedAt: '2026-08-22T00:00:00Z' })]
    const cachePage = [itemBlock('a', '2026-08-20T00:00:00Z')]
    const merged = unionRssFeedItemsBlock(optimistic, cachePage, false)
    expect(merged[0].read).toBe(true)
  })

  it('sorts newest first and pushes undated articles to the end', () => {
    const merged = unionRssFeedItemsBlock(
      [itemBlock('undated', null)],
      [itemBlock('old', '2020-01-01T00:00:00Z'), itemBlock('new', '2026-08-20T00:00:00Z')],
      true,
    )
    expect(merged.map(item => item.id)).toEqual(['new', 'old', 'undated'])
  })
})

describe('patchRssFeedItemsBlock', () => {
  const feeds = [
    feedBlock('feed-1', [itemBlock('a', '2026-08-20T00:00:00Z'), itemBlock('b', '2026-08-19T00:00:00Z')]),
    feedBlock('feed-2', [itemBlock('c', '2026-08-18T00:00:00Z')]),
  ]

  it('patches only the named articles', () => {
    const next = patchRssFeedItemsBlock(feeds, ['a'], { read: true })
    expect(next[0].items[0].read).toBe(true)
    expect(next[0].items[1].read).toBe(false)
  })

  it('preserves the identity of feeds that hold no match', () => {
    // React leans on this: marking one article read must not re-render feed-2.
    const next = patchRssFeedItemsBlock(feeds, ['a'], { read: true })
    expect(next[1]).toBe(feeds[1])
    expect(next[0]).not.toBe(feeds[0])
  })

  it('returns the same array when nothing matched, so no render is scheduled', () => {
    expect(patchRssFeedItemsBlock(feeds, ['missing'], { read: true })).toBe(feeds)
    expect(patchRssFeedItemsBlock(feeds, [], { read: true })).toBe(feeds)
  })
})

describe('dropRssFeedItemsBlock', () => {
  const feeds = [
    feedBlock('feed-1', [itemBlock('a', '2026-08-20T00:00:00Z'), itemBlock('b', '2026-08-19T00:00:00Z')]),
    feedBlock('feed-2', [itemBlock('c', '2026-08-18T00:00:00Z')]),
  ]

  it('removes articles across feeds and leaves untouched feeds by reference', () => {
    const next = dropRssFeedItemsBlock(feeds, ['b'])
    expect(next[0].items.map(item => item.id)).toEqual(['a'])
    expect(next[1]).toBe(feeds[1])
  })

  it('returns the same array when nothing matched', () => {
    expect(dropRssFeedItemsBlock(feeds, ['missing'])).toBe(feeds)
    expect(dropRssFeedItemsBlock(feeds, [])).toBe(feeds)
  })
})
