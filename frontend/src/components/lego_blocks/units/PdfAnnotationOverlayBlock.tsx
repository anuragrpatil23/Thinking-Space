import type { Ref } from 'react'
import {
  strokeToSvgPathBlock,
  type PdfAnnotationDraftBlock,
  type PdfPageGeometryBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

/* Draws the marks on one page. Purely presentational — pen capture lives in
   `usePenInkCaptureBlock`, bound to the page container above this element.

   This layer is `pointer-events: none` and must stay that way. An interactive
   overlay sits above the text layer and swallows selection, and CSS cannot
   discriminate by pointer type, so the only way for a pen to draw *and* a
   finger to select is for this element to be inert and the page container to
   arbitrate.

   Everything is expressed in PDF user space through the viewBox, so marks
   scale with zoom for free — no re-raster, no redraw, no per-frame math. */

export type PdfAnnotationToolBlock = 'none' | 'highlight'

function rgbBlock(color: readonly [number, number, number]): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`
}

export default function PdfAnnotationOverlayBlock({
  pageNumber,
  geometry,
  displayedWidth,
  displayedHeight,
  annotations,
  inkColor,
  inkThickness,
  livePathRef,
}: {
  pageNumber: number
  geometry: PdfPageGeometryBlock
  displayedWidth: number
  displayedHeight: number
  annotations: readonly PdfAnnotationDraftBlock[]
  inkColor: [number, number, number]
  inkThickness: number
  /** The in-flight stroke, written to imperatively so a 120Hz pen is not
   *  throttled to React's render rate. */
  livePathRef: Ref<SVGPathElement>
}) {
  const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === pageNumber)

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10"
      width={displayedWidth}
      height={displayedHeight}
      viewBox={[
        geometry.crop.left,
        geometry.crop.top,
        geometry.naturalWidth - geometry.crop.left - geometry.crop.right,
        geometry.naturalHeight - geometry.crop.top - geometry.crop.bottom,
      ].join(' ')}
    >
      {/* PDF space is y-up; SVG is y-down. One flip here means every child can
          be written in raw PDF coordinates. */}
      <g transform={`translate(0 ${geometry.naturalHeight}) scale(1 -1)`}>
        {pageAnnotations.map((annotation) => (
          annotation.kind === 'highlight'
            ? <PdfHighlightMarksBlock key={annotation.id} annotation={annotation} />
            : <PdfInkMarksBlock key={annotation.id} annotation={annotation} />
        ))}
        <path
          ref={livePathRef}
          fill="none"
          stroke={rgbBlock(inkColor)}
          strokeWidth={inkThickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

function PdfHighlightMarksBlock({
  annotation,
}: { annotation: Extract<PdfAnnotationDraftBlock, { kind: 'highlight' }> }) {
  const quads: number[][] = []
  for (let index = 0; index + 7 < annotation.quadPoints.length; index += 8) {
    quads.push(annotation.quadPoints.slice(index, index + 8))
  }

  return (
    <>
      {quads.map((quad, index) => {
        /* QuadPoints order is TL, TR, BL, BR — a polygon needs TL, TR, BR, BL
           or it draws itself as a bow-tie. */
        const points = `${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[6]},${quad[7]} ${quad[4]},${quad[5]}`
        return (
          <polygon
            key={index}
            points={points}
            fill={rgbBlock(annotation.color)}
            fillOpacity={annotation.opacity}
            /* Multiply keeps the text legible instead of veiling it. */
            style={{ mixBlendMode: 'multiply' }}
          />
        )
      })}
    </>
  )
}

function PdfInkMarksBlock({
  annotation,
}: { annotation: Extract<PdfAnnotationDraftBlock, { kind: 'ink' }> }) {
  return (
    <>
      {annotation.inkList.map((stroke, index) => {
        /* Same spline the PDF appearance stream uses, so what is on screen and
           what is in the file are the same curve. Straight segments between raw
           samples are what made handwriting look spiky. */
        const points = []
        for (let position = 0; position + 1 < stroke.length; position += 2) {
          points.push({ x: stroke[position], y: stroke[position + 1] })
        }
        return (
          <path
            key={index}
            d={strokeToSvgPathBlock(points)}
            fill="none"
            stroke={rgbBlock(annotation.color)}
            strokeOpacity={annotation.opacity}
            strokeWidth={annotation.thickness}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </>
  )
}
