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
  /** 'highlighter' collects the text under the stroke instead of drawing it. */
  tool?: 'pen' | 'highlighter'
  onPaint: (strokePdfPoints: readonly PointBlock[]) => void
  onCommit: (strokePdfPoints: PointBlock[]) => void
  /** Client-space rects of the text the stroke passed over. */
  onCommitHighlight?: (rects: DOMRect[], text: string) => void
}) {
  const { geometry, enabled, tool = 'pen', onPaint, onCommit, onCommitHighlight } = params
  /* Client-space samples, kept alongside the PDF-space ones because the
     highlighter hit-tests the DOM and the DOM speaks client coordinates. */
  const clientTrailRef = useRef<PointBlock[]>([])
  const strokeRef = useRef<PointBlock[]>([])
  const drawingRef = useRef(false)
  const suppressedElementRef = useRef<HTMLElement | null>(null)

  /* iOS starts a text selection from a pen drag despite `preventDefault` on the
     pointer event: WebKit drives selection and the long-press callout from its
     own touch handling, which does not consult the pointer event's default.
     Writing a word therefore also selected the text under it and raised the
     Copy / Look Up / Translate bar.

     The styles are written imperatively rather than through React state because
     a re-render is a frame late and the selection has already begun by then.
     They are scoped to the page element and lifted the moment the stroke ends,
     so a finger can still select normally. */
  const suppressSelectionBlock = (element: HTMLElement) => {
    suppressedElementRef.current = element
    element.style.userSelect = 'none'
    element.style.webkitUserSelect = 'none'
    element.style.setProperty('-webkit-touch-callout', 'none')
    element.style.touchAction = 'none'
  }

  const restoreSelectionBlock = () => {
    const element = suppressedElementRef.current
    if (!element) return
    suppressedElementRef.current = null
    element.style.userSelect = ''
    element.style.webkitUserSelect = ''
    element.style.removeProperty('-webkit-touch-callout')
    element.style.touchAction = ''
  }

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

    /* Claim the gesture. `preventDefault` alone is not enough on iOS — see
       suppressSelectionBlock. */
    event.preventDefault()
    suppressSelectionBlock(event.currentTarget)
    event.currentTarget.setPointerCapture?.(event.pointerId)

    /* A selection may already exist from a previous gesture; leaving it up
       means the highlight bar hovers over the page while you are writing. */
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()

    drawingRef.current = true
    strokeRef.current = [point]
    clientTrailRef.current = [{ x: event.clientX, y: event.clientY }]
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
      clientTrailRef.current.push({ x: sample.clientX, y: sample.clientY })
    }
    /* The highlighter shows no wet ink: what it will produce is a band over
       words, not the path of the nib, and drawing the path first is the "red
       line that then settles into a highlight" the reader should never see. */
    if (tool === 'pen') onPaint(strokeRef.current)
  }, [onPaint, readPdfPointBlock])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    event.preventDefault()
    restoreSelectionBlock()

    const points = simplifyStrokeBlock(strokeRef.current)
    const trail = clientTrailRef.current
    strokeRef.current = []
    clientTrailRef.current = []
    onPaint(strokeRef.current)

    if (tool === 'highlighter') {
      const { rects, text } = collectTextUnderTrailBlock(trail, event.currentTarget)
      if (rects.length > 0) onCommitHighlight?.(rects, text)
      return
    }

    /* A tap is not a stroke, and would serialize as a degenerate InkList. */
    if (points.length >= 2) onCommit(points)
  }, [onCommit, onCommitHighlight, onPaint, tool])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
}

/* Which text the highlighter passed over.

   Uses `caretRangeFromPoint` along the stroke to find the character under each
   sample, then unions those into one range per text node run. Hit-testing the
   rendered text layer is what makes the result snap to the line the way a real
   highlighter does — a band over whole words, level with the baseline, rather
   than a wobbling trace of the nib.

   Sampling is coarse on purpose: a stroke has far more points than there are
   characters under it, and testing every one is wasted work for the same
   answer. */
function collectTextUnderTrailBlock(
  trail: readonly PointBlock[],
  container: HTMLElement,
): { rects: DOMRect[]; text: string } {
  const doc = container.ownerDocument
  const caretFrom = (doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }).caretRangeFromPoint

  if (typeof caretFrom !== 'function' || trail.length === 0) return { rects: [], text: '' }

  const STEP = 4
  const nodes: { node: Node; min: number; max: number }[] = []

  for (let index = 0; index < trail.length; index += STEP) {
    const point = trail[index]
    let range: Range | null = null
    try {
      range = caretFrom.call(doc, point.x, point.y)
    } catch {
      range = null
    }
    if (!range || !container.contains(range.startContainer)) continue
    if (range.startContainer.nodeType !== Node.TEXT_NODE) continue

    const existing = nodes.find((entry) => entry.node === range!.startContainer)
    if (existing) {
      existing.min = Math.min(existing.min, range.startOffset)
      existing.max = Math.max(existing.max, range.startOffset)
    } else {
      nodes.push({ node: range.startContainer, min: range.startOffset, max: range.startOffset })
    }
  }

  const rects: DOMRect[] = []
  const parts: string[] = []

  for (const entry of nodes) {
    const length = entry.node.textContent?.length ?? 0
    /* Extend by one character: the caret lands *between* characters, so the
       last one the nib crossed would otherwise be left out of the band. */
    const start = Math.max(0, Math.min(entry.min, length))
    const end = Math.max(0, Math.min(entry.max + 1, length))
    if (end <= start) continue

    const range = doc.createRange()
    range.setStart(entry.node, start)
    range.setEnd(entry.node, end)
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect)
    }
    parts.push(range.toString())
  }

  return { rects, text: parts.join(' ').replace(/\s+/g, ' ').trim() }
}
