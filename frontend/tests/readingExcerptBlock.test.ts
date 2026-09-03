import { describe, it, expect } from 'vitest'
import {
  MIN_LOCATION_DWELL_MS,
  MIN_SITTING_DWELL_MS,
  buildReadingExcerptBlock,
  isReadingWorthSummarisingBlock,
} from '@/services/lego_blocks/units/readingExcerptBlock'

const M = 60_000
const lorem = (n: number) => 'alpha beta gamma delta epsilon zeta eta theta '.repeat(n)

describe('buildReadingExcerptBlock', () => {
  // The selection principle: attention picks the excerpt. A page passed
  // through contributes nothing, however much text is on it.
  it('drops locations below the dwell floor', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.14', activeMs: 11 * M, text: lorem(20) },
      { label: 'p.20', activeMs: 2_000, text: lorem(20) },
    ])
    expect(out.used).toEqual(['p.14'])
    expect(out.text).not.toContain('p.20')
  })

  it('gives more of the budget to where the time went', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.14', activeMs: 20 * M, text: lorem(50) },
      { label: 'p.15', activeMs: 1 * M, text: lorem(50) },
    ])
    const p14 = out.text.split('[p.15]')[0]
    const p15 = out.text.slice(out.text.indexOf('[p.15]'))
    expect(p14.length).toBeGreaterThan(p15.length)
  })

  // One dominant page must not crowd out the shape of the sitting.
  it('caps any single location so others still appear', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.14', activeMs: 200 * M, text: lorem(200) },
      { label: 'p.15', activeMs: 1 * M, text: lorem(200) },
    ])
    expect(out.used).toContain('p.15')
  })

  it('stays inside the budget', () => {
    const out = buildReadingExcerptBlock(
      Array.from({ length: 12 }, (_, i) => ({
        label: `p.${i + 1}`, activeMs: 5 * M, text: lorem(100),
      })),
      2_400,
    )
    expect(out.text.length).toBeLessThanOrEqual(2_600)
  })

  it('labels each location so the model can say where something came from', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.14', activeMs: 5 * M, text: 'the point-contact transistor' },
    ])
    expect(out.text).toContain('[p.14] the point-contact transistor')
  })

  // A fragment ending mid-word reads as corruption and invites the model to
  // guess at it.
  it('clips on a word boundary and marks the cut', () => {
    const out = buildReadingExcerptBlock(
      [{ label: 'p.1', activeMs: 5 * M, text: lorem(100) }],
      300,
    )
    expect(out.text).toContain('…')
    // The clip must land on a whole word from the source, not mid-token.
    const lastWord = out.text.replace(/…$/, '').split(' ').pop()
    expect('alpha beta gamma delta epsilon zeta eta theta'.split(' ')).toContain(lastWord)
  })

  it('returns nothing when every location is noise', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.1', activeMs: 1_000, text: lorem(10) },
      { label: 'p.2', activeMs: 2_000, text: lorem(10) },
    ])
    expect(out).toEqual({ text: '', used: [] })
  })

  it('ignores locations with no text', () => {
    const out = buildReadingExcerptBlock([
      { label: 'region 1', activeMs: 10 * M, text: '   ' },
      { label: 'region 2', activeMs: 10 * M, text: 'the transistor' },
    ])
    expect(out.used).toEqual(['region 2'])
  })

  it('collapses whitespace so PDF line breaks do not eat the budget', () => {
    const out = buildReadingExcerptBlock([
      { label: 'p.1', activeMs: 5 * M, text: 'one\n\n   two\t\tthree' },
    ])
    expect(out.text).toBe('[p.1] one two three')
  })
})

describe('isReadingWorthSummarisingBlock', () => {
  // Flipping through forty pages at two seconds each is not reading, and a
  // model handed that will confabulate a theme confidently.
  it('refuses a sitting that never settled anywhere', () => {
    const locations = Array.from({ length: 40 }, (_, i) => ({
      label: `p.${i}`, activeMs: 2_000, text: lorem(10),
    }))
    expect(isReadingWorthSummarisingBlock(locations, 80_000)).toBe(false)
  })

  it('refuses a sitting shorter than the floor even if focused', () => {
    expect(isReadingWorthSummarisingBlock(
      [{ label: 'p.1', activeMs: 60_000, text: lorem(10) }],
      MIN_SITTING_DWELL_MS - 1,
    )).toBe(false)
  })

  it('accepts a sitting that genuinely settled', () => {
    expect(isReadingWorthSummarisingBlock(
      [{ label: 'p.14', activeMs: MIN_LOCATION_DWELL_MS, text: lorem(10) }],
      MIN_SITTING_DWELL_MS,
    )).toBe(true)
  })

  it('refuses when there is dwell but no extractable text', () => {
    expect(isReadingWorthSummarisingBlock(
      [{ label: 'p.14', activeMs: 20 * M, text: '' }],
      20 * M,
    )).toBe(false)
  })
})
