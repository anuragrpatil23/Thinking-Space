import { describe, expect, it } from 'vitest'
import {
  computePdfChapterProgressBlock,
  formatPdfChapterProgressBlock,
  pickPdfChapterStartsBlock,
} from '@/services/lego_blocks/units/pdfChapterProgressBlock'

describe('pickPdfChapterStartsBlock', () => {
  it('stays at the top level when it already is chapters', () => {
    const entries = [
      { title: 'One', page: 1, depth: 0 },
      { title: '1.1', page: 5, depth: 1 },
      { title: 'Two', page: 30, depth: 0 },
      { title: 'Three', page: 60, depth: 0 },
    ]
    expect(pickPdfChapterStartsBlock(entries, 90).map((s) => s.title)).toEqual(['One', 'Two', 'Three'])
  })

  it('descends past Parts to the chapters inside them', () => {
    const entries = [
      { title: 'Part I', page: 1, depth: 0 },
      { title: 'Ch 1', page: 1, depth: 1 },
      { title: 'Ch 2', page: 40, depth: 1 },
      { title: 'Ch 3', page: 80, depth: 1 },
      { title: 'Part II', page: 150, depth: 0 },
      { title: 'Ch 4', page: 151, depth: 1 },
      { title: 'Ch 5', page: 200, depth: 1 },
      { title: 'Ch 6', page: 250, depth: 1 },
    ]
    const starts = pickPdfChapterStartsBlock(entries, 300)
    expect(starts.map((s) => s.page)).toEqual([1, 40, 80, 150, 151, 200, 250])
    expect(starts[0].title).toBe('Part I')
  })

  it('drops out-of-range pages and needs two boundaries', () => {
    expect(pickPdfChapterStartsBlock([{ title: 'Only', page: 1, depth: 0 }], 20)).toEqual([])
    expect(pickPdfChapterStartsBlock([
      { title: 'A', page: 0, depth: 0 },
      { title: 'B', page: 3, depth: 0 },
      { title: 'C', page: 99, depth: 0 },
    ], 20)).toEqual([])
    expect(pickPdfChapterStartsBlock([], 20)).toEqual([])
  })
})

describe('computePdfChapterProgressBlock', () => {
  const starts = [
    { title: 'One', page: 3, depth: 0 },
    { title: 'Two', page: 30, depth: 0 },
  ]

  it('counts the pages after the current one, up to the next chapter', () => {
    expect(computePdfChapterProgressBlock(starts, 10, 50)).toEqual({ title: 'One', startPage: 3, pagesLeft: 19, nextTitle: 'Two' })
    expect(computePdfChapterProgressBlock(starts, 29, 50)).toEqual({ title: 'One', startPage: 3, pagesLeft: 0, nextTitle: 'Two' })
    expect(computePdfChapterProgressBlock(starts, 30, 50)).toEqual({ title: 'Two', startPage: 30, pagesLeft: 20, nextTitle: null })
  })

  it('has no chapter before the first bookmark', () => {
    expect(computePdfChapterProgressBlock(starts, 2, 50)).toBeNull()
    expect(computePdfChapterProgressBlock([], 2, 50)).toBeNull()
  })
})

describe('formatPdfChapterProgressBlock', () => {
  it('reads naturally at 0, 1 and many', () => {
    expect(formatPdfChapterProgressBlock({ title: '', startPage: 1, pagesLeft: 0, nextTitle: null })).toBe('last page of chapter')
    expect(formatPdfChapterProgressBlock({ title: '', startPage: 1, pagesLeft: 1, nextTitle: null })).toBe('1 page left in chapter')
    expect(formatPdfChapterProgressBlock({ title: '', startPage: 1, pagesLeft: 12, nextTitle: null })).toBe('12 pages left in chapter')
  })
})
