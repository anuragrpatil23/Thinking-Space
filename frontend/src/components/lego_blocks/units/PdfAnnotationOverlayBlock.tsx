import { useCallback, useRef } from 'react'
import {
  screenPointToPdfBlock,
  simplifyStrokeBlock,
  type PdfAnnotationDraftBlock,
  type PdfPageGeometryBlock,
  type PointBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

/* The interactive annotation surface for one page: draws the marks made this
   session and captures new ones.

   **Pen draws, finger scrolls, always.** That single rule is the whole
   interaction design, and it is why this does not use pdf.js's
   AnnotationEditorLayer — that layer wants a mode switch and a toolbar, which
   on a tablet means putting down the pencil to tap a button before you can use
   the pencil. `pointerType === 'pen'` tells us which input this is, so the
   overlay can claim pen events and ignore touch entirely. Palm rejection comes
   free from the same test: a palm is `touch`.

   Marks are drawn as SVG in PDF user space via a viewBox, so they scale with
   zoom for nothing — no re-raster, no redraw, no coordinate math per frame.
   The in-flight stroke bypasses React and writes `d` straight onto a path
   element, because a state update per pointer sample would cap the stroke at
   React's render rate rather than the pen's sample rate. */

export type PdfAnnotationToolBlock = 'none' | 'highlight' | 'ink'

interface PdfAnnotationOverlayBlockProps {
  pageNumber: number
  geometry: PdfPageGeometryBlock
  displayedWidth: number
  displayedHeight: number
  annotations: readonly PdfAnnotationDraftBlock[]
  tool: PdfAnnotationToolBlock
  inkColor: [number, number, number]
  inkThickness: number
  onCommitInk: (strokePdfPoints: PointBlock[]) => void
}

function rgbBlock(color: readonly [number, number, number]): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`
}

export default function PdfAnnotationOverlayBlock({
  pageNumber,
  geometry,
  displayedWidth,
  displayedHeight,
  annotations,
  tool,
  inkColor,
  inkThickness,
  onCommitInk,
}: PdfAnnotationOverlayBlockProps) {
  const rootRef = useRef<SVGSVGElement | null>(null)
  const livePathRef = useRef<SVGPathElement | null>(null)
  const strokeRef = useRef<PointBlock[]>([])
  const drawingRef = useRef(false)

  const readPagePointBlock = useCallback((event: React.PointerEvent): PointBlock | null => {
    const root = rootRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, [])

  const paintLiveStrokeBlock = useCallback(() => {
    const path = livePathRef.current
    if (!path) return
    const points = strokeRef.current
    if (points.length === 0) {
      path.removeAttribute('d')
      return
    }
    /* Drawn in PDF space to match the viewBox, so the live stroke and the
       committed one are the same geometry and there is no jump on release. */
    const d = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ')
    path.setAttribute('d', d)
  }, [])

  const handlePointerDownBlock = useCallback((event: React.PointerEvent) => {
    if (tool === 'none') return
    /* A finger is a scroll, never a stroke — no mode switch required. With a
       mouse, drawing is opt-in via the ink tool. */
    if (event.pointerType === 'touch') return
    if (event.pointerType === 'mouse' && tool !== 'ink') return

    const point = readPagePointBlock(event)
    if (!point) return

    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)

    drawingRef.current = true
    strokeRef.current = [screenPointToPdfBlock(point, geometry)]
    paintLiveStrokeBlock()
  }, [geometry, paintLiveStrokeBlock, readPagePointBlock, tool])

  const handlePointerMoveBlock = useCallback((event: React.PointerEvent) => {
    if (!drawingRef.current) return
    event.preventDefault()

    /* Coalesced events recover the samples the browser batched into this
       frame. Without them a fast stroke is visibly polygonal. */
    const native = event.nativeEvent
    const samples = typeof native.getCoalescedEvents === 'function'
      ? native.getCoalescedEvents()
      : [native]

    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()

    for (const sample of samples) {
      strokeRef.current.push(screenPointToPdfBlock(
        { x: sample.clientX - rect.left, y: sample.clientY - rect.top },
        geometry,
      ))
    }
    paintLiveStrokeBlock()
  }, [geometry, paintLiveStrokeBlock])

  const handlePointerUpBlock = useCallback((event: React.PointerEvent) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    event.preventDefault()

    const points = simplifyStrokeBlock(strokeRef.current)
    strokeRef.current = []
    paintLiveStrokeBlock()

    /* A tap is not a stroke. Two points that are also the same point would
       serialize as a degenerate InkList entry. */
    if (points.length >= 2) onCommitInk(points)
  }, [onCommitInk, paintLiveStrokeBlock])

  const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === pageNumber)

  return (
    <svg
      ref={rootRef}
      className="absolute inset-0 z-10"
      width={displayedWidth}
      height={displayedHeight}
      /* The viewBox is the cropped region in PDF space with y flipped, so every
         child can be expressed in raw PDF coordinates and zoom is free. */
      viewBox={[
        geometry.crop.left,
        geometry.crop.top,
        geometry.naturalWidth - geometry.crop.left - geometry.crop.right,
        geometry.naturalHeight - geometry.crop.top - geometry.crop.bottom,
      ].join(' ')}
      style={{
        /* Never swallow a scroll: touch always reaches the viewport beneath. */
        touchAction: 'pan-x pan-y',
        pointerEvents: tool === 'none' ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDownBlock}
      onPointerMove={handlePointerMoveBlock}
      onPointerUp={handlePointerUpBlock}
      onPointerCancel={handlePointerUpBlock}
    >
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

function PdfHighlightMarksBlock({ annotation }: { annotation: Extract<PdfAnnotationDraftBlock, { kind: 'highlight' }> }) {
  const quads: number[][] = []
  for (let index = 0; index + 7 < annotation.quadPoints.length; index += 8) {
    quads.push(annotation.quadPoints.slice(index, index + 8))
  }

  return (
    <>
      {quads.map((quad, index) => {
        /* Order is TL, TR, BL, BR — the polygon needs TL, TR, BR, BL to avoid
           drawing itself as a bow-tie. */
        const pointsAttr = `${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[6]},${quad[7]} ${quad[4]},${quad[5]}`
        return (
          <polygon
            key={index}
            points={pointsAttr}
            fill={rgbBlock(annotation.color)}
            fillOpacity={annotation.opacity}
            /* Multiply keeps the text legible underneath instead of veiling it. */
            style={{ mixBlendMode: 'multiply' }}
          />
        )
      })}
    </>
  )
}

function PdfInkMarksBlock({ annotation }: { annotation: Extract<PdfAnnotationDraftBlock, { kind: 'ink' }> }) {
  return (
    <>
      {annotation.inkList.map((stroke, index) => {
        const d = stroke.reduce((acc, value, position) => {
          if (position % 2 !== 0) return acc
          const command = position === 0 ? 'M' : 'L'
          return `${acc}${command}${value.toFixed(2)} ${stroke[position + 1]?.toFixed(2) ?? 0} `
        }, '')
        return (
          <path
            key={index}
            d={d.trim()}
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
