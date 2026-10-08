import { describe, expect, it } from 'vitest'
import {
  buildRssDeckEntriesBlock,
  buildUnreadInboxItemsBlock,
  collapseDuplicateRssEntriesBlock,
  rssAlsoInLabelBlock,
  rssArticleKeyBlock,
  rssDuplicateItemsBlock,
  rssReaderFeedsBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

function item(feedId: string, hash: string, link: string, patch: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id: `${feedId}::${hash}`,
    feedId,
    title: 'Title',
    link,
    description: '',
    pubDate: '2026-10-05T07:00:00Z',
    imageUrl: null,
    read: false,
    viewedAt: null,
    dismissedAt: null,
    tags: [],
    keep: false,
    important: false,
    ...patch,
  }
}

function feed(feedId: string, feedTitle: string, items: RssFeedItemBlock[]): RssFeedResultBlock {
  return { feedId, feedTitle, items, error: null }
}

const WSJ = 'https://www.wsj.com/tech/robco-784bd6a5'

describe('rssArticleKeyBlock', () => {
  it('ignores tracking parameters, www and a trailing slash', () => {
    const key = rssArticleKeyBlock(item('a', '1', `${WSJ}?mod=rss_Technology`))
    expect(rssArticleKeyBlock(item('b', '2', `${WSJ}?mod=pls_whats_news_us_business_f`))).toBe(key)
    expect(rssArticleKeyBlock(item('c', '3', 'https://wsj.com/tech/robco-784bd6a5/?utm_source=rss&utm_medium=feed'))).toBe(key)
  })

  it('keeps query parameters that tell articles apart', () => {
    const base = 'https://investor.nvidia.com/sec-filings-details/default.aspx?FilingId='
    expect(rssArticleKeyBlock(item('a', '1', `${base}19794501`)))
      .not.toBe(rssArticleKeyBlock(item('a', '2', `${base}19794496`)))
  })

  it('never matches two articles that have no link', () => {
    expect(rssArticleKeyBlock(item('a', '1', ''))).not.toBe(rssArticleKeyBlock(item('a', '2', '')))
  })
})

describe('collapseDuplicateRssEntriesBlock', () => {
  it('shows one row for an article carried by several feeds and names the others', () => {
    const entries = collapseDuplicateRssEntriesBlock([
      { item: item('biz', '1', `${WSJ}?mod=a`), feedTitle: 'WSJ - Business' },
      { item: item('tech', '1', `${WSJ}?mod=b`), feedTitle: 'WSJ - Technology' },
      { item: item('mkt', '1', `${WSJ}?mod=c`), feedTitle: 'WSJ - Markets' },
      { item: item('biz', '2', 'https://www.wsj.com/other'), feedTitle: 'WSJ - Business' },
    ])
    expect(entries.map(entry => entry.item.id)).toEqual(['biz::1', 'biz::2'])
    expect(entries[0].alsoIn).toEqual(['WSJ - Technology', 'WSJ - Markets'])
    expect(entries[1].alsoIn).toBeUndefined()
  })

  it('keeps the earliest copy when a feed re-lists an article, with no note', () => {
    const link = 'https://www.nasdaq.com/articles/stocks-settle-higher'
    const [entry, ...rest] = collapseDuplicateRssEntriesBlock([
      { item: item('n', 'late', link, { pubDate: '2026-10-05T18:00:00Z' }), feedTitle: 'NASDAQ - TSLA' },
      { item: item('n', 'early', link, { pubDate: '2026-10-02T22:00:00Z' }), feedTitle: 'NASDAQ - TSLA' },
    ])
    expect(rest).toEqual([])
    expect(entry.item.id).toBe('n::early')
    expect(entry.alsoIn).toBeUndefined()
  })

  it('prefers a read copy, then one with cached text', () => {
    const read = collapseDuplicateRssEntriesBlock([
      { item: item('a', '1', WSJ, { textInCache: true }), feedTitle: 'A' },
      { item: item('b', '1', WSJ, { read: true }), feedTitle: 'B' },
    ])
    expect(read[0].item.id).toBe('b::1')
    const text = collapseDuplicateRssEntriesBlock([
      { item: item('a', '1', WSJ), feedTitle: 'A' },
      { item: item('b', '1', WSJ, { textInCache: true }), feedTitle: 'B' },
    ])
    expect(text[0].item.id).toBe('b::1')
  })
})

describe('merged views', () => {
  const feeds = [
    feed('biz', 'WSJ - Business', [item('biz', '1', `${WSJ}?mod=a`)]),
    feed('tech', 'WSJ - Technology', [item('tech', '1', `${WSJ}?mod=b`, { read: true, viewedAt: 'x' })]),
  ]

  it('leaves an article out of the unread inbox once any copy is read', () => {
    expect(buildUnreadInboxItemsBlock(feeds, new Set())).toEqual([])
  })

  it('collapses the deck across sources but not away from a chosen source', () => {
    expect(buildRssDeckEntriesBlock(feeds).map(entry => entry.item.id)).toEqual(['tech::1'])
    expect(buildRssDeckEntriesBlock(feeds, new Set(['biz'])).map(entry => entry.item.id)).toEqual(['biz::1'])
  })

  it('finds the other copies of an article', () => {
    expect(rssDuplicateItemsBlock(feeds, [feeds[0].items[0]]).map(copy => copy.id)).toEqual(['tech::1'])
  })

  it('drops feeds in excluded groups, including nested ones', () => {
    const kept = rssReaderFeedsBlock(
      [...feeds, feed('crowd', 'Crowd - NVDA', [item('crowd', '1', WSJ)])],
      {
        groups: [
          { id: 'g', name: 'Crowd', parentGroupId: null, excludeFromAllUnread: true },
          { id: 'g2', name: 'Sub', parentGroupId: 'g' },
        ],
        feeds: [
          { id: 'biz', url: '', title: '' },
          { id: 'tech', url: '', title: '' },
          { id: 'crowd', url: '', title: '', groupId: 'g2' },
        ],
      },
    )
    expect(kept.map(f => f.feedId)).toEqual(['biz', 'tech'])
  })
})

describe('rssAlsoInLabelBlock', () => {
  it('names one feed and counts several', () => {
    expect(rssAlsoInLabelBlock(undefined)).toBeNull()
    expect(rssAlsoInLabelBlock(['WSJ - Markets'])).toBe('also in WSJ - Markets')
    expect(rssAlsoInLabelBlock(['A', 'B'])).toBe('also in 2 more feeds')
  })
})
