import { describe, expect, it } from 'vitest'
import { BREAK_QUOTES, BUILD_QUOTES, quoteForDay } from '@/services/lego_blocks/units/breakQuotesBlock'

const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute)

describe('breakQuotesBlock', () => {
  it('shows a build quote through the day and evening', () => {
    for (const hour of [5, 9, 12, 17, 20, 22]) {
      expect(BUILD_QUOTES).toContain(quoteForDay(at(hour)))
    }
  })

  it('shows a wind-down quote only in the late phase (23:00–05:00)', () => {
    expect(BREAK_QUOTES).toContain(quoteForDay(at(23)))
    expect(BREAK_QUOTES).toContain(quoteForDay(at(2)))
    expect(BREAK_QUOTES).toContain(quoteForDay(at(4, 59)))
  })

  it('keeps one quote for the whole day within a set', () => {
    expect(quoteForDay(at(6))).toBe(quoteForDay(at(22, 59)))
  })

  it('rotates to the next quote the following day', () => {
    const today = BUILD_QUOTES.indexOf(quoteForDay(at(12)))
    const tomorrow = BUILD_QUOTES.indexOf(quoteForDay(new Date(2026, 9, 13, 12)))
    expect(tomorrow).toBe((today + 1) % BUILD_QUOTES.length)
  })

  it('never repeats a quote within or across the sets', () => {
    const texts = [...BUILD_QUOTES, ...BREAK_QUOTES].map(q => q.text)
    expect(new Set(texts).size).toBe(texts.length)
  })
})
