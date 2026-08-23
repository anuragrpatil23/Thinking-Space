import { describe, expect, it } from 'vitest'
import {
  buildRssCalendarWeeksBlock,
  rssMonthLabelBlock,
  rssMonthOfDayKeyBlock,
} from '../src/services/lego_blocks/units/rssFeedBlock'

const counts = new Map([
  ['2026-08-21', { unread: 3, total: 82 }],
  ['2026-08-23', { unread: 0, total: 31 }],
])

describe('buildRssCalendarWeeksBlock', () => {
  it('lays the month out as rectangular weeks of seven', () => {
    const weeks = buildRssCalendarWeeksBlock(2026, 7, counts)
    for (const week of weeks) expect(week).toHaveLength(7)
  })

  it('pads the leading gap so day 1 lands on its weekday', () => {
    // 1 Aug 2026 is a Saturday, so the first week has six leading blanks.
    const weeks = buildRssCalendarWeeksBlock(2026, 7, counts)
    expect(weeks[0].slice(0, 6).every(cell => cell === null)).toBe(true)
    expect(weeks[0][6]?.day).toBe(1)
  })

  it('covers every day of the month exactly once', () => {
    const days = buildRssCalendarWeeksBlock(2026, 7, counts)
      .flat().filter(Boolean).map(cell => cell!.day)
    expect(days).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
  })

  it('attaches counts to their day and zeroes the rest', () => {
    const cells = buildRssCalendarWeeksBlock(2026, 7, counts).flat().filter(Boolean)
    expect(cells.find(c => c!.key === '2026-08-21')).toMatchObject({ unread: 3, total: 82 })
    expect(cells.find(c => c!.key === '2026-08-23')).toMatchObject({ unread: 0, total: 31 })
    expect(cells.find(c => c!.key === '2026-08-22')).toMatchObject({ unread: 0, total: 0 })
  })

  it('handles February in a leap year', () => {
    const days = buildRssCalendarWeeksBlock(2024, 1, new Map()).flat().filter(Boolean)
    expect(days).toHaveLength(29)
  })
})

describe('rssMonthOfDayKeyBlock', () => {
  it('reads the month out of a day key', () => {
    expect(rssMonthOfDayKeyBlock('2026-08-21')).toEqual({ year: 2026, monthIndex: 7 })
  })

  it('falls back for the undated bucket', () => {
    const fallback = new Date(2026, 4, 9)
    expect(rssMonthOfDayKeyBlock('__undated__', fallback)).toEqual({ year: 2026, monthIndex: 4 })
  })
})

describe('rssMonthLabelBlock', () => {
  it('names the month and year', () => {
    expect(rssMonthLabelBlock(2026, 7)).toBe('August 2026')
  })
})
