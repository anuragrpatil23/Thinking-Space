import { describe, expect, it } from 'vitest'
import { issueDetailBlock, setPassItemBlock, type PassItemBlock } from '@/services/lego_blocks/units/passQueueBlock'

describe('a pass queue', () => {
  it('replaces one entry and keeps an article label', () => {
    const items: PassItemBlock[] = [{ ticker: 'MU', state: 'waiting' }, { ticker: 'nyt|1', label: 'NYT: Headline', state: 'waiting' }]
    const next = setPassItemBlock(setPassItemBlock(items, 'MU', 'fetched', 'Sep 2026 report'), 'nyt|1', 'no-new', 'Not found in the library')
    expect(next).toEqual([
      { ticker: 'MU', state: 'fetched', detail: 'Sep 2026 report' },
      { ticker: 'nyt|1', label: 'NYT: Headline', state: 'no-new', detail: 'Not found in the library' },
    ])
    expect(items[0].state).toBe('waiting')
  })

  it('names an issue by month', () => {
    expect(issueDetailBlock('2026-09-18')).toBe('Sep 2026 report')
    expect(issueDetailBlock(undefined)).toBeUndefined()
  })
})
