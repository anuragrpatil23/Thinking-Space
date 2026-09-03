/* Screen space <-> PDF user space, and the annotation payloads pdf.js's writer
   expects.

   Two coordinate systems meet here and they disagree about almost everything.
   Screen space is CSS pixels, origin top-left, y down, already scaled by zoom
   and already shifted by the margin crop. PDF user space is unscaled units,
   origin bottom-left, y up, and knows nothing about either. Every conversion in
   the reader funnels through this file so the sign flips live in exactly one
   place.

   The payload shapes are not invented. pdf.js's worker dispatches on
   `annotationType` in `saveNewAnnotations` and hands the object to
   `HighlightAnnotation.createNewDict` / `InkAnnotation.createNewDict`, which
   read `quadPoints`, `outlines`/`paths`, `rect`, `color`, `opacity`,
   `thickness` and `user` off it directly. So a plain object placed in
   `annotationStorage` is enough to produce a real, spec-compliant annotation —
   no editor class, and no `AnnotationEditorUIManager`, is involved. */

import type { PdfCropBoxBlock } from './pdfMarginCropBlock'

/* Mirrors pdf.js's AnnotationEditorType. Duplicated as plain constants rather
   than imported so this unit stays free of pdf.js and remains testable in a
   plain node environment. Checked against pdfjs-dist 5.4.296. */
export const PDF_ANNOTATION_EDITOR_TYPE_BLOCK = {
  FREETEXT: 3,
  HIGHLIGHT: 9,
  INK: 15,
} as const

export interface PdfPageGeometryBlock {
  /** Natural, uncropped page box in PDF units. */
  naturalWidth: number
  naturalHeight: number
  /** CSS pixels per PDF unit. */
  scale: number
  crop: PdfCropBoxBlock
}

export interface PointBlock {
  x: number
  y: number
}

/* Page-local CSS pixels (relative to the rendered page box) to PDF user space. */
export function screenPointToPdfBlock(point: PointBlock, geometry: PdfPageGeometryBlock): PointBlock {
  const { scale, crop, naturalHeight } = geometry
  return {
    x: crop.left + point.x / scale,
    y: naturalHeight - crop.top - point.y / scale,
  }
}

export function pdfPointToScreenBlock(point: PointBlock, geometry: PdfPageGeometryBlock): PointBlock {
  const { scale, crop, naturalHeight } = geometry
  return {
    x: (point.x - crop.left) * scale,
    y: (naturalHeight - crop.top - point.y) * scale,
  }
}

export interface ScreenRectBlock {
  left: number
  top: number
  width: number
  height: number
}

/* PDF QuadPoints order is top-left, top-right, bottom-left, bottom-right —
   note that it is NOT the winding order a reader would guess, and getting it
   wrong produces highlights that render as bow-ties in strict viewers. */
export function screenRectToQuadPointsBlock(
  rect: ScreenRectBlock,
  geometry: PdfPageGeometryBlock,
): number[] {
  const topLeft = screenPointToPdfBlock({ x: rect.left, y: rect.top }, geometry)
  const bottomRight = screenPointToPdfBlock(
    { x: rect.left + rect.width, y: rect.top + rect.height },
    geometry,
  )
  return [
    topLeft.x, topLeft.y,
    bottomRight.x, topLeft.y,
    topLeft.x, bottomRight.y,
    bottomRight.x, bottomRight.y,
  ]
}

/** Bounding box of a set of PDF-space points, as PDF's [xMin, yMin, xMax, yMax]. */
export function boundingRectBlock(points: readonly PointBlock[]): [number, number, number, number] {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  for (const point of points) {
    xMin = Math.min(xMin, point.x)
    yMin = Math.min(yMin, point.y)
    xMax = Math.max(xMax, point.x)
    yMax = Math.max(yMax, point.y)
  }
  if (!Number.isFinite(xMin)) return [0, 0, 0, 0]
  return [xMin, yMin, xMax, yMax]
}

export interface PdfHighlightDraftBlock {
  kind: 'highlight'
  id: string
  pageNumber: number
  /** Flat 8-per-quad array in PDF user space. */
  quadPoints: number[]
  color: [number, number, number]
  opacity: number
  /** The selected text, kept so a session can quote it without re-extracting. */
  text: string
}

export interface PdfInkDraftBlock {
  kind: 'ink'
  id: string
  pageNumber: number
  /** One entry per stroke, each a flat [x, y, x, y, ...] in PDF user space. */
  inkList: number[][]
  color: [number, number, number]
  opacity: number
  thickness: number
}

export type PdfAnnotationDraftBlock = PdfHighlightDraftBlock | PdfInkDraftBlock

/* The object pdf.js's writer consumes. `rect` is derived rather than passed in
   because every caller would otherwise have to recompute the same bounding box
   and one of them would eventually get it wrong. */
export function toPdfStorageEntryBlock(
  draft: PdfAnnotationDraftBlock,
  now: Date = new Date(),
): Record<string, unknown> {
  const shared = {
    pageIndex: draft.pageNumber - 1,
    date: now,
    color: draft.color,
    opacity: draft.opacity,
    rotation: 0,
  }

  if (draft.kind === 'highlight') {
    const points: PointBlock[] = []
    for (let index = 0; index + 1 < draft.quadPoints.length; index += 2) {
      points.push({ x: draft.quadPoints[index], y: draft.quadPoints[index + 1] })
    }
    return {
      ...shared,
      annotationType: PDF_ANNOTATION_EDITOR_TYPE_BLOCK.HIGHLIGHT,
      quadPoints: draft.quadPoints,
      rect: boundingRectBlock(points),
    }
  }

  const points: PointBlock[] = []
  for (const stroke of draft.inkList) {
    for (let index = 0; index + 1 < stroke.length; index += 2) {
      points.push({ x: stroke[index], y: stroke[index + 1] })
    }
  }

  /* The stroke is a centre line, so the drawn shape overhangs it by half the
     thickness on every side. A rect measured from the centre line alone clips
     the annotation in viewers that honour it. */
  const [xMin, yMin, xMax, yMax] = boundingRectBlock(points)
  const pad = draft.thickness / 2

  return {
    ...shared,
    annotationType: PDF_ANNOTATION_EDITOR_TYPE_BLOCK.INK,
    thickness: draft.thickness,
    paths: { points: draft.inkList },
    rect: [xMin - pad, yMin - pad, xMax + pad, yMax + pad],
  }
}

/* Simplify a captured stroke before it is stored.

   A pen at 120Hz emits far more points than the curve needs, and every one of
   them is bytes in the PDF and work for whatever opens it later. Perpendicular
   distance against the segment being built keeps corners and drops only points
   that lie along a line already being drawn. */
export function simplifyStrokeBlock(points: readonly PointBlock[], tolerance = 0.6): PointBlock[] {
  if (points.length <= 2) return [...points]

  const kept: PointBlock[] = [points[0]]
  let anchor = points[0]

  for (let index = 1; index < points.length - 1; index += 1) {
    const candidate = points[index]
    const next = points[index + 1]

    const dx = next.x - anchor.x
    const dy = next.y - anchor.y
    const segmentLength = Math.hypot(dx, dy)

    if (segmentLength === 0) continue

    const distance = Math.abs(
      (candidate.x - anchor.x) * dy - (candidate.y - anchor.y) * dx,
    ) / segmentLength

    if (distance > tolerance) {
      kept.push(candidate)
      anchor = candidate
    }
  }

  kept.push(points[points.length - 1])
  return kept
}
