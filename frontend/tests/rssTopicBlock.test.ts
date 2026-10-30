import { describe, expect, it } from 'vitest'
import { parseFeedTopicsBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicsContractBlock'
import { emptyRssTopicsDayBlock, mergeRssTopicsBlock, rssTopicItemsBlock, rssTopicsNeedingCardBlock, rssTopicsShownBlock, rssTopicsUnsortedBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'

const item = (id: string, pubDate = '2026-10-30T15:00:00', summarized = true): RssFeedItemBlock => ({
  id, title: `Title ${id}`, link: '', description: '', pubDate,
  ...(summarized ? { aiSummary: { text: `- point ${id}`, model: 'm', version: 1, at: '' } } : {}),
} as unknown as RssFeedItemBlock)

describe('sorting answers', () => {
  it('reads "n | kind | name" lines and drops what does not parse or is out of range', () => {
    const out = parseFeedTopicsBlock('1 | mood | Chip stocks sell off\n2. | Subject | "Memory supply build-out"\nnoise\n9 | subject | Too far\n3 | other | Bad kind', 3)
    expect(out).toEqual([
      { n: 1, kind: 'mood', name: 'Chip stocks sell off' },
      { n: 2, kind: 'subject', name: 'Memory supply build-out' },
    ])
  })
})

describe("today's topics", () => {
  it('holds only today\'s articles the AI has read', () => {
    const items = [item('a'), item('b', '2026-10-29T15:00:00'), item('c', '2026-10-30T09:00:00', false)]
    expect(rssTopicItemsBlock(items, '2026-10-30').map(i => i.id)).toEqual(['a'])
  })

  it('merges by name in any case, sets aside what the model left out, and asks for key details from two articles', () => {
    const batch = [item('a'), item('b'), item('c')]
    let day = mergeRssTopicsBlock(emptyRssTopicsDayBlock('2026-10-30'), batch, [
      { n: 1, kind: 'subject', name: 'Memory supply build-out' },
      { n: 2, kind: 'subject', name: 'memory supply build-out' },
    ])
    expect(day.topics).toHaveLength(1)
    expect(day.topics[0].members).toEqual(['a', 'b'])
    expect(day.skipped).toEqual(['c'])
    expect(rssTopicsUnsortedBlock(day, [...batch, item('d')]).map(i => i.id)).toEqual(['d'])
    expect(rssTopicsNeedingCardBlock(day, 1).map(t => t.name)).toEqual(['Memory supply build-out'])
    day = { ...day, topics: day.topics.map(t => ({ ...t, detail: 'x', detailMembers: ['a', 'b'], detailVersion: 1 })) }
    expect(rssTopicsNeedingCardBlock(day, 1)).toEqual([])
    day = mergeRssTopicsBlock(day, [item('d')], [{ n: 1, kind: 'subject', name: 'Memory Supply Build-Out' }])
    expect(rssTopicsNeedingCardBlock(day, 1)).toHaveLength(1)
    expect(rssTopicsShownBlock(day, [...batch, item('d')])[0].items.map(i => i.id)).toEqual(['a', 'b', 'd'])
  })
})
