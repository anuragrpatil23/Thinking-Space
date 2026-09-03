import { describe, expect, it } from 'vitest'
import {
  advanceReaderChromeStateBlock,
  createReaderChromeStateBlock,
  READER_CHROME_HIDE_THRESHOLD_PX_BLOCK,
  READER_CHROME_SHOW_THRESHOLD_PX_BLOCK,
  READER_CHROME_TOP_ZONE_PX_BLOCK,
  type ReaderChromeStateBlock,
} from '@/services/lego_blocks/units/readerChromeVisibilityBlock'
import {
  applyPdfCropToMetricsBlock,
  computePdfCropBoxBlock,
  mergePdfCropBoxesBlock,
  readPdfTextItemBoxBlock,
  selectPdfCropSamplePagesBlock,
} from '@/services/lego_blocks/units/pdfMarginCropBlock'
import {
  applyPdfPaperThemeToImageDataBlock,
  isPdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'

const TALL = { scrollHeight: 20000, clientHeight: 900 }

function scrollToBlock(state: ReaderChromeStateBlock, scrollTop: number): ReaderChromeStateBlock {
  return advanceReaderChromeStateBlock(state, { ...TALL, scrollTop })
}

describe('readerChromeVisibilityBlock', () => {
  it('keeps chrome visible in the top zone', () => {
    const state = scrollToBlock(createReaderChromeStateBlock(), READER_CHROME_TOP_ZONE_PX_BLOCK - 1)
    expect(state.visible).toBe(true)
  })

  it('hides once a downward run passes the threshold', () => {
    let state: ReaderChromeStateBlock = {
      visible: true, anchorScrollTop: 200, lastScrollTop: 200, direction: 'down',
    }
    state = scrollToBlock(state, 200 + READER_CHROME_HIDE_THRESHOLD_PX_BLOCK)
    expect(state.visible).toBe(false)
  })

  it('ignores downward jitter below the threshold', () => {
    /* Seeded mid-document and settled: a fresh state at scrollTop 0 jumping to
       200 is a genuine 200px scroll and *should* hide. */
    let state: ReaderChromeStateBlock = {
      visible: true, anchorScrollTop: 200, lastScrollTop: 200, direction: 'down',
    }
    for (let offset = 1; offset < READER_CHROME_HIDE_THRESHOLD_PX_BLOCK; offset += 4) {
      state = scrollToBlock(state, 200 + offset)
    }
    expect(state.visible).toBe(true)
  })

  it('hides on a single decisive downward scroll', () => {
    const state = scrollToBlock(createReaderChromeStateBlock(), 400)
    expect(state.visible).toBe(false)
  })

  it('reveals again on an upward run, measured from the reversal not the last commit', () => {
    let state = scrollToBlock(createReaderChromeStateBlock(), 200)
    state = scrollToBlock(state, 400)
    expect(state.visible).toBe(false)

    state = scrollToBlock(state, 900)
    state = scrollToBlock(state, 900 - READER_CHROME_SHOW_THRESHOLD_PX_BLOCK)
    expect(state.visible).toBe(true)
  })

  it('never hides chrome on a document that barely scrolls', () => {
    let state = createReaderChromeStateBlock()
    for (const scrollTop of [100, 200, 300]) {
      state = advanceReaderChromeStateBlock(state, {
        scrollTop,
        scrollHeight: 1000,
        clientHeight: 900,
      })
    }
    expect(state.visible).toBe(true)
  })
})

describe('pdfMarginCropBlock', () => {
  const LETTER = { width: 612, height: 792 }

  it('reads a text item box from a pdf.js transform', () => {
    const box = readPdfTextItemBoxBlock({ transform: [12, 0, 0, 12, 90, 700], width: 300, str: 'x' })
    expect(box).toEqual({ left: 90, bottom: 700, width: 300, height: 12 })
  })

  it('ignores whitespace-only items, which would widen the box for nothing', () => {
    expect(readPdfTextItemBoxBlock({ transform: [12, 0, 0, 12, 0, 0], width: 500, str: '   ' })).toBeNull()
  })

  it('derives margins from the text block', () => {
    const crop = computePdfCropBoxBlock({
      itemBoxes: [
        { left: 90, bottom: 100, width: 432, height: 12 },
        { left: 90, bottom: 680, width: 432, height: 12 },
      ],
      pageMetrics: LETTER,
    })
    expect(crop.left).toBeCloseTo(78, 0)
    expect(crop.right).toBeCloseTo(78, 0)
    expect(crop.bottom).toBeCloseTo(88, 0)
  })

  it('refuses to crop more than 40% of an axis', () => {
    const crop = computePdfCropBoxBlock({
      itemBoxes: [{ left: 400, bottom: 400, width: 10, height: 10 }],
      pageMetrics: LETTER,
    })
    expect(crop.left).toBeLessThanOrEqual(LETTER.width * 0.4)
    expect(crop.top).toBeLessThanOrEqual(LETTER.height * 0.4)
  })

  it('ignores a crop too small to be worth a layout change', () => {
    const crop = computePdfCropBoxBlock({
      itemBoxes: [{ left: 4, bottom: 4, width: 604, height: 784 }],
      pageMetrics: LETTER,
    })
    expect(crop).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  })

  it('merges by taking the most conservative edge, so no sampled page loses content', () => {
    const merged = mergePdfCropBoxesBlock([
      { left: 80, right: 80, top: 60, bottom: 60 },
      { left: 40, right: 90, top: 70, bottom: 50 },
    ])
    expect(merged).toEqual({ left: 40, right: 80, top: 60, bottom: 50 })
  })

  it('samples a spread rather than the front matter', () => {
    const pages = selectPdfCropSamplePagesBlock(149)
    expect(pages.length).toBeGreaterThan(1)
    expect(Math.max(...pages)).toBeGreaterThan(100)
    expect(pages.every((page) => page >= 1 && page <= 149)).toBe(true)
  })

  it('returns every page when the document is smaller than the sample', () => {
    expect(selectPdfCropSamplePagesBlock(3)).toEqual([1, 2, 3])
  })

  it('shrinks metrics into cropped space, and refuses a crop that would invert them', () => {
    expect(applyPdfCropToMetricsBlock(LETTER, { left: 90, right: 90, top: 70, bottom: 70 }))
      .toEqual({ width: 432, height: 652 })
    expect(applyPdfCropToMetricsBlock(LETTER, { left: 400, right: 400, top: 0, bottom: 0 }))
      .toEqual(LETTER)
  })
})

describe('pdfPaperThemeBlock', () => {
  function pixelBlock(r: number, g: number, b: number): Uint8ClampedArray {
    return new Uint8ClampedArray([r, g, b, 255])
  }

  it('leaves the bitmap untouched on the original theme', () => {
    const data = pixelBlock(10, 20, 30)
    applyPdfPaperThemeToImageDataBlock(data, 'original')
    expect([...data]).toEqual([10, 20, 30, 255])
  })

  it('darkens paper and lightens ink on night, without inverting hue', () => {
    const paper = pixelBlock(255, 255, 255)
    applyPdfPaperThemeToImageDataBlock(paper, 'night')
    expect(paper[0]).toBeLessThan(60)

    const ink = pixelBlock(0, 0, 0)
    applyPdfPaperThemeToImageDataBlock(ink, 'night')
    expect(ink[0]).toBeGreaterThan(200)
  })

  it('keeps a red heading red rather than collapsing it onto the ramp', () => {
    const red = pixelBlock(200, 30, 30)
    applyPdfPaperThemeToImageDataBlock(red, 'night')
    expect(red[0]).toBeGreaterThan(red[1])
    expect(red[0]).toBeGreaterThan(red[2])
  })

  it('warms the page without going dark', () => {
    const paper = pixelBlock(255, 255, 255)
    applyPdfPaperThemeToImageDataBlock(paper, 'warm')
    expect(paper[0]).toBeGreaterThan(paper[2])
    expect(paper[0]).toBeGreaterThan(220)
  })

  it('preserves alpha', () => {
    const data = pixelBlock(120, 120, 120)
    applyPdfPaperThemeToImageDataBlock(data, 'sepia')
    expect(data[3]).toBe(255)
  })

  it('guards the theme name', () => {
    expect(isPdfPaperThemeBlock('sepia')).toBe(true)
    expect(isPdfPaperThemeBlock('neon')).toBe(false)
  })
})
