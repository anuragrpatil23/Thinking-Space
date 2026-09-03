import { describe, it, expect } from 'vitest'
import { describeReadingWhereBlock } from '@/services/lego_blocks/units/readingDigestBlock'

const M = 60_000

describe('describeReadingWhereBlock', () => {
  describe('pdf', () => {
    it('collapses contiguous pages into ranges', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf',
        maxPage: 19,
        pages: [12, 13, 14, 15, 16, 17, 18, 19].map(page => ({ page, activeMs: 5 * M })),
      }, 40 * M)
      expect(out).toContain('12–19')
      expect(out).toContain('8 pages')
    })

    it('keeps non-contiguous runs apart', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf',
        maxPage: 46,
        pages: [{ page: 12, activeMs: M }, { page: 31, activeMs: M }, { page: 45, activeMs: M }, { page: 46, activeMs: M }],
      }, 4 * M)
      expect(out).toContain('12, 31, 45–46')
    })

    it('names a page that genuinely dominated the sitting', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf',
        maxPage: 33,
        pages: [{ page: 31, activeMs: 20 * M }, { page: 32, activeMs: M }, { page: 33, activeMs: M }],
      }, 22 * M)
      expect(out).toContain('Longest on p.31')
    })

    // Naming a "longest" page when every page got the same time is noise
    // dressed up as a finding.
    it('stays quiet when no page dominated', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf',
        maxPage: 5,
        pages: [1, 2, 3, 4, 5].map(page => ({ page, activeMs: 2 * M })),
      }, 10 * M)
      expect(out).not.toContain('Longest')
    })

    it('reports a page reached but not dwelt on', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf',
        maxPage: 210,
        pages: [{ page: 12, activeMs: 10 * M }],
      }, 10 * M)
      expect(out).toContain('Reached p.210')
    })

    it('does not claim a page range when nothing was read', () => {
      const out = describeReadingWhereBlock({ kind: 'pdf', maxPage: 0, pages: [] }, 3 * M)
      expect(out).toBe('3m of measured attention.')
    })

    it('uses the singular for one page', () => {
      const out = describeReadingWhereBlock({
        kind: 'pdf', maxPage: 7, pages: [{ page: 7, activeMs: 5 * M }],
      }, 5 * M)
      expect(out).toContain('1 page —')
    })
  })

  describe('canvas', () => {
    it('reports how concentrated the sitting was', () => {
      const rect = { x: 0, y: 0, w: 100, h: 100 }
      const out = describeReadingWhereBlock({
        kind: 'canvas',
        stations: [
          { ...rect, activeMs: 3 * M },
          { ...rect, activeMs: M },
          { ...rect, activeMs: 210 * 1000 },
        ],
      }, 7 * M)
      expect(out).toContain('3 places')
      expect(out).toContain('% of it in one region')
    })

    it('stays quiet about concentration when attention was spread', () => {
      const rect = { x: 0, y: 0, w: 100, h: 100 }
      const out = describeReadingWhereBlock({
        kind: 'canvas',
        stations: [1, 2, 3, 4, 5].map(() => ({ ...rect, activeMs: 2 * M })),
      }, 10 * M)
      expect(out).not.toContain('one region')
    })

    it('uses the singular for one place', () => {
      const out = describeReadingWhereBlock({
        kind: 'canvas',
        stations: [{ x: 0, y: 0, w: 10, h: 10, activeMs: 5 * M }],
      }, 5 * M)
      expect(out).toContain('1 place')
    })
  })

  describe('scroll', () => {
    it('reports depth reached', () => {
      expect(describeReadingWhereBlock({ kind: 'scroll', max: 0.68 }, 12 * M))
        .toBe('12m, reaching 68% of the document.')
    })

    it('adds where it ended only when that differs from the deepest point', () => {
      const scrolledBack = describeReadingWhereBlock({ kind: 'scroll', max: 0.68, end: 0.20 }, 12 * M)
      expect(scrolledBack).toContain('Ended at 20%')
      const stayedPut = describeReadingWhereBlock({ kind: 'scroll', max: 0.68, end: 0.67 }, 12 * M)
      expect(stayedPut).not.toContain('Ended at')
    })
  })

  it('says something honest when the surface recorded nothing', () => {
    expect(describeReadingWhereBlock(undefined, 90_000)).toBe('2m of measured attention.')
  })

  it('formats durations the way a person would say them', () => {
    expect(describeReadingWhereBlock(undefined, 45_000)).toContain('45s')
    expect(describeReadingWhereBlock(undefined, 40 * M)).toContain('40m')
    expect(describeReadingWhereBlock(undefined, 120 * M)).toContain('2h')
    expect(describeReadingWhereBlock(undefined, 147 * M)).toContain('2h 27m')
  })
})
