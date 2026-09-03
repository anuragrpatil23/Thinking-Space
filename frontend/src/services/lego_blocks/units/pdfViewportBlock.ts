/* Viewport math for the PDF viewer: page geometry, zoom modes, and the
   scroll anchoring that keeps a focal point fixed across a zoom re-raster.

   Page geometry is per-page on purpose. pdf.js documents routinely mix
   portrait/landscape and paper sizes, so estimating every page from page 1
   makes the scrollbar lie and the content jump as real pages render in. */

export interface PdfNaturalPageMetricsBlock {
  width: number
  height: number
}

export const DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK: PdfNaturalPageMetricsBlock = {
  width: 612,
  height: 792,
}

/* 'manual' means the user set an explicit scale; the fit modes recompute
   their scale from the viewport on every resize. */
export type PdfZoomModeBlock = 'fit-width' | 'fit-page' | 'actual' | 'manual'

export type PdfRotationBlock = 0 | 90 | 180 | 270

export type PdfPageMetricsMapBlock = ReadonlyMap<number, PdfNaturalPageMetricsBlock>

const PDF_VIEWPORT_HORIZONTAL_PADDING_BLOCK = 24
const PDF_VIEWPORT_VERTICAL_PADDING_BLOCK = 24
const PDF_RENDER_OVERSCAN_PAGES_BLOCK = 2

/* How far from the reader a page keeps the bitmap it already drew.

   A single window meant a page was torn down the moment it left it, so
   scrolling back one page showed an empty box where a rendered page had been a
   second earlier — the reader outrunning the renderer in both directions. The
   retain band is wider than the render band and costs nothing but memory: those
   pages are never re-rastered, they simply keep the pixels they have. They go
   soft after a zoom until they re-enter the render band, which is a far better
   failure than going blank. */
export const PDF_RETAIN_PAGES_DESKTOP_BLOCK = 6
export const PDF_RETAIN_PAGES_IOS_BLOCK = 4
const MIN_PDF_PAGE_HEIGHT_BLOCK = 160

