import { describe, expect, it } from 'vitest'
import {
  appendFeedNoteBlock,
  feedTickerBlock,
  parseFeedNotesBlock,
  replaceFeedNoteBlock,
  type FeedNoteBlock,
} from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'
import { cleanArticleSummaryBlock, articleSummaryPointsBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import { feedArrivalsByHourBlock } from '@/personal_extension/components/lego_blocks/integrations/FeedOverviewBlock'
import { feedNotesToShowBlock } from '@/personal_extension/components/lego_blocks/integrations/FeedReadingNotesPanelBlock'

const note = (over: Partial<FeedNoteBlock>): FeedNoteBlock => ({
  id: 'n-1', kind: 'question', text: 'How does OCS fit with CPO?', done: false,
  itemId: 'feed::a', title: 'APC says <let> there be light -->', link: 'https://x.com/a', source: 'The Next Platform', ticker: null, at: '2026-10-23T12:00:00Z',
  ...over,
})

describe('reading notes file', () => {
  it('round-trips notes, even a headline that looks like a comment end', () => {
    const content = appendFeedNoteBlock(appendFeedNoteBlock(null, note({})), note({ id: 'n-2', kind: 'comment', text: 'Resolight to watch' }))
    expect(content.startsWith('# Reading notes')).toBe(true)
    const parsed = parseFeedNotesBlock(content)
    expect(parsed.map(n => [n.id, n.kind, n.text, n.title])).toEqual([
      ['n-1', 'question', 'How does OCS fit with CPO?', 'APC says <let> there be light -->'],
      ['n-2', 'comment', 'Resolight to watch', 'APC says <let> there be light -->'],
    ])
  })

  it('changes one line and keeps every other line, hand-written ones too', () => {
    const content = `${appendFeedNoteBlock(null, note({}))}- my own line\n${appendFeedNoteBlock('', note({ id: 'n-2' })).split('\n').slice(-2).join('\n')}`
    const done = replaceFeedNoteBlock(content, 'n-1', note({ done: true }))
    expect(done).toContain('- [x] How does OCS')
    expect(done).toContain('- my own line')
    const removed = replaceFeedNoteBlock(done, 'n-1', null)
    expect(parseFeedNotesBlock(removed).map(n => n.id)).toEqual(['n-2'])
    expect(removed).toContain('- my own line')
  })

  it('reads the company from the feed name', () => {
    expect(feedTickerBlock('NVDA Feed')).toBe('NVDA')
    expect(feedTickerBlock('NVDA - Press release')).toBe('NVDA')
    expect(feedTickerBlock('NASDAQ - TSLA')).toBe('TSLA')
    expect(feedTickerBlock('The Next Platform')).toBeNull()
  })

  it('shows open questions first, hides removed and done', () => {
    const now = Date.parse('2026-10-24T00:00:00Z')
    const shown = feedNotesToShowBlock([
      note({ id: 'c', kind: 'comment', at: '2026-10-23T13:00:00Z' }),
      note({ id: 'q', at: '2026-10-01T00:00:00Z' }),
      note({ id: 'd', done: true }),
      note({ id: 't', kind: 'tagged', removed: true }),
    ], now)
    expect(shown.map(n => n.id)).toEqual(['q', 'c'])
  })
})

describe('distilled points', () => {
  it('keeps one point per line, without bullets or bold', () => {
    const text = cleanArticleSummaryBlock('- **APC** approved standards.\n- Lumentum is sold out through 2029.\n\n* Nvidia showed CPO.')
    expect(articleSummaryPointsBlock(text!)).toEqual(['APC approved standards.', 'Lumentum is sold out through 2029.', 'Nvidia showed CPO.'])
  })
})

describe('arrivals by hour', () => {
  it('counts today by hour against the usual day, with no bars for hours to come', () => {
    const now = new Date(2026, 9, 23, 10, 30)
    const rows = feedArrivalsByHourBlock([
      { pubDate: new Date(2026, 9, 23, 9, 5).toISOString() },
      { pubDate: new Date(2026, 9, 23, 9, 40).toISOString() },
      { pubDate: new Date(2026, 9, 22, 9, 0).toISOString() },
    ], now)
    expect(rows[9]).toEqual({ hour: 9, today: 2, usual: 0.1 })
    expect(rows[11].today).toBeNull()
  })
})
