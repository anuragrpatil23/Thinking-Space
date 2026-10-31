import { describe, expect, it } from 'vitest'
import { mergeRssOutsideBlock, rssNoteSlotBlock, rssOutsideCountsBlock, rssThemeDigestsBlock, rssThemeNotesNeededBlock, setRssThemeNoteBlock, type RssTopicBlock, type RssTopicsDayBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import { parseFeedOutsideMatchBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedOutsideMatchContractBlock'
import { cleanFeedThemeNoteBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedThemeNoteContractBlock'

const topic = (id: string, over: Partial<RssTopicBlock> = {}): RssTopicBlock => ({
  id, name: id, kind: 'subject', members: [], detail: null, detailMembers: [], detailVersion: 0, ...over,
})
const day = (over: Partial<RssTopicsDayBlock> = {}): RssTopicsDayBlock => ({
  day: '2026-10-30', skipped: [],
  topics: [topic('Intel Q3 earnings', { theme: 'Intel' }), topic('Nvidia falls', { kind: 'mood', theme: 'Chips' })],
  ...over,
})
const out = (id: string, source: string, headline = false) => ({ item: { id }, source, headline })

describe('outside articles', () => {
  it('places them against the day: a known topic, a known theme, or Elsewhere', () => {
    const placed = mergeRssOutsideBlock(day(), [out('a', 'Bloomberg', true), out('b', 'FT'), out('c', 'WSJ'), out('d', 'AP'), out('e', 'Ad')], [
      { n: 1, kind: 'topic', name: 'intel q3 earnings' },
      { n: 2, kind: 'theme', name: 'Intel' },
      { n: 3, kind: 'topic', name: 'A topic the day does not have' },
      { n: 4, kind: 'elsewhere', name: 'Space' },
    ]).outside
    expect(placed).toEqual({
      a: { kind: 'topic', name: 'Intel Q3 earnings', source: 'Bloomberg', headline: true },
      b: { kind: 'theme', name: 'Intel', source: 'FT', headline: false },
      c: { kind: 'elsewhere', name: 'A topic the day does not have', source: 'WSJ', headline: false },
      d: { kind: 'elsewhere', name: 'Space', source: 'AP', headline: false },
      e: { kind: 'skip', name: '', source: 'Ad', headline: false },
    })
  })

  it('parses the model lines, a skip without a name too', () => {
    expect(parseFeedOutsideMatchBlock('1 | topic | Intel Q3 earnings\n2 | skip |\n3 | Elsewhere | "Space"\nnoise', 3))
      .toEqual([{ n: 1, kind: 'topic', name: 'Intel Q3 earnings' }, { n: 2, kind: 'skip', name: '' }, { n: 3, kind: 'elsewhere', name: 'Space' }])
  })
})

describe('theme paragraphs at fixed times', () => {
  it('slots today by the hour, and a past day as final', () => {
    expect(rssNoteSlotBlock('2026-10-31', new Date('2026-10-31T08:00:00'))).toBe('0')
    expect(rssNoteSlotBlock('2026-10-31', new Date('2026-10-31T14:30:00'))).toBe('13')
    expect(rssNoteSlotBlock('2026-10-30', new Date('2026-10-31T14:30:00'))).toBe('final')
  })

  it('writes a theme once a slot, again only when its articles changed, and leaves headlines out', () => {
    const base = mergeRssOutsideBlock(day(), [out('a', 'Bloomberg', true), out('b', 'FT'), out('c', 'AP')], [
      { n: 1, kind: 'topic', name: 'Intel Q3 earnings' }, { n: 2, kind: 'theme', name: 'Intel' }, { n: 3, kind: 'elsewhere', name: 'Space' },
    ])
    const due = rssThemeNotesNeededBlock(base, '9', 1)
    expect(due.map(d => [d.theme, d.elsewhere, d.members])).toEqual([['Intel', false, ['b']], ['Space', true, ['c']]])
    const written = setRssThemeNoteBlock(base, { theme: 'Intel', elsewhere: false, text: 'FT reports …', members: ['b'], slot: '9', version: 1 })
    expect(rssThemeNotesNeededBlock(written, '9', 1).map(d => d.theme)).toEqual(['Space'])
    // Same slot, a new article: it waits for the next slot
    const more = mergeRssOutsideBlock(written, [out('f', 'Reuters')], [{ n: 1, kind: 'theme', name: 'Intel' }])
    expect(rssThemeNotesNeededBlock(more, '9', 1).map(d => d.theme)).toEqual(['Space'])
    expect(rssThemeNotesNeededBlock(more, '13', 1).map(d => d.theme)).toEqual(['Intel', 'Space'])
  })

  it('takes NONE as nothing more', () => {
    expect(cleanFeedThemeNoteBlock('NONE')).toBeNull()
    expect(cleanFeedThemeNoteBlock('Points:\n- Intel cut its fab plans by half [Bloomberg]\n* SK Hynix grew HBM sales 40% [FT, WSJ]')).toBe('- Intel cut its fab plans by half [Bloomberg]\n- SK Hynix grew HBM sales 40% [FT, WSJ]')
    expect(cleanFeedThemeNoteBlock('Bloomberg reports Intel cut its fab plans by half.')).toBe('- Bloomberg reports Intel cut its fab plans by half.')
  })
})

describe('theme digests', () => {
  it('cites topics by outlet, labels market themes, and keeps Elsewhere only with a paragraph', () => {
    let state = mergeRssOutsideBlock(day(), [out('a', 'Bloomberg', true), out('b', 'FT'), out('c', 'FT'), out('d', 'AP'), out('e', 'WSJ'), out('g', 'CNBC')], [
      { n: 1, kind: 'topic', name: 'Intel Q3 earnings' },
      { n: 2, kind: 'topic', name: 'Intel Q3 earnings' },
      { n: 3, kind: 'theme', name: 'Intel' },
      { n: 4, kind: 'elsewhere', name: 'Space' },
      { n: 5, kind: 'elsewhere', name: 'Banks' },
      { n: 6, kind: 'topic', name: 'Nvidia falls' },
    ])
    state = setRssThemeNoteBlock(state, { theme: 'Space', elsewhere: true, text: 'AP reports a launch.', members: ['d'], slot: '9', version: 1 })
    const { themes, elsewhere } = rssThemeDigestsBlock(state)
    expect(themes.get('Intel')).toEqual({ note: null, cited: [{ topic: 'Intel Q3 earnings', sources: ['Bloomberg', 'FT'] }], sources: ['Bloomberg', 'FT'], itemIds: ['a', 'b', 'c'] })
    expect(themes.get('Market · Chips')?.cited).toEqual([{ topic: 'Nvidia falls', sources: ['CNBC'] }])
    expect([...elsewhere.keys()]).toEqual(['Space'])
  })
})

describe('other-source counts', () => {
  it('counts articles and outlets per topic and per theme, headlines included', () => {
    const state = mergeRssOutsideBlock(day(), [out('a', 'Bloomberg', true), out('b', 'FT'), out('c', 'FT'), out('d', 'CNBC'), out('e', 'AP')], [
      { n: 1, kind: 'topic', name: 'Intel Q3 earnings' },
      { n: 2, kind: 'topic', name: 'Intel Q3 earnings' },
      { n: 3, kind: 'theme', name: 'Intel' },
      { n: 4, kind: 'topic', name: 'Nvidia falls' },
      { n: 5, kind: 'elsewhere', name: 'Space' },
    ])
    const { byTheme, byTopic } = rssOutsideCountsBlock(state)
    expect(byTopic.get('Intel Q3 earnings')).toEqual({ articles: 2, outlets: 2, outletNames: ['Bloomberg', 'FT'] })
    expect(byTheme.get('Intel')).toMatchObject({ articles: 3, outlets: 2 })
    expect(byTheme.get('Market · Chips')).toMatchObject({ articles: 1, outlets: 1 })
    expect(byTheme.has('Space')).toBe(false)
  })
})
