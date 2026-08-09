import { describe, expect, it } from 'vitest'
import {
  RSS_UNREAD_INBOX_ID_BLOCK,
  buildFeedGroupTreeBlock,
  buildUnreadInboxItemsBlock,
  flattenVisibleRssRowsBlock,
  rssRowIdBlock,
  type RssFeedConfigBlock,
  type RssFeedGroupBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

function item(id: string, feedId: string, overrides: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id,
    feedId,
    title: id,
    link: `https://example.com/${id}`,
    description: '',
    pubDate: null,
    read: false,
    viewedAt: null,
    dismissedAt: null,
    tags: [],
    keep: false,
    important: false,
    ...overrides,
  }
}

function result(feedId: string, items: RssFeedItemBlock[], feedTitle = feedId): RssFeedResultBlock {
  return { feedId, feedTitle, items, error: null }
}

/** Feed of plain unread, undated items — the common case for ordering tests. */
function simpleFeed(feedId: string, itemIds: string[]): RssFeedResultBlock {
  return result(feedId, itemIds.map(id => item(id, feedId)))
}

const feedConfig = (id: string, groupId: string | null = null): RssFeedConfigBlock => ({
  id,
  url: `https://example.com/${id}.xml`,
  title: id,
  groupId,
})

const group = (id: string, parentGroupId: string | null = null): RssFeedGroupBlock => ({
  id,
  name: id,
  parentGroupId,
})

/** Most assertions care about the order of articles, not the section scoping. */
const rowItemIds = (params: Parameters<typeof flattenVisibleRssRowsBlock>[0]) =>
  flattenVisibleRssRowsBlock(params).map(row => row.itemId)

describe('flattenVisibleRssRowsBlock', () => {
  it('walks flat mode in feed order, skipping collapsed feeds', () => {
    const feeds = [simpleFeed('a', ['a1', 'a2']), simpleFeed('b', ['b1'])]

    expect(rowItemIds({
      unreadInbox: null,
      tree: null,
      feeds,
      expandedFeedIds: new Set(['a', 'b']),
      expandedGroupIds: new Set(),
    })).toEqual(['a1', 'a2', 'b1'])

    // Feed "a" collapsed → its items are not on screen, so not navigable.
    expect(rowItemIds({
      unreadInbox: null,
      tree: null,
      feeds,
      expandedFeedIds: new Set(['b']),
      expandedGroupIds: new Set(),
    })).toEqual(['b1'])
  })

  it('returns nothing when every feed is collapsed', () => {
    expect(rowItemIds({
      unreadInbox: null,
      tree: null,
      feeds: [simpleFeed('a', ['a1'])],
      expandedFeedIds: new Set(),
      expandedGroupIds: new Set(),
    })).toEqual([])
  })

  it('walks grouped mode depth-first: a group\'s own feeds before its child groups', () => {
    const tree = buildFeedGroupTreeBlock(
      [group('g1'), group('g1child', 'g1'), group('g2')],
      [feedConfig('rootFeed'), feedConfig('inG1', 'g1'), feedConfig('inG1Child', 'g1child'), feedConfig('inG2', 'g2')],
    )
    const feeds = [
      simpleFeed('rootFeed', ['r1']),
      simpleFeed('inG1', ['g1a', 'g1b']),
      simpleFeed('inG1Child', ['c1']),
      simpleFeed('inG2', ['g2a']),
    ]

    expect(rowItemIds({
      unreadInbox: null,
      tree,
      feeds,
      expandedFeedIds: new Set(['rootFeed', 'inG1', 'inG1Child', 'inG2']),
      expandedGroupIds: new Set(['g1', 'g1child', 'g2']),
    })).toEqual(['r1', 'g1a', 'g1b', 'c1', 'g2a'])
  })

  it('drops a collapsed group\'s entire subtree, even when its feeds are expanded', () => {
    const tree = buildFeedGroupTreeBlock(
      [group('g1'), group('g1child', 'g1')],
      [feedConfig('inG1', 'g1'), feedConfig('inG1Child', 'g1child')],
    )
    const feeds = [simpleFeed('inG1', ['g1a']), simpleFeed('inG1Child', ['c1'])]

    expect(rowItemIds({
      unreadInbox: null,
      tree,
      feeds,
      expandedFeedIds: new Set(['inG1', 'inG1Child']),
      expandedGroupIds: new Set(),
    })).toEqual([])

    // Parent open, child group still closed → only the parent's own feed shows.
    expect(rowItemIds({
      unreadInbox: null,
      tree,
      feeds,
      expandedFeedIds: new Set(['inG1', 'inG1Child']),
      expandedGroupIds: new Set(['g1']),
    })).toEqual(['g1a'])
  })

  it('skips configured feeds that have no fetched result yet', () => {
    const tree = buildFeedGroupTreeBlock([group('g1')], [feedConfig('present', 'g1'), feedConfig('missing', 'g1')])

    expect(rowItemIds({
      unreadInbox: null,
      tree,
      feeds: [simpleFeed('present', ['p1'])],
      expandedFeedIds: new Set(['present', 'missing']),
      expandedGroupIds: new Set(['g1']),
    })).toEqual(['p1'])
  })

  it('puts the unread inbox first, and only when expanded', () => {
    const params = {
      tree: null,
      feeds: [simpleFeed('a', ['a1'])],
      expandedFeedIds: new Set(['a']),
      expandedGroupIds: new Set<string>(),
    }

    expect(rowItemIds({ ...params, unreadInbox: { expanded: true, itemIds: ['a1'] } }))
      .toEqual(['a1', 'a1'])

    // Collapsed inbox contributes no rows.
    expect(rowItemIds({ ...params, unreadInbox: { expanded: false, itemIds: ['a1'] } }))
      .toEqual(['a1'])
  })

  it('gives the inbox copy and the feed copy of one article distinct row ids', () => {
    // This is the whole reason rows are keyed by section: an article listed in
    // both the inbox and its own expanded feed has to be two navigable rows,
    // not one ambiguous id that focus lookup and index search would conflate.
    const rows = flattenVisibleRssRowsBlock({
      unreadInbox: { expanded: true, itemIds: ['a1'] },
      tree: null,
      feeds: [simpleFeed('a', ['a1'])],
      expandedFeedIds: new Set(['a']),
      expandedGroupIds: new Set(),
    })

    expect(rows).toEqual([
      { rowId: rssRowIdBlock(RSS_UNREAD_INBOX_ID_BLOCK, 'a1'), itemId: 'a1' },
      { rowId: rssRowIdBlock('a', 'a1'), itemId: 'a1' },
    ])
    expect(new Set(rows.map(row => row.rowId)).size).toBe(2)
  })
})

