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
