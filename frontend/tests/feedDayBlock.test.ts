import { describe, expect, it } from 'vitest'
import { feedDayNowBlock, feedDaysAgoBlock, feedDaysEndingBlock, parseFeedDayBlock, shiftFeedDayBlock } from '@/personal_extension/services/lego_blocks/units/feedDayBlock'

describe('feedDayBlock', () => {
  it('takes only a past day from the address', () => {
    expect(parseFeedDayBlock('2026-10-29', '2026-10-31')).toBe('2026-10-29')
    expect(parseFeedDayBlock('2026-10-31', '2026-10-31')).toBeNull()
    expect(parseFeedDayBlock('2026-11-02', '2026-10-31')).toBeNull()
    expect(parseFeedDayBlock('yesterday', '2026-10-31')).toBeNull()
    expect(parseFeedDayBlock(null, '2026-10-31')).toBeNull()
  })

  it('steps across months and counts days back', () => {
    expect(shiftFeedDayBlock('2026-11-01', -1)).toBe('2026-10-31')
    expect(feedDaysEndingBlock('2026-11-02', 3)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02'])
    expect(feedDaysAgoBlock('2026-10-24', '2026-10-31')).toBe(7)
  })

  it('treats a past day as over and today as now', () => {
    const now = new Date('2026-10-31T10:00:00')
    expect(feedDayNowBlock('2026-10-31', now)).toBe(now)
    expect(feedDayNowBlock('2026-10-29', now).getHours()).toBe(23)
  })
})