describe('buildUnreadInboxItemsBlock', () => {
  it('merges unread across feeds, newest first, tagging each with its source', () => {
    const feeds = [
      result('a', [
        item('old', 'a', { pubDate: '2026-07-01T10:00:00Z' }),
        item('newest', 'a', { pubDate: '2026-07-05T10:00:00Z' }),
      ], 'Feed A'),
      result('b', [
        item('middle', 'b', { pubDate: '2026-07-03T10:00:00Z' }),
      ], 'Feed B'),
    ]

    expect(buildUnreadInboxItemsBlock(feeds, new Set()).map(e => [e.item.id, e.feedTitle]))
      .toEqual([['newest', 'Feed A'], ['middle', 'Feed B'], ['old', 'Feed A']])
  })

  it('excludes already-read articles', () => {
    const feeds = [result('a', [
      item('unread', 'a'),
      item('alreadyRead', 'a', { read: true }),
    ])]

    expect(buildUnreadInboxItemsBlock(feeds, new Set()).map(e => e.item.id)).toEqual(['unread'])
  })

  it('keeps articles read during this session so the list does not shift mid-read', () => {
    const feeds = [result('a', [
      item('justOpened', 'a', { read: true, pubDate: '2026-07-05T10:00:00Z' }),
      item('stillUnread', 'a', { pubDate: '2026-07-04T10:00:00Z' }),
    ])]

    // Without the session set, opening an article yanks it out from under the
    // cursor and slides every row below it up by one.
    expect(buildUnreadInboxItemsBlock(feeds, new Set()).map(e => e.item.id))
      .toEqual(['stillUnread'])
    expect(buildUnreadInboxItemsBlock(feeds, new Set(['justOpened'])).map(e => e.item.id))
      .toEqual(['justOpened', 'stillUnread'])
  })

  it('sinks undated articles below dated ones instead of floating them to the top', () => {
    const feeds = [result('a', [
      item('undated', 'a', { pubDate: null }),
      item('unparseable', 'a', { pubDate: 'not-a-date' }),
      item('dated', 'a', { pubDate: '2026-07-01T10:00:00Z' }),
    ])]

    expect(buildUnreadInboxItemsBlock(feeds, new Set()).map(e => e.item.id))
      .toEqual(['dated', 'undated', 'unparseable'])
  })
})
