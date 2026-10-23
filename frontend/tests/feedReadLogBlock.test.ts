import { describe, expect, it } from 'vitest'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import type { RssDayInboxBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { buildFeedReadLogBlock, feedReadLogPathBlock, feedReadLogStoryCountBlock } from '@/personal_extension/services/lego_blocks/units/feedReadLogBlock'

const item = (id: string, title: string, pubDate: string, extra: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock => ({
  id, feedId: 'f', title, link: `https://example.com/${id}`, description: '', pubDate, imageUrl: null,
  read: false, viewedAt: null, dismissedAt: null, tags: [], keep: false, important: false, ...extra,
})

describe("the feed's daily record", () => {
  const day: RssDayInboxBlock = {
    day: '2026-10-23',
    storyCount: 2,
    unreadCount: 1,
    sources: [{
      feedId: 'slashdot',
      feedTitle: 'Slashdot',
      stories: [
        {
          lead: { item: item('a', 'Physicists Trap a [Single] Antimatter Particle', new Date(2026, 9, 23, 9, 14).toISOString(), {
            read: true,
            tags: ['research more'],
            aiSummary: { text: 'Researchers held one antiproton\nfor a month.', model: 'qwen', version: 1, at: '' },
          }), feedId: 'slashdot', feedTitle: 'Slashdot' },
          others: [{ item: item('b', 'Antimatter trapped', ''), feedId: 'nasdaq', feedTitle: 'Nasdaq' }],
          read: true,
        },
        { lead: { item: item('c', 'Quiet story', new Date(2026, 9, 23, 8, 0).toISOString()), feedId: 'slashdot', feedTitle: 'Slashdot' }, others: [], read: false },
      ],
    }],
  }

  it('writes one line per story in time order, a summary line only when the AI read it', () => {
    expect(buildFeedReadLogBlock(day)).toBe([
      '---',
      'day: 2026-10-23',
      'stories: 2',
      'read: 1',
      '---',
      '',
      '- 08:00 Slashdot · [Quiet story](https://example.com/c)',
      '- 09:14 Slashdot · [Physicists Trap a Single Antimatter Particle](https://example.com/a) · +1 · read · #research-more',
      '  Researchers held one antiproton for a month.',
      '',
    ].join('\n'))
  })

  it('knows how many stories a written day holds, and where it lives', () => {
    expect(feedReadLogStoryCountBlock(buildFeedReadLogBlock(day))).toBe(2)
    expect(feedReadLogPathBlock('acceleration_core/F9/F9-execution/', '2026-10-23')).toBe('acceleration_core/F9/F9-execution/feed/2026-10-23.md')
  })
})