function isUsableMetricBlock(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normalizeMetricsBlock(
  metrics: PdfNaturalPageMetricsBlock | null | undefined,
): PdfNaturalPageMetricsBlock {
  const width = isUsableMetricBlock(metrics?.width)
    ? metrics.width
    : DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK.width
  const height = isUsableMetricBlock(metrics?.height)
    ? metrics.height
    : DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK.height
  return { width, height }
}

/* Quarter turns swap the box the page occupies on screen. Callers pass the
   already-rotated metrics into every scale/height computation so rotation
   never has to be special-cased downstream. */
export function rotatePdfPageMetricsBlock(
  metrics: PdfNaturalPageMetricsBlock | null | undefined,
  rotation: PdfRotationBlock = 0,
): PdfNaturalPageMetricsBlock {
  const normalized = normalizeMetricsBlock(metrics)
  if (rotation === 90 || rotation === 270) {
    return { width: normalized.height, height: normalized.width }
  }
  return normalized
}

/* Per-page metrics with a graceful fallback chain: measured page -> the
   caller's fallback (usually page 1, measured eagerly on load) -> Letter.
   Pages not yet measured therefore estimate from a real page, not a guess. */
export function resolvePdfPageMetricsBlock(params: {
  page: number
  metricsByPage?: PdfPageMetricsMapBlock | null
  fallbackMetrics?: PdfNaturalPageMetricsBlock | null
  rotation?: PdfRotationBlock
}): PdfNaturalPageMetricsBlock {
  const measured = params.metricsByPage?.get(params.page)
  const source = measured ?? params.fallbackMetrics ?? DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK
  return rotatePdfPageMetricsBlock(source, params.rotation ?? 0)
}

export function computePdfPageWidthBlock(viewportWidth: number): number | undefined {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return undefined
  return Math.max(320, viewportWidth - PDF_VIEWPORT_HORIZONTAL_PADDING_BLOCK)
}

export function computePdfViewportHeightBlock(viewportHeight: number): number | undefined {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return undefined
  return Math.max(MIN_PDF_PAGE_HEIGHT_BLOCK, viewportHeight - PDF_VIEWPORT_VERTICAL_PADDING_BLOCK)
}

export function computePdfFitScaleBlock(params: {
  viewportWidth: number
  naturalPageWidth: number
}): number {
  const pageWidth = computePdfPageWidthBlock(params.viewportWidth)
  if (!pageWidth) return 1

  const naturalWidth = isUsableMetricBlock(params.naturalPageWidth)
    ? params.naturalPageWidth
    : DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK.width

  return pageWidth / naturalWidth
}

/* Fit-page is bounded by whichever axis runs out first, so a landscape page
   in a tall viewport stays fully visible. */
export function computePdfFitPageScaleBlock(params: {
  viewportWidth: number
  viewportHeight: number
  pageMetrics: PdfNaturalPageMetricsBlock
}): number {
  const pageWidth = computePdfPageWidthBlock(params.viewportWidth)
  const pageHeight = computePdfViewportHeightBlock(params.viewportHeight)
  if (!pageWidth || !pageHeight) return 1

  const metrics = normalizeMetricsBlock(params.pageMetrics)
  return Math.min(pageWidth / metrics.width, pageHeight / metrics.height)
}

export function computeDisplayedPdfScaleBlock(params: {
  zoomMode: PdfZoomModeBlock
  scale: number
  viewportWidth: number
  viewportHeight?: number
  pageMetrics: PdfNaturalPageMetricsBlock
}): number {
  const metrics = normalizeMetricsBlock(params.pageMetrics)

  switch (params.zoomMode) {
    case 'fit-width':
      return computePdfFitScaleBlock({
        viewportWidth: params.viewportWidth,
        naturalPageWidth: metrics.width,
      })
    case 'fit-page':
      return computePdfFitPageScaleBlock({
        viewportWidth: params.viewportWidth,
        viewportHeight: params.viewportHeight ?? 0,
        pageMetrics: metrics,
      })
    case 'actual':
      return 1
    case 'manual':
    default:
      return isUsableMetricBlock(params.scale) ? params.scale : 1
  }
}

export interface PdfPageBoxBlock {
  width: number
  height: number
  /** The scale this specific page is laid out at, in CSS px per PDF unit. */
  scale: number
}

/* The on-screen box a given page occupies at the current zoom, and the scale
   that produced it. Used both for real pages and for the placeholders of pages
   outside the render window — which is why it must be per-page: a wrong
   placeholder height is a scroll jump.

   The scale is returned rather than recomputed by callers because in fit modes
   it is genuinely per-page (a landscape page fits differently from a portrait
   one), and the text layer has to be told the same number the layout used or
   its spans land in the wrong place. */
export function computePdfPageBoxBlock(params: {
  page: number
  zoomMode: PdfZoomModeBlock
  scale: number
  viewportWidth: number
  viewportHeight?: number
  metricsByPage?: PdfPageMetricsMapBlock | null
  fallbackMetrics?: PdfNaturalPageMetricsBlock | null
  rotation?: PdfRotationBlock
}): PdfPageBoxBlock {
  const pageMetrics = resolvePdfPageMetricsBlock({
    page: params.page,
    metricsByPage: params.metricsByPage,
    fallbackMetrics: params.fallbackMetrics,
    rotation: params.rotation,
  })

  const effectiveScale = computeDisplayedPdfScaleBlock({
    zoomMode: params.zoomMode,
    scale: params.scale,
    viewportWidth: params.viewportWidth,
    viewportHeight: params.viewportHeight,
    pageMetrics,
  })

  return {
    width: Math.max(1, Math.round(pageMetrics.width * effectiveScale)),
    height: Math.max(MIN_PDF_PAGE_HEIGHT_BLOCK, Math.round(pageMetrics.height * effectiveScale)),
    scale: effectiveScale,
  }
}

export function computePdfPageHeightBlock(params: {
  page: number
  zoomMode: PdfZoomModeBlock
  scale: number
  viewportWidth: number
  viewportHeight?: number
  metricsByPage?: PdfPageMetricsMapBlock | null
  fallbackMetrics?: PdfNaturalPageMetricsBlock | null
  rotation?: PdfRotationBlock
}): number {
  return computePdfPageBoxBlock(params).height
}

/* Keep the document point under (focalX, focalY) pinned while the scale
   changes from prevScale to nextScale.

   The content point under the focal point is (scroll + focal) in laid-out
   pixels. Rescaling multiplies laid-out pixels by nextScale/prevScale, so the
   new scroll offset that puts that same point back under the cursor is
   (scroll + focal) * ratio - focal.

   Focal coordinates are relative to the viewport's own border box, not the
   page. Content dimensions are optional and describe the content *at
   prevScale*; when supplied the result is clamped so the caller never assigns
   a scroll offset the element would silently reject. */
export function computeZoomScrollAnchorBlock(params: {
  scrollTop: number
  scrollLeft: number
  focalX: number
  focalY: number
  prevScale: number
  nextScale: number
  viewportWidth?: number
  viewportHeight?: number
  contentWidth?: number
  contentHeight?: number
}): { scrollTop: number; scrollLeft: number } {
  const { scrollTop, scrollLeft, focalX, focalY, prevScale, nextScale } = params

  if (!isUsableMetricBlock(prevScale) || !isUsableMetricBlock(nextScale)) {
    return { scrollTop, scrollLeft }
  }

  const ratio = nextScale / prevScale
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { scrollTop, scrollLeft }
  }

  const rawLeft = (scrollLeft + focalX) * ratio - focalX
  const rawTop = (scrollTop + focalY) * ratio - focalY

  return {
    scrollLeft: clampScrollOffsetBlock(rawLeft, params.contentWidth, params.viewportWidth, ratio),
    scrollTop: clampScrollOffsetBlock(rawTop, params.contentHeight, params.viewportHeight, ratio),
  }
}

