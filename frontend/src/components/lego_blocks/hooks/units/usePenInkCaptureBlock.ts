import { useCallback, useRef } from 'react'
import {
  screenPointToPdfBlock,
  simplifyStrokeBlock,
  type PdfPageGeometryBlock,
  type PointBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

/* Pen capture for a PDF page, as handler props to spread on the page element.

   **A pen touching the page is unambiguous intent, so there is no draw mode.**
   Nothing else in a reader wants a stylus drag: a finger scrolls, a mouse
   selects, and a Pencil draws. Making the reader tap a button first means
   putting the Pencil down to enable the Pencil, which is the interaction this
   viewer exists to avoid.

   The handlers live on the page container rather than on the annotation SVG on
   purpose. An overlay with `pointer-events: auto` sits above the text layer and
   swallows text selection, and CSS cannot discriminate by pointer type. Binding
   here lets a pen event be claimed and every other pointer fall through to the
   text layer untouched.

   Strokes accumulate in a ref and paint through a caller-supplied callback, so
   a 120Hz pen is never throttled to React's render rate. */
export function usePenInkCaptureBlock(params: {
  geometry: PdfPageGeometryBlock | undefined
  enabled: boolean
  onPaint: (strokePdfPoints: readonly PointBlock[]) => void
  onCommit: (strokePdfPoints: PointBlock[]) => void
}) {
  const { geometry, enabled, onPaint, onCommit } = params
  const strokeRef = useRef<PointBlock[]>([])
  const drawingRef = useRef(false)

  const readPdfPointBlock = useCallback((
    clientX: number,
    clientY: number,
    element: Element,
  ): PointBlock | null => {
    if (!geometry) return null
    const rect = element.getBoundingClientRect()
    return screenPointToPdfBlock({ x: clientX - rect.left, y: clientY - rect.top }, geometry)
  }, [geometry])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || !geometry) return
    /* The whole rule, in one line. */
    if (event.pointerType !== 'pen') return

    const point = readPdfPointBlock(event.clientX, event.clientY, event.currentTarget)
    if (!point) return

    /* Claim the gesture: without this the pen also drags a text selection. */
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    drawingRef.current = true
    strokeRef.current = [point]
    onPaint(strokeRef.current)
  }, [enabled, geometry, onPaint, readPdfPointBlock])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()

    /* Coalesced events recover the samples the browser batched into this
       frame; without them a fast stroke is visibly polygonal. */
    const native = event.nativeEvent
    const samples = typeof native.getCoalescedEvents === 'function'
      ? native.getCoalescedEvents()
      : [native]

    for (const sample of samples) {
      const point = readPdfPointBlock(sample.clientX, sample.clientY, event.currentTarget)
      if (point) strokeRef.current.push(point)
    }
    onPaint(strokeRef.current)
  }, [onPaint, readPdfPointBlock])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    event.preventDefault()

    const points = simplifyStrokeBlock(strokeRef.current)
    strokeRef.current = []
    onPaint(strokeRef.current)

    /* A tap is not a stroke, and would serialize as a degenerate InkList. */
    if (points.length >= 2) onCommit(points)
  }, [onCommit, onPaint])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
}
