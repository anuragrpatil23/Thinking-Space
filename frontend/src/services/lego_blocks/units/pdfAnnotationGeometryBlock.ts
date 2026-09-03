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

    /* `outlines` is not optional, whatever the presence of `quadPoints`
       suggests. `HighlightAnnotation.createNewAppearanceStream` iterates it to
       build the filled appearance, so omitting it throws "outlines is not
       iterable" out of `saveDocument()` — which is what made every save fail.
       QuadPoints alone only populates the dictionary entry; nothing would be
       drawn even if it did save.

       One polygon per quad, wound TL -> TR -> BR -> BL. QuadPoints order is
       TL, TR, BL, BR, so using it directly draws a bow-tie. */
    const outlines: number[][] = []
    for (let index = 0; index + 7 < draft.quadPoints.length; index += 8) {
      const q = draft.quadPoints
      outlines.push([
        q[index], q[index + 1],
        q[index + 2], q[index + 3],
        q[index + 6], q[index + 7],
        q[index + 4], q[index + 5],
      ])
    }

    return {
      ...shared,
      annotationType: PDF_ANNOTATION_EDITOR_TYPE_BLOCK.HIGHLIGHT,
      quadPoints: draft.quadPoints,
      outlines,
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

  /* `paths.lines` is what the appearance stream is drawn from; `paths.points`
     only feeds `/InkList`. Each entry is a run of 6-tuples: the first is a
     moveto read from slots 4 and 5, and thereafter a leading NaN means "line
     to", anything else is a cubic bezier [c1x, c1y, c2x, c2y, x, y]. Emitting
     beziers here is what makes saved handwriting curve the way it did on
     screen instead of arriving as a polyline of spikes. */
  const lines: number[][] = []
  for (const stroke of draft.inkList) {
    const strokePoints: PointBlock[] = []
    for (let index = 0; index + 1 < stroke.length; index += 2) {
      strokePoints.push({ x: stroke[index], y: stroke[index + 1] })
    }
    if (strokePoints.length < 2) continue

    const line: number[] = [NaN, NaN, NaN, NaN, strokePoints[0].x, strokePoints[0].y]
    for (const { c1, c2, to } of buildStrokeCubicsBlock(strokePoints)) {
      line.push(c1.x, c1.y, c2.x, c2.y, to.x, to.y)
    }
    lines.push(line)
  }

  return {
    ...shared,
    annotationType: PDF_ANNOTATION_EDITOR_TYPE_BLOCK.INK,
    thickness: draft.thickness,
    paths: { points: draft.inkList, lines },
    rect: [xMin - pad, yMin - pad, xMax + pad, yMax + pad],
  }
}

/* Catmull-Rom through the sampled points, expressed as cubic beziers.

   Straight segments between raw samples are what made handwriting look spiky:
   a pen samples fast enough that every tiny direction change becomes a visible
   corner. A Catmull-Rom spline passes exactly through the points the nib
   actually visited while curving between them, which is what ink does.

   Used for both the on-screen path and the PDF appearance stream, so what is
   saved is the same curve that was drawn. */
export function buildStrokeCubicsBlock(
  points: readonly PointBlock[],
): { c1: PointBlock; c2: PointBlock; to: PointBlock }[] {
  const cubics: { c1: PointBlock; c2: PointBlock; to: PointBlock }[] = []
  if (points.length < 2) return cubics

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[index + 2] ?? p2

    cubics.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: { x: p2.x, y: p2.y },
    })
  }
  return cubics
}

export function strokeToSvgPathBlock(points: readonly PointBlock[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`

  const parts = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`]
  for (const { c1, c2, to } of buildStrokeCubicsBlock(points)) {
    parts.push(`C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`)
  }
  return parts.join(' ')
}

/* Simplify a captured stroke before it is stored.

   A pen at 120Hz emits far more points than the curve needs, and every one of
   them is bytes in the PDF and work for whatever opens it later. Perpendicular
   distance against the segment being built keeps corners and drops only points
   that lie along a line already being drawn. */
export function simplifyStrokeBlock(points: readonly PointBlock[], tolerance = 0.25): PointBlock[] {
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
