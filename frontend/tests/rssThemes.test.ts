import { describe, expect, it } from 'vitest'
import { addToRssThemeListBlock, parseRssThemeListBlock, serializeRssThemeListBlock } from '@/services/lego_blocks/units/rssThemeListBlock'
import { mergeRssThemesBlock, rssTopicsNeedingThemeBlock, type RssTopicBlock, type RssTopicsDayBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import { FEED_OTHER_THEME_BLOCK, parseFeedTopicThemesBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicThemesContractBlock'

const topic = (id: string, over: Partial<RssTopicBlock> = {}): RssTopicBlock => ({
  id, name: id, kind: 'subject', members: ['a'], detail: null, detailMembers: [], detailVersion: 0, ...over,
})
const day = (topics: RssTopicBlock[]): RssTopicsDayBlock => ({ day: '2026-10-30', topics, skipped: [] })

describe('theme list', () => {
  it('reads back what it writes, and keeps a hand-written line', () => {
    const list = addToRssThemeListBlock([], '2026-10-30', [topic('t1', { theme: 'Intel' }), topic('t2', { theme: 'Intel' }), topic('t3', { theme: 'Q3 earnings' })])
    const text = `${serializeRssThemeListBlock(list)}- Space\n`
    expect(parseRssThemeListBlock(text)).toEqual([
      { name: 'Intel', lastSeen: '2026-10-30', topics: 2 },
      { name: 'Q3 earnings', lastSeen: '2026-10-30', topics: 1 },
      { name: 'Space', lastSeen: '', topics: 0 },
    ])
  })

  it('keeps the list spelling for a theme named in another case', () => {
    const list = addToRssThemeListBlock([{ name: 'Intel', lastSeen: '2026-10-01', topics: 4 }], '2026-10-30', [topic('t1', { theme: 'intel' })])
    expect(list).toEqual([{ name: 'Intel', lastSeen: '2026-10-30', topics: 5 }])
  })
})

describe('placing topics under themes', () => {
  it('asks about subjects only, and files what the model left out under Other news', () => {
    const state = day([topic('a'), topic('b'), topic('m', { kind: 'mood' })])
    const work = rssTopicsNeedingThemeBlock(state, 1)
    expect(work.map(t => t.id)).toEqual(['a', 'b'])
    const placed = mergeRssThemesBlock(state, work, [{ n: 1, theme: 'intel' }], 1, ['Intel'])
    expect(placed.topics.map(t => t.theme ?? null)).toEqual(['Intel', FEED_OTHER_THEME_BLOCK, null])
    expect(rssTopicsNeedingThemeBlock(placed, 1)).toEqual([])
  })

  it('parses the model lines', () => {
    expect(parseFeedTopicThemesBlock('1 | Intel\n2. | "Q3 earnings"\nnoise\n9 | Too far', 2)).toEqual([{ n: 1, theme: 'Intel' }, { n: 2, theme: 'Q3 earnings' }])
  })
})
