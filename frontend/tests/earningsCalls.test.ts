import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {} }))

import { parseEarningsCallIndexBlock, parseEarningsCallPageBlock } from '../electron/src/lego_blocks/earningsCallsBlock'
import { earningsCallBucketBlock, earningsCallPlanBlock, shiftCallMonthBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'

describe('which file a call is saved as', () => {
  it('files a call under the nearest of Feb / May / Aug / Nov', () => {
    expect(earningsCallBucketBlock('2026-05-05', 'AMD')).toBe('2026-05')
    expect(earningsCallBucketBlock('2025-10-30', 'AAPL')).toBe('2025-11')
    expect(earningsCallBucketBlock('2026-07-22', 'TSLA')).toBe('2026-08')
  })

  it('wraps across the year end', () => {
    expect(earningsCallBucketBlock('2025-12-28', 'X')).toBe('2026-02')
    expect(earningsCallBucketBlock('2026-01-02', 'X')).toBe('2026-02')
  })

  it("shifts MU's calls one bucket earlier, as the vault does", () => {
    // MU's fiscal Q4 2026 call, held 2026-09-30, is MU/calls/2026-08.md
    expect(earningsCallBucketBlock('2026-09-30', 'MU')).toBe('2026-08')
    expect(earningsCallBucketBlock('2026-01-07', 'MU')).toBe('2025-11')
  })

  it('walks back a quarter at a time, across years', () => {
    expect(shiftCallMonthBlock('2026-08', -3)).toBe('2026-05')
    expect(shiftCallMonthBlock('2026-02', -3)).toBe('2025-11')
    expect(shiftCallMonthBlock('2026-10', -48)).toBe('2022-10')
  })

  it('asks for the next call once the newest is past due', () => {
    const file = (month: string) => ({ path: `x/${month}.md`, name: month, dateKey: Number(month.replace('-', '')) * 100 })
    const now = new Date('2026-10-10T12:00:00')
    expect(earningsCallPlanBlock(file('2026-08'), undefined, now)).toBe('current')
    expect(earningsCallPlanBlock(file('2026-05'), undefined, now)).toBe('ask')
    expect(earningsCallPlanBlock(null, undefined, now)).toBe('ask')
    expect(earningsCallPlanBlock(null, { at: '2026-10-10T08:00:00', result: 'no-new' }, now)).toBe('checked')
  })
})

describe('reading StockAnalysis pages', () => {
  it('lists the calls newest first', () => {
    const html = `<a href="/stocks/mu/transcripts/609470-q3-2026/">Q3</a><a href="/stocks/mu/transcripts/699706-q4-2026/">Q4</a>
      <a href="/stocks/mu/transcripts/699706-q4-2026/">again</a><a href="/stocks/amd/transcripts/1-q1-2026/">other</a>`
    expect(parseEarningsCallIndexBlock(html, 'mu')).toEqual([
      { slug: '699706-q4-2026', quarter: 4, fiscalYear: 2026 },
      { slug: '609470-q3-2026', quarter: 3, fiscalYear: 2026 },
    ])
  })

  it('reads the date and the speaker turns', () => {
    const html = `<h1 class="x">Earnings Call: Q4 2026</h1> <p class="text-sm font-semibold text-faded mt-1">Sep 30, 2026</p>
      <div id="transcript-panel-full">
        <div class="text-lg font-bold text-default">Operator</div>
        <p class="text-default"><span class="transcript-sentence">Welcome &amp; hello.</span> <span class="transcript-sentence">Please go ahead.</span></p>
        <div class="text-lg font-bold text-default">Sanjay Mehrotra</div>
        <p class="text-default"><span class="transcript-sentence">Record revenue.</span></p>
        <p class="text-default"><span class="transcript-sentence">Thank you.</span></p>
      </div>`
    expect(parseEarningsCallPageBlock(html)).toEqual({
      date: '2026-09-30',
      text: 'Operator: Welcome & hello. Please go ahead.\n\nSanjay Mehrotra: Record revenue.\n\nThank you.',
    })
    expect(parseEarningsCallPageBlock('<html>no transcript</html>')).toBeNull()
  })
})

describe('the call as Markdown', () => {
  it('adds frontmatter, a title, the two sections and bold speakers, keeping the words', async () => {
    const { formatEarningsCallBlock } = await import('@/personal_extension/services/lego_blocks/units/earningsCallFormatBlock')
    const body = [
      'Travis Axelrod: Welcome to the call. Elon has remarks.',
      'Elon Musk: One. Two. Three. Four. Five. Six.',
      'Travis Axelrod: Our first question comes from investors.',
      'Elon Musk: Yes.',
    ].join('\n')
    expect(formatEarningsCallBlock({ ticker: 'TSLA', date: '2026-04-22', quarter: '2026-05', body })).toBe([
      '---', 'ticker: TSLA', 'date: 2026-04-22', 'quarter: 2026-05', 'type: earnings-call', '---', '',
      '# TSLA earnings call · April 22, 2026', '',
      '## Prepared remarks', '',
      '**Travis Axelrod:** Welcome to the call. Elon has remarks.', '',
      '**Elon Musk:** One. Two. Three. Four. Five.', '',
      'Six.', '',
      '## Questions and answers', '',
      '**Travis Axelrod:** Our first question comes from investors.', '',
      '**Elon Musk:** Yes.', '',
    ].join('\n'))
  })
})
