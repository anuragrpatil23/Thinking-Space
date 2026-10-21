import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EPUB_READER_PREFS_BLOCK,
  MAX_EPUB_READING_POSITIONS_BLOCK,
  buildEpubReaderCssBlock,
  formatEpubChapterLabelBlock,
  isEpubDocumentPathBlock,
  stepEpubFontScaleBlock,
  withEpubReadingPositionBlock,
} from '@/services/lego_blocks/units/epubReaderBlock'

describe('epubReaderBlock', () => {
  it('recognises epub paths', () => {
    expect(isEpubDocumentPathBlock('Books/Gödel, Escher, Bach.EPUB')).toBe(true)
    expect(isEpubDocumentPathBlock('Books/notes.md')).toBe(false)
  })

  it('keeps publisher colours on original paper and overrides them on a tone', () => {
    const original = buildEpubReaderCssBlock(DEFAULT_EPUB_READER_PREFS_BLOCK, 'original')
    expect(original).not.toContain('color: inherit')
    const night = buildEpubReaderCssBlock(DEFAULT_EPUB_READER_PREFS_BLOCK, 'night')
    expect(night).toContain('color: inherit !important')
    expect(night).toContain('color-scheme: dark')
  })

  it('only overrides the font face when asked', () => {
    expect(buildEpubReaderCssBlock(DEFAULT_EPUB_READER_PREFS_BLOCK, 'original')).not.toContain('font-family')
    expect(buildEpubReaderCssBlock({ ...DEFAULT_EPUB_READER_PREFS_BLOCK, fontFace: 'serif' }, 'original')).toContain('Iowan Old Style')
  })

  it('steps type size along the ladder and holds at the ends', () => {
    expect(stepEpubFontScaleBlock(100, 1)).toBe(110)
    expect(stepEpubFontScaleBlock(100, -1)).toBe(90)
    expect(stepEpubFontScaleBlock(200, 1)).toBe(200)
    expect(stepEpubFontScaleBlock(80, -1)).toBe(80)
  })

  it('shortens numbered chapters and leaves named sections', () => {
    expect(formatEpubChapterLabelBlock('3. All Happy Companies Are Different')).toBe('Chapter 3')
    expect(formatEpubChapterLabelBlock('IV. Thrones')).toBe('Chapter IV')
    expect(formatEpubChapterLabelBlock('Chapter 12: The Ending')).toBe('Chapter 12')
    expect(formatEpubChapterLabelBlock('Preface: Zero to One')).toBe('Preface: Zero to One')
    expect(formatEpubChapterLabelBlock('I Am a Strange Loop')).toBe('I Am a Strange Loop')
  })

  it('evicts the oldest reading positions over the cap', () => {
    let store = {}
    for (let i = 0; i < MAX_EPUB_READING_POSITIONS_BLOCK; i += 1) {
      store = withEpubReadingPositionBlock(store, `book-${i}`, { cfi: 'epubcfi(/6/2)', fraction: 0, at: i })
    }
    const next = withEpubReadingPositionBlock(store, 'newest', { cfi: 'epubcfi(/6/4)', fraction: 0.5, at: 10_000 })
    expect(Object.keys(next)).toHaveLength(MAX_EPUB_READING_POSITIONS_BLOCK)
    expect(next).not.toHaveProperty('book-0')
    expect(next).toHaveProperty('newest')
  })
})
