import { describe, expect, it } from 'vitest'
import { groupRssStoriesBlock, rssPublisherBlock, rssStoryPublishersBlock, type RssStoryMemberBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { splitStoryKeyBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import { parseStoryCardBlock } from '@/services/lego_blocks/units/intelligence/contracts/storyCardContractBlock'
import { storyNeedsCardBlock, type RssStoryCardBlock } from '@/services/orchestrators/rssStoryCardOrch'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'

const at = '2026-10-23T12:00:00Z'
function member(id: string, title: string, link: string, feedTitle: string, storyKey?: string): RssStoryMemberBlock {
  const item = { id, title, link, description: '', pubDate: at, read: false, ...(storyKey ? { aiSummary: { text: 'x', model: 'm', version: 2, at, storyKey } } : {}) } as unknown as RssFeedItemBlock
  return { item, feedId: feedTitle, feedTitle }
}

describe('publishers', () => {
  it('reads the outlet from the link', () => {
    expect(rssPublisherBlock(member('1', 't', 'https://www.theguardian.com/business/x', 'Guardian Business'))).toBe('theguardian.com')
    expect(rssPublisherBlock(member('1', 't', 'https://mobile.slashdot.org/story/1', 'Slashdot'))).toBe('slashdot.org')
    expect(rssPublisherBlock(member('1', 't', 'https://www.bbc.co.uk/news/x', 'BBC'))).toBe('bbc.co.uk')
    expect(rssPublisherBlock(member('1', 't', '', 'Some Feed'))).toBe('some feed')
  })

  it('counts one outlet through two of its feeds once', () => {
    const story = {
      lead: member('1', 't', 'https://www.theguardian.com/business/a', 'Guardian Business'),
      others: [member('2', 't', 'https://www.theguardian.com/technology/a', 'Guardian Technology'), member('3', 't', 'https://arstechnica.com/a', 'Ars')],
    }
    expect(rssStoryPublishersBlock(story).map(p => p.publisher)).toEqual(['theguardian.com', 'arstechnica.com'])
  })
})

describe('grouping by the AI story key', () => {
  it('joins differently worded headlines that share a key', () => {
    const filler = Array.from({ length: 30 }, (_, i) => member(`f${i}`, `Unrelated headline number ${i} about topic${i}`, `https://e${i}.com/a`, `F${i}`, `Company${i}; event${i} happened`))
    const a = member('a', 'Facebook parent tumbles on spending worries', 'https://wsj.com/a', 'WSJ', 'Meta; shares fall after quarterly earnings')
    const b = member('b', 'Zuckerberg capex plan spooks investors', 'https://bloomberg.com/b', 'Bloomberg', 'Meta; shares fall after earnings report')
    const stories = groupRssStoriesBlock([a, b, ...filler])
    const joined = stories.find(s => [s.lead, ...s.others].some(m => m.item.id === 'a'))
    expect([joined!.lead, ...joined!.others].map(m => m.item.id).sort()).toEqual(['a', 'b'])
  })
})

describe('contract outputs', () => {
  it('takes the story line off the summary', () => {
    expect(splitStoryKeyBlock('Meta shares fell 7% on Thursday.\nStory: Meta; shares fall after earnings')).toEqual({ body: 'Meta shares fell 7% on Thursday.', storyKey: 'Meta; shares fall after earnings' })
    expect(splitStoryKeyBlock('No key here.').storyKey).toBeNull()
  })

  it('parses a story card, with or without differences', () => {
    expect(parseStoryCardBlock('Reported: Comcast lost 300,000 broadband customers in the third quarter.\nDiffers: Ars names the CEO; WSJ gives the share price.'))
      .toEqual({ common: 'Comcast lost 300,000 broadband customers in the third quarter.', differ: 'Ars names the CEO; WSJ gives the share price.' })
    expect(parseStoryCardBlock('Reported: Comcast lost 300,000 broadband customers in the third quarter.\nDiffers: none')?.differ).toBeNull()
    expect(parseStoryCardBlock('nonsense')).toBeNull()
  })
})

describe('when a story needs a card', () => {
  const story = {
    lead: member('1', 't', 'https://arstechnica.com/a', 'Ars'),
    others: [member('2', 't', 'https://theregister.com/a', 'Register')],
    read: false,
  }
  const card = (publishers: string[], version = 1): RssStoryCardBlock => ({ members: ['1', '2'], publishers, common: 'c', differ: null, model: 'm', version, at })

  it('needs one when there is none, or a new publisher joined', () => {
    expect(storyNeedsCardBlock(story, [])).toBe(true)
    expect(storyNeedsCardBlock(story, [card(['arstechnica.com', 'theregister.com'])])).toBe(false)
    expect(storyNeedsCardBlock(story, [card(['arstechnica.com'])])).toBe(true)
  })

  it('never for one publisher', () => {
    expect(storyNeedsCardBlock({ ...story, others: [] }, [])).toBe(false)
  })
})
