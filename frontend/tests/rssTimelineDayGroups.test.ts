import { describe, expect, it } from 'vitest'
import {
  buildRssTimelineDayGroupsBlock,
  rssItemDayKeyBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'

/** Local-time ISO string for a given local calendar day + hour. */
function localAt(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month - 1, day, hour).toISOString()
}

const NOW = new Date(2026, 7, 22, 12, 0) // Sat 22 Aug 2026, local

describe('rssItemDayKeyBlock', () => {
  it('keys by local calendar day, not UTC', () => {
    // An evening article must not land on the next day's header just because
    // UTC has already rolled over.
    expect(rssItemDayKeyBlock(localAt(2026, 8, 21, 23))).toBe('2026-08-21')
  })

  it('returns null for missing or unparseable dates', () => {
    expect(rssItemDayKeyBlock(null)).toBeNull()
    expect(rssItemDayKeyBlock('not a date')).toBeNull()
  })
})

describe('buildRssTimelineDayGroupsBlock', () => {
  it('labels the most recent days relatively', () => {
    const groups = buildRssTimelineDayGroupsBlock([
      localAt(2026, 8, 22, 9),
      localAt(2026, 8, 21, 18),
    ], NOW)
    expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday'])
  })

  it('uses a weekday name inside the last week', () => {
    const groups = buildRssTimelineDayGroupsBlock([localAt(2026, 8, 18, 10)], NOW)
    expect(groups[0].label).toBe('Tuesday')
  })

  it('counts articles per day and records where each day starts', () => {
    const groups = buildRssTimelineDayGroupsBlock([
      localAt(2026, 8, 22, 11),
      localAt(2026, 8, 22, 9),
      localAt(2026, 8, 21, 20),
      localAt(2026, 8, 21, 8),
      localAt(2026, 8, 21, 7),
    ], NOW)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ count: 2, firstIndex: 0 })
    expect(groups[1]).toMatchObject({ count: 3, firstIndex: 2 })
  })

  it('collects undated articles rather than dropping them', () => {
    const groups = buildRssTimelineDayGroupsBlock([localAt(2026, 8, 22, 9), null, null], NOW)
    expect(groups[1]).toMatchObject({ key: '__undated__', label: 'No date', count: 2, firstIndex: 1 })
  })

  it('firstIndex always points at that day in the source list', () => {
    const dates = [
      localAt(2026, 8, 22, 11),
      localAt(2026, 8, 20, 9),
      localAt(2026, 8, 20, 8),
      localAt(2026, 8, 1, 8),
    ]
    for (const group of buildRssTimelineDayGroupsBlock(dates, NOW)) {
      const keyAtIndex = rssItemDayKeyBlock(dates[group.firstIndex]) ?? '__undated__'
      expect(keyAtIndex).toBe(group.key)
    }
  })

  it('returns nothing for an empty list', () => {
    expect(buildRssTimelineDayGroupsBlock([], NOW)).toEqual([])
  })
})
