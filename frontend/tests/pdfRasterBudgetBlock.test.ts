import { describe, expect, it } from 'vitest'
import {
  computePdfRasterPlanBlock,
  DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK,
  IOS_MAX_PAGE_RASTER_PIXELS_BLOCK,
  pdfRasterPlanKeyBlock,
  quantizePdfRasterScaleBlock,
  resolvePdfRasterPixelBudgetBlock,
} from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
import type { PdfNaturalPageMetricsBlock } from '@/services/lego_blocks/units/pdfViewportBlock'

const LETTER: PdfNaturalPageMetricsBlock = { width: 612, height: 792 }

describe('quantizePdfRasterScaleBlock', () => {
  it('snaps to the ladder and never rounds below the request', () => {
    for (const requested of [0.31, 0.7, 1.0, 1.13, 1.5, 2.4, 3.7]) {
      expect(quantizePdfRasterScaleBlock(requested)).toBeGreaterThanOrEqual(requested)
    }
  })

  it('leaves exact ladder points alone', () => {
    expect(quantizePdfRasterScaleBlock(1)).toBe(1)
    expect(quantizePdfRasterScaleBlock(2)).toBe(2)
    expect(quantizePdfRasterScaleBlock(0.5)).toBe(0.5)
  })

  it('collapses a small zoom excursion onto one raster scale', () => {
    // The point of the ladder: a pinch across this range re-rasters once.
    expect(quantizePdfRasterScaleBlock(1.01)).toBe(quantizePdfRasterScaleBlock(1.18))
  })

  it('survives degenerate input', () => {
    expect(quantizePdfRasterScaleBlock(0)).toBe(1)
    expect(quantizePdfRasterScaleBlock(Number.NaN)).toBe(1)
    expect(quantizePdfRasterScaleBlock(-3)).toBeGreaterThan(0)
  })
})

describe('computePdfRasterPlanBlock', () => {
  it('uses full device pixel ratio when the page fits the budget', () => {
    const plan = computePdfRasterPlanBlock({
      displayedScale: 1,
      devicePixelRatio: 2,
      pageMetrics: LETTER,
      maxPagePixels: DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    expect(plan.outputScale).toBe(2)
    expect(plan.rasterScale).toBe(1)
    expect(plan.budgetLimited).toBe(false)
    expect(plan.canvasWidth).toBe(1224)
    expect(plan.canvasHeight).toBe(1584)
  })

  it('never exceeds the budget, whatever the zoom', () => {
    for (const displayedScale of [0.5, 1, 1.5, 2, 2.5, 4]) {
      const plan = computePdfRasterPlanBlock({
        displayedScale,
        devicePixelRatio: 3,
        pageMetrics: LETTER,
        maxPagePixels: IOS_MAX_PAGE_RASTER_PIXELS_BLOCK,
      })
      expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(IOS_MAX_PAGE_RASTER_PIXELS_BLOCK)
    }
  })

  it('gives up device pixel ratio before it gives up raster scale', () => {
    const plan = computePdfRasterPlanBlock({
      // Letter at 2x layout and 2x dpr is 7.75 MP, over the 6 MP iOS ceiling.
      displayedScale: 2,
      devicePixelRatio: 2,
      pageMetrics: LETTER,
      maxPagePixels: IOS_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    expect(plan.budgetLimited).toBe(true)
    // dpr absorbed the overage, so the bitmap still covers the layout box.
    expect(plan.outputScale).toBeLessThan(2)
    expect(plan.outputScale).toBeGreaterThan(1)
    expect(plan.rasterScale).toBeGreaterThanOrEqual(2)
  })

  it('drops raster scale only once dpr has bottomed out at 1', () => {
    const plan = computePdfRasterPlanBlock({
      displayedScale: 8,
      devicePixelRatio: 2,
      pageMetrics: LETTER,
      maxPagePixels: IOS_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    expect(plan.outputScale).toBe(1)
    expect(plan.rasterScale).toBeLessThan(8)
    expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(IOS_MAX_PAGE_RASTER_PIXELS_BLOCK)
  })

  it('falls back to Letter geometry rather than producing a zero-area canvas', () => {
    const plan = computePdfRasterPlanBlock({
      displayedScale: 1,
      devicePixelRatio: 1,
      pageMetrics: { width: 0, height: Number.NaN },
      maxPagePixels: DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    expect(plan.canvasWidth).toBe(612)
    expect(plan.canvasHeight).toBe(792)
  })
})

describe('resolvePdfRasterPixelBudgetBlock', () => {
  it('holds iOS to the tighter ceiling', () => {
    expect(resolvePdfRasterPixelBudgetBlock(true)).toBe(IOS_MAX_PAGE_RASTER_PIXELS_BLOCK)
    expect(resolvePdfRasterPixelBudgetBlock(false)).toBe(DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK)
    expect(IOS_MAX_PAGE_RASTER_PIXELS_BLOCK).toBeLessThan(DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK)
  })
})

describe('pdfRasterPlanKeyBlock', () => {
  it('is stable across scale changes that do not change the bitmap', () => {
    const near = computePdfRasterPlanBlock({
      displayedScale: 1.02,
      devicePixelRatio: 2,
      pageMetrics: LETTER,
      maxPagePixels: DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    const alsoNear = computePdfRasterPlanBlock({
      displayedScale: 1.17,
      devicePixelRatio: 2,
      pageMetrics: LETTER,
      maxPagePixels: DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK,
    })
    expect(pdfRasterPlanKeyBlock(near)).toBe(pdfRasterPlanKeyBlock(alsoNear))
  })
})
