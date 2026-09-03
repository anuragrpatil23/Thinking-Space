/* How big a bitmap to rasterize for a PDF page, as opposed to how big the page
   is laid out on screen. Those are two different numbers and the viewer used to
   conflate them.

   Layout size is `naturalMetrics * displayedScale`. It must change the instant
   the user finishes a pinch, because it is what the scrollbar and the page box
   are made of. Raster size is whatever resolution the bitmap inside that box
   happens to be, and it is allowed to lag — the browser scales an existing
   bitmap into the new box for free, so a stale raster is momentarily soft
   rather than missing. That decoupling is the whole reason zoom can feel
   instant while pdf.js is still working.

   Two levers live here:

   1. **Quantization.** Re-rastering on every 3% scale change is most of the
      cost and none of the benefit. Raster scales snap to a ladder, so a pinch
      that travels from 1.00 to 1.18 reuses one bitmap and CSS covers the
      remainder.

   2. **A pixel budget.** iOS kills the WebContent process on a per-process
      memory limit (docs/contracts/IOS-MEMORY.md), and a page canvas is
      `width * height * 4` bytes of decoded bitmap that WebKit retains. At
      device pixel ratio 2 a fit-width page on an iPad is ~10 MP = 40 MB, and
      the render window holds several of them. The budget caps the backing
      store; CSS upscales past it. A slightly soft page beats a dead app. */

import type { PdfNaturalPageMetricsBlock } from './pdfViewportBlock'

/* Steps per doubling of scale. Four gives ~19% between neighbours: close
   enough that the CSS-bridged interval is never visibly soft, far enough that
   a slow pinch crosses only a handful of steps. */
const RASTER_SCALE_STEPS_PER_OCTAVE_BLOCK = 4

const MIN_RASTER_SCALE_BLOCK = 0.1
const MAX_RASTER_SCALE_BLOCK = 8

/* Backing-store area ceilings, in device pixels, per page.

   iOS is the constrained surface and also the one that dies rather than
   degrades, so it gets the tighter number: 6 MP is 24 MB decoded, and with the
   narrowed iOS render window (3 pages) that is ~72 MB of page bitmaps. Desktop
   has no comparable cliff and gets enough headroom to stay sharp at high zoom.

   These are starting points chosen from the memory arithmetic, not from a
   measurement on device. Re-check them with a jetsam trace before treating
   them as settled. */
export const IOS_MAX_PAGE_RASTER_PIXELS_BLOCK = 6_000_000
/* 16 MP was set without measuring what it costs to produce. pdf.js rasterizes
   on the main thread, so the budget is a *time* budget as much as a memory one,
   and a 16 MP page is roughly half a second of blocked main thread. 8 MP still
   exceeds any reasonable page at fit-width on a retina display. */
export const DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK = 8_000_000

export interface PdfRasterPlanBlock {
  /** Scale the bitmap is rasterized at, in CSS pixels per PDF unit. */
  rasterScale: number
  /** Device pixels per CSS pixel actually used for the backing store. */
  outputScale: number
  /** Backing-store dimensions, in device pixels. */
  canvasWidth: number
  canvasHeight: number
  /** True when the budget forced a bitmap coarser than the layout box. */
  budgetLimited: boolean
}

function isUsableBlock(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/* Snap to the geometric ladder, always rounding **up**. Rounding down would
   make the bitmap coarser than the box it fills, which is the one direction
   the user can see. */
export function quantizePdfRasterScaleBlock(scale: number): number {
  if (!isUsableBlock(scale)) return 1

  const clamped = Math.max(MIN_RASTER_SCALE_BLOCK, Math.min(scale, MAX_RASTER_SCALE_BLOCK))
  const step = Math.ceil(Math.log2(clamped) * RASTER_SCALE_STEPS_PER_OCTAVE_BLOCK)
  const quantized = 2 ** (step / RASTER_SCALE_STEPS_PER_OCTAVE_BLOCK)

  /* Floating point can land the ladder a hair under the request; nudge to the
     next step rather than shipping a bitmap that is 0.001 too coarse. */
  const corrected = quantized < clamped
    ? 2 ** ((step + 1) / RASTER_SCALE_STEPS_PER_OCTAVE_BLOCK)
    : quantized

  return Math.min(Number(corrected.toFixed(4)), MAX_RASTER_SCALE_BLOCK)
}

export function resolvePdfRasterPixelBudgetBlock(isIosSurface: boolean): number {
  return isIosSurface ? IOS_MAX_PAGE_RASTER_PIXELS_BLOCK : DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK
}

/* The plan for one page at one zoom level.

   Order of degradation matters. When the budget is exceeded we give up device
   pixel ratio first — dropping from 2x to 1.4x on a retina panel is far less
   visible than dropping the raster scale below the layout box, because the
   latter also softens at 1x. Only once outputScale has bottomed out at 1 do we
   let the raster scale fall behind the layout. */
export function computePdfRasterPlanBlock(params: {
  displayedScale: number
  devicePixelRatio: number
  pageMetrics: PdfNaturalPageMetricsBlock
  maxPagePixels: number
}): PdfRasterPlanBlock {
  const displayedScale = isUsableBlock(params.displayedScale) ? params.displayedScale : 1
  const requestedDpr = isUsableBlock(params.devicePixelRatio) ? params.devicePixelRatio : 1
  const budget = isUsableBlock(params.maxPagePixels)
    ? params.maxPagePixels
    : DESKTOP_MAX_PAGE_RASTER_PIXELS_BLOCK

  const naturalWidth = isUsableBlock(params.pageMetrics?.width) ? params.pageMetrics.width : 612
  const naturalHeight = isUsableBlock(params.pageMetrics?.height) ? params.pageMetrics.height : 792

  let rasterScale = quantizePdfRasterScaleBlock(displayedScale)
  let outputScale = requestedDpr
  let budgetLimited = false

  const pixelsAt = (scale: number, dpr: number) =>
    naturalWidth * scale * dpr * naturalHeight * scale * dpr

  if (pixelsAt(rasterScale, outputScale) > budget) {
    budgetLimited = true

    /* Largest dpr that fits, then clamp to [1, requested]. */
    const areaAtOneDpr = pixelsAt(rasterScale, 1)
    const fittedDpr = Math.sqrt(budget / areaAtOneDpr)
    outputScale = Math.max(1, Math.min(requestedDpr, fittedDpr))

    if (pixelsAt(rasterScale, outputScale) > budget) {
      /* dpr is already at 1 and it still does not fit — the page itself is
         enormous or the zoom is extreme. Now the raster scale gives way, and
         CSS carries the difference. */
      const naturalArea = naturalWidth * naturalHeight
      rasterScale = Math.max(MIN_RASTER_SCALE_BLOCK, Math.sqrt(budget / naturalArea))
      outputScale = 1
    }
  }

  return {
    rasterScale,
    outputScale,
    canvasWidth: Math.max(1, Math.floor(naturalWidth * rasterScale * outputScale)),
    canvasHeight: Math.max(1, Math.floor(naturalHeight * rasterScale * outputScale)),
    budgetLimited,
  }
}

/* A plan is worth re-rastering for only when it actually differs. Callers key
   their render effect on this so a pinch that stays inside one ladder step
   never cancels an in-flight render. */
export function pdfRasterPlanKeyBlock(plan: PdfRasterPlanBlock): string {
  return `${plan.canvasWidth}x${plan.canvasHeight}`
}
