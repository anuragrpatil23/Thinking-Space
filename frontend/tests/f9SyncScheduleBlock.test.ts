import { describe, expect, it } from 'vitest'
import { cadenceDueBlock, lastSettleBlock } from '@/personal_extension/services/lego_blocks/units/f9SyncScheduleBlock'

// November 2026 is standard time in New York: 5 PM there is 22:00 UTC
describe('the last settled close', () => {
  it('is today at 5 PM New York once that has passed', () => {
    expect(lastSettleBlock(new Date('2026-11-10T22:30:00Z')).toISOString()).toBe('2026-11-10T22:00:00.000Z')
  })
  it('is the day before between the bell and 5 PM, while the bar is not final', () => {
    expect(lastSettleBlock(new Date('2026-11-10T21:30:00Z')).toISOString()).toBe('2026-11-09T22:00:00.000Z')
  })
  it('is Friday over the weekend and on Monday morning', () => {
    expect(lastSettleBlock(new Date('2026-11-14T18:00:00Z')).toISOString()).toBe('2026-11-13T22:00:00.000Z')
    expect(lastSettleBlock(new Date('2026-11-16T13:00:00Z')).toISOString()).toBe('2026-11-13T22:00:00.000Z')
  })
  it('follows daylight time in the summer (5 PM is 21:00 UTC)', () => {
    expect(lastSettleBlock(new Date('2026-07-08T23:00:00Z')).toISOString()).toBe('2026-07-08T21:00:00.000Z')
  })
})

describe('what a cadence makes due', () => {
  const now = new Date('2026-11-10T22:30:00Z')
  const at = (iso: string) => Date.parse(iso)
  it('daily: once after each trading day settles, nothing twice over a weekend', () => {
    expect(cadenceDueBlock('daily', at('2026-11-10T21:59:00Z'), now)).toBe(true)
    expect(cadenceDueBlock('daily', at('2026-11-10T22:05:00Z'), now)).toBe(false)
    expect(cadenceDueBlock('daily', at('2026-11-13T23:00:00Z'), new Date('2026-11-15T18:00:00Z'))).toBe(false)
  })
  it('weekly, monthly, and on demand (never on its own)', () => {
    expect(cadenceDueBlock('weekly', at('2026-11-04T22:30:00Z'), now)).toBe(false)
    expect(cadenceDueBlock('weekly', at('2026-11-03T22:00:00Z'), now)).toBe(true)
    expect(cadenceDueBlock('monthly', at('2026-10-20T00:00:00Z'), now)).toBe(false)
    expect(cadenceDueBlock('monthly', at('2026-10-01T00:00:00Z'), now)).toBe(true)
    expect(cadenceDueBlock('on-demand', 0, now)).toBe(false)
  })
})
