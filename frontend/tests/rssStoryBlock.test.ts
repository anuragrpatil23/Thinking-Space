import { describe, expect, it } from 'vitest'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock, groupRssStoriesBlock, rssDayLabelBlock, rssStoryOthersLabelBlock } from '@/services/lego_blocks/units/rssStoryBlock'

let n = 0
function item(feedId: string, title: string, pubDate: string, extra: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  n += 1
  return {
    id: `${feedId}::${n}`, feedId, title, link: `https://${feedId}.example.com/${n}`, description: `<p>${'word '.repeat(300)}</p>`,
    pubDate, imageUrl: null, read: false, viewedAt: null, dismissedAt: null, tags: [], keep: false, important: false, ...extra,
  }
}
const feed = (feedId: string, items: RssFeedItemBlock[]): RssFeedResultBlock => ({ feedId, feedTitle: feedId, items, error: null })

// Filler headlines so common words look common, as in a real day's feed
const filler = Array.from({ length: 60 }, (_, i) => item('filler', `Market talks update number ${i} for startup buyers in tech`, '2026-10-12T08:00:00Z'))

describe('one story, one card', () => {
  const wsj = item('wsj', 'Amazon Is in Talks to Buy AI Startup Decart, WSJ Reports', '2026-10-12T10:00:00Z')
  const nasdaq = item('nasdaq', 'Amazon Reportedly In Talks To Buy AI Startup Decart For Around $7 Bln', '2026-10-12T11:00:00Z')
  const slashdot = item('slashdot', 'Amazon in talks to buy AI startup Decart for around $7 billion', '2026-10-12T12:00:00Z')
  const other = item('slashdot', 'Physicists Trap a Single Antimatter Particle For a Month', '2026-10-12T09:00:00Z')

  const members = [wsj, nasdaq, slashdot, other, ...filler].map(i => ({ item: i, feedId: i.feedId, feedTitle: i.feedId }))

  it('groups reworded headlines of one story and leaves others alone', () => {
    const stories = groupRssStoriesBlock(members)
    const decart = stories.find(s => [s.lead, ...s.others].some(m => m.item.id === wsj.id))!
    expect([decart.lead, ...decart.others].map(m => m.item.id).sort()).toEqual([wsj.id, nasdaq.id, slashdot.id].sort())
    expect(stories.find(s => s.lead.item.id === other.id)?.others).toEqual([])
  })

  it('leads with the most trusted source, and names the rest', () => {
    const trust = new Map([['slashdot', 'high' as const], ['nasdaq', 'low' as const]])
    const decart = groupRssStoriesBlock(members, trust).find(s => s.others.length > 0)!
    expect(decart.lead.feedId).toBe('slashdot')
    expect(rssStoryOthersLabelBlock(decart)?.label).toBe('+2 sources')
  })

  it('counts a story read once any copy is', () => {
    const read = { ...nasdaq, read: true }
    const stories = groupRssStoriesBlock([wsj, read, slashdot, ...filler].map(i => ({ item: i, feedId: i.feedId, feedTitle: i.feedId })))
    expect(stories.find(s => s.others.length > 0)?.read).toBe(true)
  })

  it('never joins stories days apart', () => {
    const later = item('nasdaq', 'Amazon in talks to buy AI startup Decart', '2026-10-20T10:00:00Z')
    const stories = groupRssStoriesBlock([wsj, later, ...filler].map(i => ({ item: i, feedId: i.feedId, feedTitle: i.feedId })))
    expect(stories.find(s => s.lead.item.id === later.id || s.others.some(m => m.item.id === later.id))?.others).toEqual([])
  })
})

describe('the inbox by day', () => {
  it('groups by day, then by source, trusted sources first', () => {
    const days = buildRssDayInboxBlock({
      feeds: [
        feed('ars', [item('ars', 'Chip plant opens in Arizona desert', '2026-10-22T15:00:00Z')]),
        feed('slashdot', [item('slashdot', 'New compiler released today for everyone', '2026-10-22T16:00:00Z'), item('slashdot', 'Old story from the week before', '2026-10-21T16:00:00Z')]),
      ],
      configs: [{ id: 'slashdot', url: 'x', title: 'Slashdot', trust: 'high' }, { id: 'ars', url: 'x', title: 'Ars' }],
    })
    expect(days.map(d => d.day)).toEqual(['2026-10-22', '2026-10-21'])
    expect(days[0].sources.map(s => s.feedId)).toEqual(['slashdot', 'ars'])
    expect(days[0].storyCount).toBe(2)
  })

  it('labels days plainly', () => {
    const now = new Date('2026-10-23T12:00:00')
    expect(rssDayLabelBlock('2026-10-23', now)).toBe('Today')
    expect(rssDayLabelBlock('2026-10-22', now)).toBe('Yesterday')
    expect(rssDayLabelBlock('2026-10-20', now)).toBe('Tuesday, Oct 20')
  })
})
