import { describe, expect, it } from 'vitest'
import {
  rssDailyVolumeBlock,
  rssFeedHealthBlock,
  rssItemReadableBlock,
  rssReaderFeedsBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

const NOW = new Date('2026-10-23T12:00:00Z')

function item(id: string, feedId: string, opts: { full?: boolean; cached?: boolean; days?: number } = {}): RssFeedItemBlock {
  return {
    id,
    feedId,
    title: id,
    link: `https://www.wsj.com/articles/${id}`,
    description: opts.full ? `<p>${'word '.repeat(400)}</p>` : '<p>A teaser line.</p>',
    pubDate: new Date(NOW.getTime() - (opts.days ?? 1) * 86_400_000).toISOString(),
    imageUrl: null,
    read: false,
    viewedAt: null,
    dismissedAt: null,
    tags: [],
    keep: false,
    important: false,
    textInCache: opts.cached,
  }
}

const feed = (feedId: string, items: RssFeedItemBlock[]): RssFeedResultBlock => ({ feedId, feedTitle: feedId, items, error: null })

describe('a source in the merged views', () => {
  it('counts an item readable when its text is cached or the feed ships the whole article', () => {
    expect(rssItemReadableBlock(item('a', 'f', { cached: true }))).toBe(true)
    expect(rssItemReadableBlock(item('b', 'f', { full: true }))).toBe(true)
    expect(rssItemReadableBlock(item('c', 'f'))).toBe(false)
    // A teaser from a site without a paywall opens to the article
    expect(rssItemReadableBlock({ ...item('d', 'f'), link: 'https://arstechnica.com/x' })).toBe(true)
  })

  it('shows, keeps only readable items, or hides a source', () => {
    const feeds = [
      feed('econ', [item('e1', 'econ', { full: true })]),
      feed('wsj', [item('w1', 'wsj'), item('w2', 'wsj', { cached: true })]),
      feed('bbg', [item('b1', 'bbg')]),
    ]
    const preferences = {
      groups: [],
      feeds: [
        { id: 'econ', url: 'x', title: 'Economist' },
        { id: 'wsj', url: 'x', title: 'WSJ', inMergedViews: 'readable' as const },
        { id: 'bbg', url: 'x', title: 'Bloomberg', inMergedViews: 'hidden' as const },
      ],
    }
    const merged = rssReaderFeedsBlock(feeds, preferences)
    expect(merged.map((f) => f.feedId)).toEqual(['econ', 'wsj'])
    expect(merged.find((f) => f.feedId === 'wsj')?.items.map((i) => i.id)).toEqual(['w2'])
  })

  it('reports how much of a source is readable, overall and this week', () => {
    const health = rssFeedHealthBlock(feed('ft', [
      item('1', 'ft', { cached: true, days: 2 }),
      item('2', 'ft', { days: 3 }),
      item('3', 'ft', { full: true, days: 20 }),
    ]), NOW)
    expect(health).toEqual({ feedId: 'ft', total: 3, readable: 2, recent: 2, recentReadable: 1 })
  })

  it('counts articles per day, readable and teaser, over the window', () => {
    const volume = rssDailyVolumeBlock([feed('x', [
      item('1', 'x', { cached: true, days: 0 }),
      item('2', 'x', { days: 0 }),
      item('3', 'x', { days: 40 }),
    ])], NOW, 30)
    expect(volume).toHaveLength(30)
    const today = volume[volume.length - 1]
    expect(today.readable + today.teaser).toBe(2)
    expect(volume.reduce((n, d) => n + d.readable + d.teaser, 0)).toBe(2)
    expect(today.inList).toBe(0)
    // Given the reading list, the articles in full that are in it
    const listed = rssDailyVolumeBlock([feed('x', [item('1', 'x', { cached: true, days: 0 }), item('4', 'x', { cached: true, days: 0 })])], NOW, 30, new Set(['1']))
    expect(listed[listed.length - 1]).toMatchObject({ readable: 2, inList: 1 })
  })
})
