import { describe, expect, it } from 'vitest'
import {
  buildRssDeckEntriesBlock,
  rssDayDateLabelBlock,
  rssDeckDayCountsBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '../src/services/lego_blocks/units/rssFeedBlock'

function item(id: string, pubDate: string | null, read = false): RssFeedItemBlock {
  return {
    id, feedId: 'f1', title: id, link: `https://example.com/${id}`, description: '',
    pubDate, imageUrl: null, read, viewedAt: null, dismissedAt: null,
    tags: [], keep: false, important: false,
  }
}

function feed(items: RssFeedItemBlock[]): RssFeedResultBlock {
  return { feedId: 'f1', feedTitle: 'Feed', items, error: null }
}

describe('buildRssDeckEntriesBlock', () => {
  it('keeps read articles — membership is not a live unread predicate', () => {
    const entries = buildRssDeckEntriesBlock([feed([
      item('a', '2026-08-21T10:00:00Z', true),
      item('b', '2026-08-21T11:00:00Z'),
    ])])
    expect(entries.map(e => e.item.id).sort()).toEqual(['a', 'b'])
  })

  it('orders newest first and sinks undated articles to the bottom', () => {
    const entries = buildRssDeckEntriesBlock([feed([
      item('old', '2026-08-20T10:00:00Z'),
      item('undated', null),
      item('new', '2026-08-22T10:00:00Z'),
    ])])
    expect(entries.map(e => e.item.id)).toEqual(['new', 'old', 'undated'])
  })
})

describe('rssDeckDayCountsBlock', () => {
  it('reports unread and total per day from the same list', () => {
    const entries = buildRssDeckEntriesBlock([feed([
      item('a', '2026-08-21T10:00:00Z', true),
      item('b', '2026-08-21T11:00:00Z'),
      item('c', '2026-08-22T09:00:00Z'),
    ])])
    const counts = rssDeckDayCountsBlock(entries)
    const aug21 = counts.get('2026-08-21')
    expect(aug21).toEqual({ unread: 1, total: 2 })
    expect(counts.get('2026-08-22')).toEqual({ unread: 1, total: 1 })
  })

  it('never reports more unread than total', () => {
    const entries = buildRssDeckEntriesBlock([feed([
      item('a', '2026-08-21T10:00:00Z'),
      item('b', '2026-08-21T11:00:00Z', true),
    ])])
    for (const bucket of rssDeckDayCountsBlock(entries).values()) {
      expect(bucket.unread).toBeLessThanOrEqual(bucket.total)
    }
  })

  it('buckets undated articles rather than dropping them', () => {
    const counts = rssDeckDayCountsBlock(buildRssDeckEntriesBlock([feed([item('u', null)])]))
    expect(counts.get('__undated__')).toEqual({ unread: 1, total: 1 })
  })
})

describe('rssDayDateLabelBlock', () => {
  const now = new Date(2026, 7, 23)

  it('gives a calendar date, not a weekday', () => {
    expect(rssDayDateLabelBlock('2026-08-21', now)).toBe('Aug 21')
  })

  it('adds the year once the day leaves the current one', () => {
    expect(rssDayDateLabelBlock('2025-08-21', now)).toBe('Aug 21, 2025')
  })

  it('handles the undated bucket', () => {
    expect(rssDayDateLabelBlock('__undated__', now)).toBe('No date')
  })
})
