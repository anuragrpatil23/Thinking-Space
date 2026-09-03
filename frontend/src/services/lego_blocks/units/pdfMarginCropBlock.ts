/* Detect the printed margins of a PDF and crop them away.

   On a tablet this is the single biggest legibility win available, because a
   book PDF typically spends 25-35% of its width on gutters that exist for
   paper. Cropping them lets fit-width solve for the text block rather than the
   sheet, which makes the type visibly larger at the same zoom without the user
   touching a control.

   The bounding box comes from text item positions rather than from scanning
   rendered pixels. Pixel scanning would also catch scanned images and page
   furniture, but it costs a full raster per sampled page and cannot run until
   the page has rendered; text geometry arrives from `getTextContent()`, which
   the viewer needs anyway.

   The crop is document-wide, not per-page, and that is deliberate: a per-page
   crop makes the text column jump left and right as you scroll, which reads as
   a bug even though every individual page is optimally cropped. Sampling a
   spread of pages and taking the union gives one stable column. */

import type { PdfNaturalPageMetricsBlock } from './pdfViewportBlock'

export interface PdfCropBoxBlock {
  /** Offsets from each edge, in PDF units. */
  left: number
  top: number
  right: number
  bottom: number
}

export const EMPTY_PDF_CROP_BOX_BLOCK: PdfCropBoxBlock = { left: 0, top: 0, right: 0, bottom: 0 }

/* Breathing room left around the detected text block, so cropped pages do not
   look guillotined and descenders/accents are never clipped. */
const CROP_PADDING_PDF_UNITS_BLOCK = 12

/* Refuse to crop more than this share of either axis. A page whose text
   geometry is unreliable — a scan with one stray text item, a title page —
   would otherwise produce an absurd crop, and a wrong crop is far worse than
   no crop. */
const MAX_CROP_FRACTION_BLOCK = 0.4

/* Below this, the crop is not worth the layout change. */
const MIN_USEFUL_CROP_PDF_UNITS_BLOCK = 18

export interface PdfTextItemBoxBlock {
  left: number
  bottom: number
  width: number
  height: number
}

/* pdf.js text items carry a 6-element transform in PDF user space: indices 4
   and 5 are the origin, and index 3 is the vertical scale, which stands in for
   the glyph height well enough for a margin measurement. */
export function readPdfTextItemBoxBlock(item: {
  transform?: number[]
  width?: number
  height?: number
  str?: string
}): PdfTextItemBoxBlock | null {
  const transform = item.transform
  if (!Array.isArray(transform) || transform.length < 6) return null
  if (typeof item.str === 'string' && item.str.trim() === '') return null

  const left = transform[4]
  const bottom = transform[5]
  const width = Number.isFinite(item.width) ? (item.width as number) : 0
  const height = Number.isFinite(item.height) && (item.height as number) > 0
    ? (item.height as number)
    : Math.abs(transform[3] ?? 0)

  if (!Number.isFinite(left) || !Number.isFinite(bottom)) return null
  return { left, bottom, width, height }
}

export function computePdfCropBoxBlock(params: {
  itemBoxes: readonly PdfTextItemBoxBlock[]
  pageMetrics: PdfNaturalPageMetricsBlock
}): PdfCropBoxBlock {
  const { itemBoxes, pageMetrics } = params
  if (itemBoxes.length === 0) return EMPTY_PDF_CROP_BOX_BLOCK

  let minLeft = Infinity
  let maxRight = -Infinity
  let minBottom = Infinity
  let maxTop = -Infinity

  for (const box of itemBoxes) {
    minLeft = Math.min(minLeft, box.left)
    maxRight = Math.max(maxRight, box.left + box.width)
    minBottom = Math.min(minBottom, box.bottom)
    maxTop = Math.max(maxTop, box.bottom + box.height)
  }

  if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight)) return EMPTY_PDF_CROP_BOX_BLOCK

  const maxHorizontal = pageMetrics.width * MAX_CROP_FRACTION_BLOCK
  const maxVertical = pageMetrics.height * MAX_CROP_FRACTION_BLOCK

  /* PDF user space has its origin at the bottom-left, so the top crop is
     measured down from the page height and the bottom crop up from zero. */
  const rawLeft = minLeft - CROP_PADDING_PDF_UNITS_BLOCK
  const rawRight = pageMetrics.width - maxRight - CROP_PADDING_PDF_UNITS_BLOCK
  const rawTop = pageMetrics.height - maxTop - CROP_PADDING_PDF_UNITS_BLOCK
  const rawBottom = minBottom - CROP_PADDING_PDF_UNITS_BLOCK

  const clampBlock = (value: number, ceiling: number) => {
    if (!Number.isFinite(value) || value < MIN_USEFUL_CROP_PDF_UNITS_BLOCK) return 0
    return Math.min(value, ceiling)
  }

  return {
    left: clampBlock(rawLeft, maxHorizontal),
    right: clampBlock(rawRight, maxHorizontal),
    top: clampBlock(rawTop, maxVertical),
    bottom: clampBlock(rawBottom, maxVertical),
  }
}

/* Union across sampled pages — the widest text block wins on every edge, so no
   sampled page ever loses content to the shared crop. */
export function mergePdfCropBoxesBlock(boxes: readonly PdfCropBoxBlock[]): PdfCropBoxBlock {
  const usable = boxes.filter((box) => box.left > 0 || box.right > 0 || box.top > 0 || box.bottom > 0)
  if (usable.length === 0) return EMPTY_PDF_CROP_BOX_BLOCK

  return usable.reduce((merged, box) => ({
    left: Math.min(merged.left, box.left),
    right: Math.min(merged.right, box.right),
    top: Math.min(merged.top, box.top),
    bottom: Math.min(merged.bottom, box.bottom),
  }))
}

/* Which pages to measure. An even spread beats the first N: front matter is
   systematically unrepresentative of a book's body text, and measuring the
   first ten pages of a novel usually samples a title page, a copyright page
   and a dedication — none of which have body margins. */
export function selectPdfCropSamplePagesBlock(numPages: number, sampleCount = 8): number[] {
  if (numPages <= 0) return []
  if (numPages <= sampleCount) {
    return Array.from({ length: numPages }, (_, index) => index + 1)
  }

  const step = numPages / (sampleCount + 1)
  const pages = new Set<number>()
  for (let index = 1; index <= sampleCount; index += 1) {
    pages.add(Math.max(1, Math.min(numPages, Math.round(step * index))))
  }
  return [...pages].sort((a, b) => a - b)
}

/* The metrics a cropped page presents to layout. Everything downstream — fit
   scale, placeholder heights, raster budget — then works in cropped space
   without knowing a crop happened. */
export function applyPdfCropToMetricsBlock(
  metrics: PdfNaturalPageMetricsBlock,
  crop: PdfCropBoxBlock,
): PdfNaturalPageMetricsBlock {
  const width = metrics.width - crop.left - crop.right
  const height = metrics.height - crop.top - crop.bottom
  if (width <= 0 || height <= 0) return metrics
  return { width, height }
}