function clampScrollOffsetBlock(
  value: number,
  contentSizeAtPrevScale: number | undefined,
  viewportSize: number | undefined,
  ratio: number,
): number {
  if (!Number.isFinite(value)) return 0
  const lowerBounded = Math.max(0, value)

  if (!isUsableMetricBlock(contentSizeAtPrevScale) || !isUsableMetricBlock(viewportSize)) {
    return lowerBounded
  }

  /* Content narrower than the viewport is centered by the layout, so there is
     no scrollable range on that axis at all. */
  const maxScroll = Math.max(0, contentSizeAtPrevScale * ratio - viewportSize)
  return Math.min(lowerBounded, maxScroll)
}

export function buildPdfRenderedWindowBlock(params: {
  centerPage: number
  numPages: number
  overscan?: number
}): { start: number; end: number } {
  const overscan = params.overscan ?? PDF_RENDER_OVERSCAN_PAGES_BLOCK
  const numPages = Math.max(0, params.numPages)
  if (numPages === 0) return { start: 1, end: 0 }

  const centerPage = Math.max(1, Math.min(params.centerPage, numPages))
  return {
    start: Math.max(1, centerPage - overscan),
    end: Math.min(numPages, centerPage + overscan),
  }
}


/* The band of pages that keep their bitmaps. Always at least as wide as the
   render window, or a page could be asked to raster while unmounted. */
export function buildPdfRetainedWindowBlock(params: {
  centerPage: number
  numPages: number
  retain: number
}): { start: number; end: number } {
  const overscan = Math.max(params.retain, PDF_RENDER_OVERSCAN_PAGES_BLOCK)
  return buildPdfRenderedWindowBlock({
    centerPage: params.centerPage,
    numPages: params.numPages,
    overscan,
  })
}
