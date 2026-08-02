import { describe, expect, it } from 'vitest'
import {
  buildPdfRenderedWindowBlock,
  computeDisplayedPdfScaleBlock,
  computePdfFitScaleBlock,
  computePdfPageHeightBlock,
  computePdfPageWidthBlock,
  computeZoomScrollAnchorBlock,
  resolvePdfPageMetricsBlock,
  rotatePdfPageMetricsBlock,
  type PdfNaturalPageMetricsBlock,
} from '@/services/lego_blocks/units/pdfViewportBlock'

const LETTER: PdfNaturalPageMetricsBlock = { width: 600, height: 780 }
const LANDSCAPE: PdfNaturalPageMetricsBlock = { width: 780, height: 600 }

describe('pdfViewportBlock', () => {
  it('derives fit-width scale from viewport width and natural page width', () => {
    expect(computePdfPageWidthBlock(1000)).toBe(976)
    expect(computePdfFitScaleBlock({
      viewportWidth: 1000,
      naturalPageWidth: 610,
    })).toBeCloseTo(1.6, 1)
  })

  it('resolves the displayed scale per zoom mode', () => {
    expect(computeDisplayedPdfScaleBlock({
      zoomMode: 'fit-width',
      scale: 1,
      viewportWidth: 900,
      pageMetrics: LETTER,
    })).toBeCloseTo(1.46, 2)

    expect(computeDisplayedPdfScaleBlock({
      zoomMode: 'manual',
      scale: 1.25,
      viewportWidth: 900,
      pageMetrics: LETTER,
    })).toBe(1.25)

    expect(computeDisplayedPdfScaleBlock({
      zoomMode: 'actual',
      scale: 1.25,
      viewportWidth: 900,
      pageMetrics: LETTER,
    })).toBe(1)
  })

  it('bounds fit-page by whichever axis runs out first', () => {
    /* Height is the binding constraint here: 576/780 < 876/600. */
    expect(computeDisplayedPdfScaleBlock({
      zoomMode: 'fit-page',
      scale: 1,
      viewportWidth: 900,
      viewportHeight: 600,
      pageMetrics: LETTER,
    })).toBeCloseTo(0.738, 3)
  })

  it('swaps the page box on quarter turns', () => {
    expect(rotatePdfPageMetricsBlock(LETTER, 90)).toEqual(LANDSCAPE)
    expect(rotatePdfPageMetricsBlock(LETTER, 180)).toEqual(LETTER)
    expect(rotatePdfPageMetricsBlock(LETTER, 270)).toEqual(LANDSCAPE)
  })

  it('estimates each page from its own metrics, not page one', () => {
    const metricsByPage = new Map([[1, LETTER], [2, LANDSCAPE]])
    const common = {
      zoomMode: 'manual' as const,
      scale: 1,
      viewportWidth: 900,
      metricsByPage,
      fallbackMetrics: LETTER,
    }

    expect(computePdfPageHeightBlock({ ...common, page: 1 })).toBe(780)
    expect(computePdfPageHeightBlock({ ...common, page: 2 })).toBe(600)
    /* Unmeasured pages fall back to a real measured page, not a guess. */
    expect(computePdfPageHeightBlock({ ...common, page: 3 })).toBe(780)
  })

  it('falls back through measured page then default metrics', () => {
    expect(resolvePdfPageMetricsBlock({
      page: 4,
      metricsByPage: new Map([[1, LANDSCAPE]]),
      fallbackMetrics: LETTER,
    })).toEqual(LETTER)

    expect(resolvePdfPageMetricsBlock({ page: 4 })).toEqual({ width: 612, height: 792 })
  })

  describe('computeZoomScrollAnchorBlock', () => {
    it('holds the document point under the focal point while zooming in', () => {
      /* The point 300px into the content sits under focalY=200; at 2x it moves
         to 600px, so the viewport must scroll to 400 to keep it there. */
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 100,
        scrollLeft: 0,
        focalX: 0,
        focalY: 200,
        prevScale: 1,
        nextScale: 2,
      })).toEqual({ scrollTop: 400, scrollLeft: 0 })
    })

    it('is a no-op when the scale does not change', () => {
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 137,
        scrollLeft: 42,
        focalX: 300,
        focalY: 200,
        prevScale: 1.4,
        nextScale: 1.4,
      })).toEqual({ scrollTop: 137, scrollLeft: 42 })
    })

    it('clamps to the top of the document when zooming out past it', () => {
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 100,
        scrollLeft: 0,
        focalX: 0,
        focalY: 200,
        prevScale: 2,
        nextScale: 1,
      })).toEqual({ scrollTop: 0, scrollLeft: 0 })
    })

    it('clamps to the scrollable range when content dimensions are known', () => {
      /* Content is 1000px at prevScale -> 2000px at 2x; with a 500px viewport
         the furthest legal offset is 1500. */
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 900,
        scrollLeft: 0,
        focalX: 0,
        focalY: 400,
        prevScale: 1,
        nextScale: 2,
        viewportHeight: 500,
        contentHeight: 1000,
      }).scrollTop).toBe(1500)
    })

    it('reports no horizontal scroll when the content is narrower than the viewport', () => {
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 0,
        scrollLeft: 0,
        focalX: 450,
        focalY: 0,
        prevScale: 1,
        nextScale: 1.2,
        viewportWidth: 900,
        contentWidth: 600,
      }).scrollLeft).toBe(0)
    })

    it('passes the offsets through unchanged for a degenerate scale', () => {
      expect(computeZoomScrollAnchorBlock({
        scrollTop: 50,
        scrollLeft: 10,
        focalX: 0,
        focalY: 0,
        prevScale: 0,
        nextScale: 2,
      })).toEqual({ scrollTop: 50, scrollLeft: 10 })
    })
  })

  it('builds a bounded render window around the active page', () => {
    expect(buildPdfRenderedWindowBlock({
      centerPage: 1,
      numPages: 10,
    })).toEqual({ start: 1, end: 3 })

    expect(buildPdfRenderedWindowBlock({
      centerPage: 5,
      numPages: 10,
    })).toEqual({ start: 3, end: 7 })

    expect(buildPdfRenderedWindowBlock({
      centerPage: 10,
      numPages: 10,
    })).toEqual({ start: 8, end: 10 })
  })
})
