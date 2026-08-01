import { describe, expect, it } from 'vitest'
import { noteAgeLabelBlock } from '@/services/lego_blocks/units/noteAgeBlock'

// `now` is pinned so the boundaries are assertable — an age label read against
// the wall clock is a test that changes its own answer overnight.
const NOW = Date.parse('2026-08-01T12:00:00Z')

describe('noteAgeLabelBlock', () => {
  it('counts days up to the 45-day boundary', () => {
    expect(noteAgeLabelBlock('2026-08-01', NOW)).toBe('0d')
    expect(noteAgeLabelBlock('2026-07-25', NOW)).toBe('7d')
    expect(noteAgeLabelBlock('2026-06-18', NOW)).toBe('44d')
  })

  it('switches to months past the boundary, coarsening as it grows', () => {
    // 45d ≈ 1.5 months — one decimal while the number is small enough for it
    // to mean something.
    expect(noteAgeLabelBlock('2026-06-17', NOW)).toBe('1.5 mo')
    // Past ten months the decimal is noise.
    expect(noteAgeLabelBlock('2025-08-01', NOW)).toBe('12 mo')
  })

  it('returns empty for a missing or unparseable date', () => {
    // A wrong age is worse than none: callers render nothing for ''.
    expect(noteAgeLabelBlock('', NOW)).toBe('')
    expect(noteAgeLabelBlock('not-a-date', NOW)).toBe('')
  })

  it('never reports a negative age for a future date', () => {
    expect(noteAgeLabelBlock('2027-01-01', NOW)).toBe('0d')
  })
})
