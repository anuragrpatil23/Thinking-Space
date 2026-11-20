import { describe, expect, it } from 'vitest'
import { daysAheadBlock } from '@/personal_extension/services/lego_blocks/units/daysAheadBlock'

describe('daysAheadBlock', () => {
  const fri = new Date(2026, 10, 20, 15, 0).getTime() // Friday Nov 20, 2026, local time
  it('counts calendar days, and weekdays from tomorrow through the day', () => {
    expect(daysAheadBlock('2026-11-23', fri)).toEqual({ calendar: 3, trading: 1 }) // Sat, Sun, Mon
    expect(daysAheadBlock('2026-11-27', fri)).toEqual({ calendar: 7, trading: 5 })
    expect(daysAheadBlock('2026-11-20', fri)).toEqual({ calendar: 0, trading: 0 })
  })
  it('a day already past is negative, with no trading days', () => {
    expect(daysAheadBlock('2026-11-18', fri)).toEqual({ calendar: -2, trading: 0 })
  })
})
