import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useReadingAttentionBlock } from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useNativeChromeImmersionBlock } from '@/components/lego_blocks/hooks/shared/useNativeChromeImmersionBlock'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minimize2, Minus, Plus, RefreshCw, Undo2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Document, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import PdfJsWorkerBlock from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import pdfWorkerSrcBlock from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from '@/components/lego_blocks/units/ui/button'
import PdfPageCanvasBlock from '@/components/lego_blocks/units/PdfPageCanvasBlock'
import PdfPageScrubberBlock from '@/components/lego_blocks/units/PdfPageScrubberBlock'
import PdfToolbarMenuBlock from '@/components/lego_blocks/units/PdfToolbarMenuBlock'
import PdfPageJumpBlock from '@/components/lego_blocks/units/PdfPageJumpBlock'
import PdfMarkSettingsBlock from '@/components/lego_blocks/units/PdfMarkSettingsBlock'
import PdfSelectionHighlightBarBlock from '@/components/lego_blocks/units/PdfSelectionHighlightBarBlock'
import PdfLinkPeekBlock from '@/components/lego_blocks/units/PdfLinkPeekBlock'
import type { PdfPageLinkHandlersBlock } from '@/components/lego_blocks/units/PdfPageCanvasBlock'
import { resolvePdfLinkPeekTargetBlock } from '@/components/lego_blocks/units/pdfPageLinksBlock'
import { usePdfLinkPeekBlock } from '@/components/lego_blocks/hooks/shared/usePdfLinkPeekBlock'
import { openExternalUrlOrch } from '@/services/orchestrators/fileSystemOrch'
import { useTextSelectionBlock } from '@/components/lego_blocks/hooks/units/useTextSelectionBlock'
import {
  PDF_PEN_OPACITY_BLOCK,
  readPdfMarkStyleBlock,
  resolvePdfMarkColorBlock,
  resolvePdfStrokeThicknessBlock,
  writePdfMarkStyleBlock,
  type PdfMarkStyleBlock,
} from '@/services/lego_blocks/units/pdfMarkStyleBlock'
import { usePdfAnnotationsBlock } from '@/components/lego_blocks/hooks/shared/usePdfAnnotationsBlock'
import {
  mergeSelectionRectsBlock,
  screenRectToQuadPointsBlock,
  type PdfPageGeometryBlock,
  type PointBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'
import { cn } from '@/lib/utils'
import { readPdfDocumentOrch } from '@/services/orchestrators/pdfDocumentsOrch'
import { usePdfPageMetricsBlock } from '@/components/lego_blocks/hooks/shared/usePdfPageMetricsBlock'
import { usePdfReadingPositionBlock } from '@/components/lego_blocks/hooks/shared/usePdfReadingPositionBlock'
import { readPdfReadingPositionBlock } from '@/services/lego_blocks/units/pdfReadingPositionBlock'
import {
  buildPdfRenderedWindowBlock,
  buildPdfRetainedWindowBlock,
  PDF_RETAIN_PAGES_DESKTOP_BLOCK,
  PDF_RETAIN_PAGES_IOS_BLOCK,
  computeDisplayedPdfScaleBlock,
  computePdfPageBoxBlock,
  computeZoomScrollAnchorBlock,
  stepPdfZoomScaleBlock,
  DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK,
  resolvePdfPageMetricsBlock,
  type PdfZoomModeBlock,
} from '@/services/lego_blocks/units/pdfViewportBlock'
import {
  computePdfRasterPlanBlock,
  resolvePdfRasterPixelBudgetBlock,
} from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
import { useReaderChromeVisibilityBlock } from '@/components/lego_blocks/hooks/shared/useReaderChromeVisibilityBlock'
import { EMPTY_PDF_CROP_BOX_BLOCK } from '@/services/lego_blocks/units/pdfMarginCropBlock'
import {
  PDF_PAPER_THEME_BACKGROUNDS_BLOCK,
  PDF_PAPER_THEME_LABELS_BLOCK,
  PDF_PAPER_THEMES_BLOCK,
  readPdfPaperThemeBlock,
  writePdfPaperThemeBlock,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'

let activePdfWorkerBlock: Worker | null = null
let activePdfWorkerVersionBlock: string | null = null

const LARGE_PDF_BYTES_THRESHOLD_BLOCK = 24 * 1024 * 1024
const MIN_SCALE_BLOCK = 0.4
const MAX_SCALE_BLOCK = 5
const TRACKPAD_ZOOM_SENSITIVITY_BLOCK = 0.0015
const TRACKPAD_COMMIT_DEBOUNCE_MS_BLOCK = 120
/* Two fingers on a page is a scroll far more often than it is a pinch. Until
   the distance between them has changed by this much, the gesture is left
   alone and the browser scrolls it — which is what Preview does, and why a
   two-finger pan there never nudges the zoom. Committing to "this is a pinch"
   on the first touchmove is what made small touches zoom the page. */
const PINCH_ACTIVATION_PX_BLOCK = 24
const HIGHLIGHT_OPACITY_BLOCK = 0.4
const PDFJS_DOCUMENT_OPTIONS_BLOCK = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
} as const

function isElectronRuntimeBlock(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.electronAPI?.isElectron
}

function configurePdfWorkerBlock(force = false): void {
  const version = pdfjs.version

  if (isElectronRuntimeBlock()) {
    // Electron is more stable using workerSrc than module Worker construction.
    pdfjs.GlobalWorkerOptions.workerPort = null
    pdfjs.GlobalWorkerOptions.workerSrc = `${pdfWorkerSrcBlock}?pdfjs=${encodeURIComponent(version)}`
    return
  }

  try {
    if (!force && activePdfWorkerBlock && activePdfWorkerVersionBlock === version) {
      pdfjs.GlobalWorkerOptions.workerPort = activePdfWorkerBlock
      return
    }

    if (activePdfWorkerBlock) {
      activePdfWorkerBlock.terminate()
      activePdfWorkerBlock = null
    }

    activePdfWorkerBlock = new PdfJsWorkerBlock()
    activePdfWorkerVersionBlock = version
    pdfjs.GlobalWorkerOptions.workerPort = activePdfWorkerBlock
    return
  } catch {
    // Fallback for environments where Worker construction is restricted.
  }

  pdfjs.GlobalWorkerOptions.workerPort = null
  pdfjs.GlobalWorkerOptions.workerSrc = `${pdfWorkerSrcBlock}?pdfjs=${encodeURIComponent(version)}`
}

configurePdfWorkerBlock()

interface PdfDocumentBlockProps {
  path: string
  className?: string
  /** Whether this mount is a real reading surface (see MarkdownDocumentBlock's
   *  `countsAsReading` — previews and tiles must not accrue attention). */
  countsAsReading?: boolean
  active?: boolean
  /** Where the document header wants the toolbar docked; null floats it. */
  toolbarHost?: HTMLElement | null
  /** Height of header chrome laid over the top of this viewport, in px. The
   *  first page starts below it; later pages scroll under it. */
  topInset?: number
  /** Scroll direction as a reader chrome signal: true once the reader scrolls
   *  down, false on scroll-up or back at the top — the markdown header rule. */
  onChromeHiddenChange?: (hidden: boolean) => void
}

function clampPageBlock(value: number, numPages: number): number {
  if (numPages <= 0) return 1
  return Math.max(1, Math.min(value, numPages))
}

function clampScaleBlock(value: number): number {
  return Math.max(MIN_SCALE_BLOCK, Math.min(value, MAX_SCALE_BLOCK))
}

function normalizeScaleBlock(value: number): number {
  return Number(clampScaleBlock(value).toFixed(2))
}

export default function PdfDocumentBlock({
  path,
  className,
  countsAsReading = false,
  active = true,
  toolbarHost = null,
  topInset = 0,
  onChromeHiddenChange,
}: PdfDocumentBlockProps) {
  const electronRuntime = isElectronRuntimeBlock()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  /* The page column. This, not the scroll container, is what a pinch scales. */
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const pinchTouchActiveRef = useRef(false)
  /* Two fingers are down and being watched, but the pinch has not been claimed
     yet — see PINCH_ACTIVATION_PX_BLOCK. */
  const pinchCandidateRef = useRef(false)
  /* True from first touch until the commit lands. Suspends page rasters, so a
     gesture never competes with pdf.js for the main thread. */
  const gestureActiveRef = useRef(false)
  const pinchStartDistanceRef = useRef(0)
  const pinchStartScaleRef = useRef(1)
  const zoomModeRef = useRef<PdfZoomModeBlock>('fit-width')
  const scaleRef = useRef(1)
  const pendingScaleRef = useRef<number | null>(null)
  const previewRafRef = useRef<number | null>(null)
  const commitTimerRef = useRef<number | null>(null)
  /* Focal point of the in-flight zoom gesture, in viewport-local pixels, plus
     the scroll/scale state the layout was in when the gesture started. Consumed
     once by the post-commit layout effect to hold that point steady. */
  const zoomAnchorRef = useRef<{
    focalX: number
    focalY: number
    scrollTop: number
    scrollLeft: number
    prevScale: number
    viewportWidth: number
    viewportHeight: number
    contentWidth: number
    contentHeight: number
  } | null>(null)
  const pendingScrollAnchorRef = useRef<{ scrollTop: number; scrollLeft: number } | null>(null)
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [zoomMode, setZoomMode] = useState<PdfZoomModeBlock>('fit-width')
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [renderNonce, setRenderNonce] = useState(0)
  const [gestureActive, setGestureActive] = useState(false)
  const [docProxy, setDocProxy] = useState<PDFDocumentProxy | null>(null)
  const [markStyle, setMarkStyle] = useState<PdfMarkStyleBlock>(readPdfMarkStyleBlock)

  const applyMarkStyleBlock = useCallback((next: PdfMarkStyleBlock) => {
    setMarkStyle(next)
    writePdfMarkStyleBlock(next)
  }, [])

  const inkColor = resolvePdfMarkColorBlock(markStyle.penColorKey).rgb
  const inkThickness = resolvePdfStrokeThicknessBlock(markStyle.nib)
  const inkOpacity = PDF_PEN_OPACITY_BLOCK
  const [paperTheme, setPaperTheme] = useState<PdfPaperThemeBlock>(readPdfPaperThemeBlock)

  const { metricsByPage, fallbackMetrics } = usePdfPageMetricsBlock(docProxy)

  /* The annotation layer still speaks in crop terms so its geometry stays
     general, but the reader no longer trims: an empty crop is the identity. */
  const crop = EMPTY_PDF_CROP_BOX_BLOCK

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFileBytes(null)
    setFileSizeBytes(null)
    setNumPages(0)
    /* Start the render window on the bookmarked page, so the pages rastered
       first are the ones the restore is about to scroll to rather than 1-3. */
    setPageNumber(countsAsReading ? readPdfReadingPositionBlock(path)?.page ?? 1 : 1)
    setRenderNonce(0)
    setDocProxy(null)
    void readPdfDocumentOrch(path)
      .then((doc) => {
        if (cancelled) return
        setFileBytes(doc.bytes)
        setFileSizeBytes(doc.size)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load PDF.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    /* `countsAsReading` is fixed for the life of a mount; re-reading the file
       because it flipped would be the wrong response anyway. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    const target = viewportRef.current
    if (!target) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      const nextWidth = Math.floor(rect?.width ?? 0)
      const nextHeight = Math.floor(rect?.height ?? 0)
      setViewportWidth(nextWidth > 0 ? nextWidth : 0)
      setViewportHeight(nextHeight > 0 ? nextHeight : 0)
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    zoomModeRef.current = zoomMode
  }, [zoomMode])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  /* One scale for the whole document, derived from page 1. Each page then
     renders at its own natural size times that scale, which is what makes a
     mixed-size document lay out correctly. */
  const documentMetrics = fallbackMetrics ?? DEFAULT_PDF_NATURAL_PAGE_METRICS_BLOCK
  const displayedScale = useMemo(() => computeDisplayedPdfScaleBlock({
    zoomMode,
    scale,
    viewportWidth,
    viewportHeight,
    pageMetrics: documentMetrics,
  }), [documentMetrics, scale, viewportHeight, viewportWidth, zoomMode])

  const displayedScaleRef = useRef(displayedScale)
  useEffect(() => {
    displayedScaleRef.current = displayedScale
  }, [displayedScale])

  /* Runs after the scale-driven relayout but before paint, so the focal point
     never visibly drifts. Page containers carry explicit per-page heights, so
     the geometry here is already final even though pdf.js re-rasters async. */
  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current
    if (!anchor) return
    pendingScrollAnchorRef.current = null
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = anchor.scrollTop
    viewport.scrollLeft = anchor.scrollLeft
  }, [displayedScale])

  /* The pinch preview scales the page column.

     I moved this to the scroll container earlier on the theory that promoting
     the column allocated a huge composited layer, and asserted that as the
     cause of the jank. That was a hypothesis stated as a finding, and it was
     wrong in a way that is visible: scaling a scroll container scales the
     *window*, so zooming out shrank the viewport rectangle and revealed the
     surround around it instead of showing more pages, and the background
     itself slid under the gesture. Preview only ever scales content.

     Back on the column, where the geometry is correct. The surround now lives
     on the root rather than on the scroller, so nothing but the pages moves. */
  const clearPreviewTransformBlock = () => {
    const previewTarget = previewContainerRef.current
    if (!previewTarget) return
    previewTarget.style.transform = ''
    previewTarget.style.transformOrigin = ''
    previewTarget.style.willChange = ''
    const viewport = viewportRef.current
    if (viewport) viewport.style.touchAction = ''
  }

  const applyPreviewTransformBlock = (nextScale: number) => {
    const previewTarget = previewContainerRef.current
    if (!previewTarget) return
    const baseScale = displayedScaleRef.current
    if (!Number.isFinite(baseScale) || baseScale <= 0) return
    const transformScale = nextScale / baseScale
    if (!Number.isFinite(transformScale)) return
    if (Math.abs(transformScale - 1) < 0.001) {
      clearPreviewTransformBlock()
      return
    }

    /* The focal point is in viewport coordinates; the column's origin needs it
       in the column's own box. Scroll offset converts viewport to content
       space, and offsetLeft/offsetTop accounts for the column being centred
       inside the scroller. */
    const anchor = zoomAnchorRef.current
    const origin = anchor
      ? `${anchor.scrollLeft + anchor.focalX - previewTarget.offsetLeft}px ${anchor.scrollTop + anchor.focalY - previewTarget.offsetTop}px`
      : 'top center'

    previewTarget.style.transform = `scale(${transformScale})`
    previewTarget.style.transformOrigin = origin
    previewTarget.style.willChange = 'transform'

    /* Stop the scroller competing with the pinch for the same touches. */
    const viewport = viewportRef.current
    if (viewport) viewport.style.touchAction = 'none'
  }

  /* Capture where the gesture is pointing, in viewport-local pixels, along
     with the scroll/scale the layout currently sits at. */
  const beginZoomGestureBlock = (focalClientX: number, focalClientY: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    /* Content dimensions are read now, before any preview transform is applied
       — a transformed child perturbs scrollWidth/scrollHeight. */
    zoomAnchorRef.current = {
      focalX: focalClientX - rect.left,
      focalY: focalClientY - rect.top,
      scrollTop: viewport.scrollTop,
      scrollLeft: viewport.scrollLeft,
      prevScale: displayedScaleRef.current,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      contentWidth: viewport.scrollWidth,
      contentHeight: viewport.scrollHeight,
    }
  }

  useEffect(() => {
    if (zoomMode !== 'fit-width' && zoomMode !== 'fit-page') return
    pendingScaleRef.current = null
    if (previewRafRef.current !== null) {
      window.cancelAnimationFrame(previewRafRef.current)
      previewRafRef.current = null
    }
    clearPreviewTransformBlock()
  }, [zoomMode])

  useEffect(() => {
    const target = viewportRef.current
    if (!target) return

    const clearPendingRenderHandlesBlock = () => {
      if (previewRafRef.current !== null) {
        window.cancelAnimationFrame(previewRafRef.current)
        previewRafRef.current = null
      }
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }
    }

    const commitPreviewScaleBlock = () => {
      const nextScale = pendingScaleRef.current
      const anchor = zoomAnchorRef.current
      clearPendingRenderHandlesBlock()
      pendingScaleRef.current = null
      zoomAnchorRef.current = null
      clearPreviewTransformBlock()
      gestureActiveRef.current = false
      setGestureActive(false)
      if (nextScale === null || Math.abs(scaleRef.current - nextScale) < 0.01) return

      /* Queue the scroll correction for the layout effect that fires after the
         relayout; assigning it here would be against the pre-zoom geometry. */
      if (anchor) {
        pendingScrollAnchorRef.current = computeZoomScrollAnchorBlock({
          scrollTop: anchor.scrollTop,
          scrollLeft: anchor.scrollLeft,
          focalX: anchor.focalX,
          focalY: anchor.focalY,
          prevScale: anchor.prevScale,
          nextScale,
          viewportWidth: anchor.viewportWidth,
          viewportHeight: anchor.viewportHeight,
          contentWidth: anchor.contentWidth,
          contentHeight: anchor.contentHeight,
        })
      }

      scaleRef.current = nextScale
      setScale(nextScale)
    }

    const schedulePreviewScaleBlock = (nextScale: number) => {
      pendingScaleRef.current = nextScale
      if (previewRafRef.current !== null) return
      previewRafRef.current = window.requestAnimationFrame(() => {
        previewRafRef.current = null
        if (pendingScaleRef.current !== null) {
          applyPreviewTransformBlock(pendingScaleRef.current)
        }
      })
    }

    const scheduleCommitScaleBlock = (delayMs: number) => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current)
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null
        commitPreviewScaleBlock()
      }, delayMs)
    }

    const readTouchDistanceBlock = (touches: TouchList): number | null => {
      if (touches.length < 2) return null
      const [firstTouch, secondTouch] = [touches[0], touches[1]]
      return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY)
    }

    /* Watch, do not claim. Nothing is zoomed, no mode is switched and no event
       is cancelled until the fingers have actually spread or pinched past the
       activation threshold; until then this is a two-finger scroll. */
    /* Apple Pencil must never scroll the document.

       `touch-action` and `preventDefault` on the pointer event both come too
       late: WebKit decides a touch is a scroll from its own touch pipeline
       before either is consulted, so a stroke dragged the page out from under
       the nib and a word could not be finished. Safari exposes
       `Touch.touchType`, which is 'stylus' for a Pencil — cancelling the
       touchstart at that point is what actually stops the scroll from starting.

       Deliberately a separate, non-passive listener: the pinch handler below
       must stay passive to avoid making every two-finger scroll slower. */
    const isStylusTouchBlock = (touches: TouchList): boolean => {
      for (let index = 0; index < touches.length; index += 1) {
        if ((touches[index] as Touch & { touchType?: string }).touchType === 'stylus') return true
      }
      return false
    }

    const handleStylusTouchBlock = (event: TouchEvent) => {
      if (isStylusTouchBlock(event.touches)) event.preventDefault()
    }

    const handleTouchStartBlock = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const distance = readTouchDistanceBlock(event.touches)
      if (!distance || distance <= 0) return

      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }

      pinchCandidateRef.current = true
      pinchTouchActiveRef.current = false
      pinchStartDistanceRef.current = distance
      pinchStartScaleRef.current = displayedScaleRef.current
    }

    const activatePinchBlock = (touches: TouchList) => {
      const [firstTouch, secondTouch] = [touches[0], touches[1]]
      beginZoomGestureBlock(
        (firstTouch.clientX + secondTouch.clientX) / 2,
        (firstTouch.clientY + secondTouch.clientY) / 2,
      )

      pinchTouchActiveRef.current = true
      gestureActiveRef.current = true
      setGestureActive(true)

      const currentInteractiveScale = pinchStartScaleRef.current
      if (zoomModeRef.current !== 'manual') {
        zoomModeRef.current = 'manual'
        setZoomMode('manual')
        scaleRef.current = currentInteractiveScale
        setScale(currentInteractiveScale)
      }
    }

    const handleTouchMoveBlock = (event: TouchEvent) => {
      if (!pinchCandidateRef.current && !pinchTouchActiveRef.current) return
      const distance = readTouchDistanceBlock(event.touches)
      if (!distance || distance <= 0) return

      if (!pinchTouchActiveRef.current) {
        if (Math.abs(distance - pinchStartDistanceRef.current) < PINCH_ACTIVATION_PX_BLOCK) return
        activatePinchBlock(event.touches)
      }

      event.preventDefault()
      const nextScale = normalizeScaleBlock(pinchStartScaleRef.current * (distance / pinchStartDistanceRef.current))
      if (Math.abs((pendingScaleRef.current ?? scaleRef.current) - nextScale) < 0.01) return
      schedulePreviewScaleBlock(nextScale)
    }

    const handleTouchEndBlock = (event: TouchEvent) => {
      if (event.touches.length >= 2) return
      pinchCandidateRef.current = false
      if (!pinchTouchActiveRef.current) return
      pinchTouchActiveRef.current = false
      scheduleCommitScaleBlock(0)
    }

    const handleWheelBlock = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return
      event.preventDefault()

      const currentInteractiveScale = pendingScaleRef.current ?? displayedScaleRef.current

      /* First wheel tick of a burst establishes the anchor; later ticks keep
         zooming about that same point until the debounced commit lands. */
      if (!zoomAnchorRef.current) {
        beginZoomGestureBlock(event.clientX, event.clientY)
        gestureActiveRef.current = true
        setGestureActive(true)
      }

      if (zoomModeRef.current !== 'manual') {
        zoomModeRef.current = 'manual'
        setZoomMode('manual')
        scaleRef.current = currentInteractiveScale
        setScale(currentInteractiveScale)
      }

      const zoomMultiplier = Math.exp(-event.deltaY * TRACKPAD_ZOOM_SENSITIVITY_BLOCK)
      const nextScale = normalizeScaleBlock(currentInteractiveScale * zoomMultiplier)
      if (Math.abs(currentInteractiveScale - nextScale) < 0.01) return

      schedulePreviewScaleBlock(nextScale)
      scheduleCommitScaleBlock(TRACKPAD_COMMIT_DEBOUNCE_MS_BLOCK)
    }

    target.addEventListener('touchstart', handleStylusTouchBlock, { passive: false })
    target.addEventListener('touchmove', handleStylusTouchBlock, { passive: false })
    target.addEventListener('touchstart', handleTouchStartBlock, { passive: true })
    target.addEventListener('touchmove', handleTouchMoveBlock, { passive: false })
    target.addEventListener('touchend', handleTouchEndBlock, { passive: true })
    target.addEventListener('touchcancel', handleTouchEndBlock, { passive: true })
    target.addEventListener('wheel', handleWheelBlock, { passive: false })

    return () => {
      clearPendingRenderHandlesBlock()
      clearPreviewTransformBlock()
      pinchTouchActiveRef.current = false
      pinchStartDistanceRef.current = 0
      target.removeEventListener('touchstart', handleStylusTouchBlock)
      target.removeEventListener('touchmove', handleStylusTouchBlock)
      target.removeEventListener('touchstart', handleTouchStartBlock)
      target.removeEventListener('touchmove', handleTouchMoveBlock)
      target.removeEventListener('touchend', handleTouchEndBlock)
      target.removeEventListener('touchcancel', handleTouchEndBlock)
      target.removeEventListener('wheel', handleWheelBlock)
    }
    /* Handlers read live state through refs, so the listeners are attached
       once for the life of the viewport rather than on every zoom. */
  }, [])

  const { layout } = useUILayoutBlock()
  const isIosSurface = layout.surface === 'capacitor-ios'

  const documentFile = useMemo(() => {
    if (!fileBytes) return null
    const skipCopyForLargeElectronPdf = electronRuntime && fileBytes.byteLength >= LARGE_PDF_BYTES_THRESHOLD_BLOCK
    // pdf.js may transfer/consume ArrayBuffers through worker messaging.
    // For very large Electron PDFs, avoid extra copy to reduce crash-prone memory spikes.
    if (skipCopyForLargeElectronPdf) return { data: fileBytes }
    // Otherwise provide a fresh copy so retries/rerenders never reuse a detached buffer.
    return { data: fileBytes.slice() }
  }, [electronRuntime, fileBytes, renderNonce])

  /* The raw ratio. It used to be clamped to 1.25 on Electron as a blunt guard
     against oversized canvases, which cost sharpness on every page whether or
     not the page was actually large. The per-page pixel budget now handles
     that case precisely, and gives up dpr only when a specific page at a
     specific zoom would exceed the surface's ceiling. */
  const pageDevicePixelRatio = useMemo(() => {
    if (typeof window === 'undefined') return 1
    return Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
  }, [])

  const rasterPixelBudget = useMemo(
    () => resolvePdfRasterPixelBudgetBlock(isIosSurface),
    [isIosSurface],
  )

  /* Each page plans its own bitmap: documents mix paper sizes, and a budget
     applied to a document-wide average would either waste memory on the small
     pages or blow the ceiling on the large ones. */
  const rasterPlanForBlock = useCallback((page: number) => computePdfRasterPlanBlock({
    displayedScale,
    devicePixelRatio: pageDevicePixelRatio,
    pageMetrics: resolvePdfPageMetricsBlock({ page, metricsByPage, fallbackMetrics }),
    maxPagePixels: rasterPixelBudget,
  }), [displayedScale, fallbackMetrics, metricsByPage, pageDevicePixelRatio, rasterPixelBudget])

  // A PDF page is the cleanest address of the three reading surfaces: discrete,
  // stable for the life of the file, and already what a person would say out
  // loud. `pageNumber` is derived by the IntersectionObserver below, so the
  // sampler reads it through a ref rather than re-deriving anything.
  const pageNumberRef = useRef(pageNumber)
  pageNumberRef.current = pageNumber
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const pageSampler = useCallback(
    () => (numPages > 0 ? pageNumberRef.current : null),
    [numPages],
  )
  // See MarkdownDocumentBlock: `active` is pane selection, not visibility, and
  // every workspace tab stays mounted when you navigate away from it.
  const surfaceVisible = useRouteActivityBlock()
  useReadingAttentionBlock(
    countsAsReading ? path : null,
    surfaceVisible && active && !loading && error === null,
    {
      pageSampler,
      surfaceRef,
      inputs: { surfaceVisible, active, loading, errored: error !== null },
    },
  )

  const canGoPrev = pageNumber > 1
  const canGoNext = numPages > 0 && pageNumber < numPages
  /* Per-page, so placeholders for pages outside the render window reserve the
     right space and the scrollbar stops lying on mixed-size documents. */
  const pageBoxForBlock = useCallback((page: number) => computePdfPageBoxBlock({
    page,
    zoomMode,
    scale,
    viewportWidth,
    viewportHeight,
    metricsByPage,
    fallbackMetrics,
  }), [fallbackMetrics, metricsByPage, scale, viewportHeight, viewportWidth, zoomMode])
  const pageHeightForBlock = useCallback(
    (page: number) => pageBoxForBlock(page).height,
    [pageBoxForBlock],
  )
  /* Two bands, not one.

     A single window is why pages kept going blank: a page was unmounted the
     moment it left it, so scrolling back one page showed an empty box where a
     fully rendered page had been a second earlier. Widening one window trades
     that for memory on every page equally, which is the wrong trade — most of
     those pages never need to be re-rastered, they just need to keep the pixels
     they already have.

     `renderWindow` is where pages raster and re-raster on zoom. `retainWindow`
     is where they stay mounted holding the bitmap they last drew. Outside both,
     a page is blank paper. */
  const renderWindow = useMemo(() => buildPdfRenderedWindowBlock({
    centerPage: pageNumber,
    numPages,
  }), [numPages, pageNumber])

  const retainWindow = useMemo(() => buildPdfRetainedWindowBlock({
    centerPage: pageNumber,
    numPages,
    retain: isIosSurface ? PDF_RETAIN_PAGES_IOS_BLOCK : PDF_RETAIN_PAGES_DESKTOP_BLOCK,
  }), [isIosSurface, numPages, pageNumber])

  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  usePdfReadingPositionBlock({
    path,
    enabled: countsAsReading,
    numPages,
    viewportRef,
    surfaceRef,
    pageRefs,
    metricsByPage,
    displayedScale,
  })

  const scrollToPage = useCallback((page: number, immediate = false) => {
    const el = pageRefs.current.get(page)
    if (el) el.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || numPages <= 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        let topMostPage = pageNumber
        let topMostTop = Infinity
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = Number(entry.target.getAttribute('data-page'))
          if (!page) continue
          const top = entry.boundingClientRect.top
          if (top < topMostTop) {
            topMostTop = top
            topMostPage = page
          }
        }
        setPageNumber((prev) => (prev === topMostPage ? prev : topMostPage))
      },
      { root: viewport, threshold: 0.1 },
    )

    for (const [, el] of pageRefs.current) observer.observe(el)
    return () => observer.disconnect()
  }, [numPages, pageNumber])

  /* Toolbar and keyboard zoom anchor at the viewport centre, which is the
     closest equivalent to "the thing you were looking at" when there is no
     cursor or pinch focal point to use. */
  const commitManualScaleBlock = useCallback((nextScale: number) => {
    const normalized = normalizeScaleBlock(nextScale)
    const viewport = viewportRef.current
    if (viewport) {
      pendingScrollAnchorRef.current = computeZoomScrollAnchorBlock({
        scrollTop: viewport.scrollTop,
        scrollLeft: viewport.scrollLeft,
        focalX: viewport.clientWidth / 2,
        focalY: viewport.clientHeight / 2,
        prevScale: displayedScaleRef.current,
        nextScale: normalized,
        viewportWidth: viewport.clientWidth,
        viewportHeight: viewport.clientHeight,
        contentWidth: viewport.scrollWidth,
        contentHeight: viewport.scrollHeight,
      })
    }

    pendingScaleRef.current = null
    clearPreviewTransformBlock()
    zoomModeRef.current = 'manual'
    setZoomMode('manual')
    scaleRef.current = normalized
    setScale(normalized)
  }, [])

  const stepZoomBlock = useCallback((direction: 1 | -1) => {
    commitManualScaleBlock(stepPdfZoomScaleBlock(displayedScaleRef.current, direction))
  }, [commitManualScaleBlock])

  const applyZoomModeBlock = useCallback((mode: PdfZoomModeBlock) => {
    pendingScaleRef.current = null
    clearPreviewTransformBlock()
    zoomModeRef.current = mode
    setZoomMode(mode)
    if (mode === 'manual') {
      const current = normalizeScaleBlock(displayedScaleRef.current)
      scaleRef.current = current
      setScale(current)
    }
  }, [])

  useEffect(() => {
    const handleKeyDownBlock = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      /* Never steal keys from a focused field — the viewer shares the window
         with the markdown editor and the command palette. */
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return

      const zoomModifier = event.metaKey || event.ctrlKey

      if (zoomModifier && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        stepZoomBlock(1)
        return
      }
      if (zoomModifier && event.key === '-') {
        event.preventDefault()
        stepZoomBlock(-1)
        return
      }
      if (zoomModifier && event.key === '0') {
        event.preventDefault()
        applyZoomModeBlock('actual')
        return
      }
      if (zoomModifier && event.key === '9') {
        event.preventDefault()
        applyZoomModeBlock('fit-page')
        return
      }
      if (!zoomModifier && event.key === 'Home') {
        event.preventDefault()
        setPageNumber(1)
        scrollToPage(1)
        return
      }
      if (!zoomModifier && event.key === 'End' && numPages > 0) {
        event.preventDefault()
        setPageNumber(numPages)
        scrollToPage(numPages)
      }
    }

    window.addEventListener('keydown', handleKeyDownBlock)
    return () => window.removeEventListener('keydown', handleKeyDownBlock)
  }, [applyZoomModeBlock, numPages, scrollToPage, stepZoomBlock])

  const {
    annotations,
    addAnnotation,
    undoLastAnnotation,
    saveState: annotationSaveState,
    saveError: annotationSaveError,
  } = usePdfAnnotationsBlock({
    doc: docProxy,
    path,
    enabled: countsAsReading,
    originalByteLength: fileSizeBytes ?? 0,
  })

  /* Uncropped geometry per page. Annotations are stored in full-page PDF
     coordinates so that toggling the margin crop never moves an existing mark
     — the crop is a view concern and must not leak into the file. */
  const { rect: selectionRect, clearSelection } = useTextSelectionBlock({
    containerRef: viewportRef,
    enabled: countsAsReading && !loading && error === null,
  })

  const geometryForBlock = useCallback((page: number): PdfPageGeometryBlock => {
    const natural = resolvePdfPageMetricsBlock({
      page,
      metricsByPage,
      fallbackMetrics,
    })
    return {
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      scale: pageBoxForBlock(page).scale,
      crop,
    }
  }, [crop, fallbackMetrics, metricsByPage, pageBoxForBlock])

  const commitInkBlock = useCallback((page: number, points: PointBlock[]) => {
    const flat: number[] = []
    for (const point of points) flat.push(point.x, point.y)
    addAnnotation({
      kind: 'ink',
      id: `ink-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber: page,
      inkList: [flat],
      color: inkColor,
      opacity: inkOpacity,
      thickness: inkThickness,
    })
  }, [addAnnotation, inkColor, inkOpacity, inkThickness])

  /* The Pencil's highlighter: rects come from hit-testing the text layer along
     the stroke, so they are already snapped to the line. Only one page can be
     involved, because the stroke happened inside that page's element. */
  const commitPenHighlightBlock = useCallback((page: number, rects: DOMRect[], text: string) => {
    const element = pageRefs.current.get(page)
    if (!element || rects.length === 0) return

    const pageRect = element.getBoundingClientRect()
    const geometry = geometryForBlock(page)
    const quadPoints: number[] = []

    /* Merged first: overlapping quads cancel each other under the even-odd
       fill pdf.js writes into the appearance stream. */
    for (const rect of mergeSelectionRectsBlock(rects.map((rect) => ({
      left: rect.left - pageRect.left,
      top: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
    })))) {
      quadPoints.push(...screenRectToQuadPointsBlock(rect, geometry))
    }

    addAnnotation({
      kind: 'highlight',
      id: `hl-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber: page,
      quadPoints,
      color: resolvePdfMarkColorBlock(markStyle.highlightColorKey).rgb,
      opacity: HIGHLIGHT_OPACITY_BLOCK,
      text,
    })
  }, [addAnnotation, geometryForBlock, markStyle.highlightColorKey])

  /* Selection -> highlight. Rects are grouped by the page element that
     contains them, so a selection running across a page break produces one
     highlight per page rather than a single annotation with coordinates that
     belong to neither. */
  const highlightSelectionBlock = useCallback((colorKey: string) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    const text = selection.toString().trim()
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1)
    if (rects.length === 0) return

    const color = resolvePdfMarkColorBlock(colorKey).rgb
    const quadsByPage = new Map<number, number[]>()

    for (const [page, element] of pageRefs.current) {
      const pageRect = element.getBoundingClientRect()
      const geometry = geometryForBlock(page)

      const onThisPage = rects.filter((rect) => {
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        return centerX >= pageRect.left && centerX <= pageRect.right
          && centerY >= pageRect.top && centerY <= pageRect.bottom
      })

      /* Merged before conversion. A browser reports two overlapping rects for
         every line in the middle of a selection, and two stacked quads cancel
         under the even-odd fill pdf.js writes — see mergeSelectionRectsBlock. */
      for (const rect of mergeSelectionRectsBlock(onThisPage.map((rect) => ({
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        width: rect.width,
        height: rect.height,
      })))) {
        const quad = screenRectToQuadPointsBlock(rect, geometry)
        const existing = quadsByPage.get(page)
        if (existing) existing.push(...quad)
        else quadsByPage.set(page, [...quad])
      }
    }

    for (const [page, quadPoints] of quadsByPage) {
      addAnnotation({
        kind: 'highlight',
        id: `hl-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageNumber: page,
        quadPoints,
        color,
        opacity: HIGHLIGHT_OPACITY_BLOCK,
        text,
      })
    }

    clearSelection()
  }, [addAnnotation, clearSelection, geometryForBlock])

  /* Focus mode, mirroring the Excalidraw one: the reader takes the whole
     window as `fixed inset-0`, the native iOS chrome leaves, and the toolbar
     becomes an overlay that hides as you read.

     The first attempt auto-hid the toolbar in place and reserved its height
     with padding — which hid the controls and kept the empty strip, spending
     the space and getting nothing. An overlay over a full-bleed page is the
     only version where hiding the bar actually returns the pixels. */
  const [focusMode, setFocusMode] = useState(false)
  /* Only focus mode auto-hides the pill. With the header merely hidden the
     pill stays put: it is the only chrome left, and reaching for it should
     never first require a scroll-up. */
  const autoHideChrome = focusMode
  const { chromeVisible, toggleChrome } = useReaderChromeVisibilityBlock({
    scrollRef: viewportRef,
    enabled: autoHideChrome && !loading && error === null,
  })

  useNativeChromeImmersionBlock(focusMode)

  useEffect(() => {
    if (!focusMode) return
    const onKeyDownBlock = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false)
    }
    window.addEventListener('keydown', onKeyDownBlock)
    return () => window.removeEventListener('keydown', onKeyDownBlock)
  }, [focusMode])

  const applyPaperThemeBlock = useCallback((next: PdfPaperThemeBlock) => {
    setPaperTheme(next)
    writePdfPaperThemeBlock(next)
  }, [])

  /* The controls, rendered in one of two places: docked into the document
     header when there is one on screen, floating as a pill when there is not.
     Floating under a visible header read as a second bar of chrome stacked on
     the first, belonging to neither the header nor the page. */
  const toolbarControls = (
    <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          disabled={!canGoPrev}
          onClick={() => { const p = Math.max(1, pageNumber - 1); setPageNumber(p); scrollToPage(p) }}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </Button>
        <PdfPageJumpBlock
          pageNumber={pageNumber}
          numPages={numPages}
          onJump={(p) => { setPageNumber(p); scrollToPage(p) }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          disabled={!canGoNext}
          onClick={() => { const p = numPages > 0 ? Math.min(numPages, pageNumber + 1) : pageNumber; setPageNumber(p); scrollToPage(p) }}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Button>

        <div className="mx-1.5 h-4 w-px shrink-0 bg-border/60" />

        {/* Buttons first, menu second: pinch and ⌘-scroll are imprecise on a
            trackpad, and a click that lands on a round number every time is
            what people actually reach for. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          onClick={() => stepZoomBlock(-1)}
          title="Zoom out (⌘−)"
        >
          <Minus className="h-4 w-4" strokeWidth={1.75} />
        </Button>
        <PdfToolbarMenuBlock
          title="Zoom"
          className="min-w-[4.5rem] px-2 text-[13px] font-medium tabular-nums"
          label={`${(displayedScale * 100).toFixed(0)}%`}
          entries={[
            {
              key: 'fit-width',
              label: 'Fit width',
              checked: zoomMode === 'fit-width',
              onClick: () => applyZoomModeBlock('fit-width'),
            },
            {
              key: 'fit-page',
              label: 'Fit page  ⌘9',
              checked: zoomMode === 'fit-page',
              onClick: () => applyZoomModeBlock('fit-page'),
            },
            {
              key: 'actual',
              label: 'Actual size  ⌘0',
              checked: zoomMode === 'actual',
              onClick: () => applyZoomModeBlock('actual'),
            },
          ]}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          onClick={() => stepZoomBlock(1)}
          title="Zoom in (⌘+)"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </Button>

        <div className="mx-1.5 h-4 w-px shrink-0 bg-border/60" />

        <PdfToolbarMenuBlock
          title="Paper tone"
          className="px-2.5 text-[13px] font-medium"
          label={(
            <span className="flex items-center gap-2">
              {/* A tiny sheet in the current tone, so the control shows the
                  paper rather than only naming it. */}
              <span
                aria-hidden="true"
                className="h-[14px] w-[11px] rounded-[2px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
                style={{ background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[paperTheme] }}
              />
              {PDF_PAPER_THEME_LABELS_BLOCK[paperTheme]}
            </span>
          )}
          entries={PDF_PAPER_THEMES_BLOCK.map((theme) => ({
            key: theme,
            label: PDF_PAPER_THEME_LABELS_BLOCK[theme],
            checked: paperTheme === theme,
            onClick: () => applyPaperThemeBlock(theme),
          }))}
        />
        <PdfMarkSettingsBlock style={markStyle} onChange={applyMarkStyleBlock} className="px-2.5" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          onClick={undoLastAnnotation}
          title="Undo the last unsaved mark"
        >
          <Undo2 className="h-4 w-4" strokeWidth={1.75} />
        </Button>

        {/* Marks are written into the PDF itself, so save state is not a
            detail to hide — an unwritable file is the one case where a
            reader's marks would otherwise vanish without a word. */}
        {annotationSaveState === 'pending' && (
          <span className="shrink-0 px-1 text-[11px] text-muted-foreground">Saving…</span>
        )}
        {annotationSaveState === 'saved' && (
          <span className="shrink-0 px-1 text-[11px] text-muted-foreground">Saved</span>
        )}
        {annotationSaveState === 'unwritable' && (
          <span className="shrink-0 px-1 text-[11px] text-destructive" title={annotationSaveError ?? undefined}>
            Can't write PDF
          </span>
        )}

        <div className="mx-1.5 h-4 w-px shrink-0 bg-border/60" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-8 border border-transparent px-0"
          onClick={() => setFocusMode((prev) => !prev)}
          title={focusMode ? 'Leave focus mode (Esc)' : 'Focus mode — full screen reading'}
        >
          {focusMode ? <Minimize2 className="h-4 w-4" strokeWidth={1.75} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.75} />}
        </Button>
    </>
  )

  const docked = toolbarHost !== null && !autoHideChrome

  /* Link peeks and jumps. Hovering a citation or figure reference shows a crop
     of where it points (PdfLinkPeekBlock); clicking jumps there and leaves a
     "Back" chip, because the reader almost always wants to return to the
     sentence they were reading. A tap on touch opens the peek instead, since
     there is no hover to preview with. */
  const { peek, openPeek, leavePeek, holdPeek, closePeek } = usePdfLinkPeekBlock(docProxy)
  const [backTarget, setBackTarget] = useState<{ scrollTop: number; page: number } | null>(null)

  const jumpToDestBlock = useCallback((page: number, destTop: number | null) => {
    const viewport = viewportRef.current
    const element = pageRefs.current.get(page)
    if (!viewport || !element) return
    setBackTarget({ scrollTop: viewport.scrollTop, page: pageNumber })
    const pageTop = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    const within = destTop === null ? 0 : Math.max(0, destTop - crop.top) * pageBoxForBlock(page).scale
    const clearance = (docked ? topInset + 12 : 56) + 12
    viewport.scrollTo({ top: Math.max(0, pageTop + within - clearance), behavior: 'smooth' })
  }, [crop.top, docked, pageBoxForBlock, pageNumber, topInset])

  /* Pages hold these across renders; the ref keeps the object stable so a
     page does not re-render just because the viewer did. */
  const linkActionsRef = useRef<PdfPageLinkHandlersBlock | null>(null)
  linkActionsRef.current = {
    onEnter: ({ link, anchor }) => {
      if (link.kind === 'internal') openPeek(link, anchor)
    },
    onLeave: leavePeek,
    onActivate: ({ link, anchor, pointerType }) => {
      if (link.kind === 'external') {
        void openExternalUrlOrch(link.url).catch(() => undefined)
        return
      }
      if (pointerType === 'touch') {
        openPeek(link, anchor, { immediate: true, touch: true })
        return
      }
      closePeek()
      if (!docProxy) return
      void resolvePdfLinkPeekTargetBlock(docProxy, link)
        .then((target) => { if (target) jumpToDestBlock(target.pageNumber, target.destTop) })
        .catch(() => undefined)
    },
  }
  const linkHandlers = useMemo<PdfPageLinkHandlersBlock>(() => ({
    onEnter: (event) => linkActionsRef.current?.onEnter(event),
    onLeave: () => linkActionsRef.current?.onLeave(),
    onActivate: (event) => linkActionsRef.current?.onActivate(event),
  }), [])

  /* The card is anchored to where the link was; once the page moves it points
     at nothing, so any scroll closes it. A tap-opened card also closes on a
     tap anywhere else. */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!peek || !viewport) return
    const onScrollBlock = () => closePeek()
    const onPointerDownBlock = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-pdf-link-peek]')) closePeek()
    }
    viewport.addEventListener('scroll', onScrollBlock, { passive: true })
    if (peek.touch) window.addEventListener('pointerdown', onPointerDownBlock)
    return () => {
      viewport.removeEventListener('scroll', onScrollBlock)
      window.removeEventListener('pointerdown', onPointerDownBlock)
    }
  }, [closePeek, peek])

  /* Scroll direction with hysteresis: the title hides after a deliberate
     run of downward scroll and returns after a shorter run upward. A per-event
     threshold flipped on trackpad jitter and on the reversal at the tail of a
     momentum scroll. Revealing is the cheaper mistake, so it needs less
     travel. A pinch moves scrollTop as part of re-anchoring the zoom; that is
     not the reader scrolling. */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !onChromeHiddenChange) return
    const HIDE_AFTER_PX = 24
    const REVEAL_AFTER_PX = 12
    let last = viewport.scrollTop
    let run = 0
    let hidden = false
    const setHiddenBlock = (next: boolean) => {
      if (next === hidden) return
      hidden = next
      onChromeHiddenChange(next)
    }
    const onScrollBlock = () => {
      const top = viewport.scrollTop
      const delta = top - last
      last = top
      if (gestureActiveRef.current || delta === 0) return
      if (top <= 4) {
        run = 0
        setHiddenBlock(false)
        return
      }
      /* A change of direction starts a new run. */
      run = Math.sign(delta) === Math.sign(run) ? run + delta : delta
      if (run >= HIDE_AFTER_PX) setHiddenBlock(true)
      else if (run <= -REVEAL_AFTER_PX) setHiddenBlock(false)
    }
    viewport.addEventListener('scroll', onScrollBlock, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', onScrollBlock)
      if (hidden) onChromeHiddenChange(false)
    }
  }, [onChromeHiddenChange])

  return (
    <div
      ref={surfaceRef}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden',
        /* Owns the reading surround, because the scroll container cannot — see
           the note on the viewport below.

           Explicit rather than `bg-background`, which is `240 14% 97%` in this
           theme: a light grey, which is what kept showing up around the pages.
           Preview's surround is white, and the page separates from it on shadow
           alone. Dark mode gets a near-black desk with the sheets left white,
           which is also what Preview does — a dark *page* is the Night paper
           tone's job, not the surround's. */
        'bg-white dark:bg-[#1c1c1e]',
        /* No background here: the root already paints the reading surround, and
           `bg-background` is a light grey in this theme, so focus mode was
           turning the white desk grey. */
        focusMode ? 'fixed inset-0 z-[70]' : 'h-full',
        className,
      )}
    >
      {/* The window still needs a handle while the reader owns the whole
          window, and the pill is too small to be one. A transparent strip
          along the top edge takes that job — the same 2.25rem the traffic
          lights sit in. */}
      {focusMode && electronRuntime && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-9 [-webkit-app-region:drag]" />
      )}

      {/* A floating pill rather than a ruled bar: the page is the subject and
          the controls sit over the desk, not in a strip above it. The page
          column is padded to clear it at the top and scrolls under it after.

          In focus mode it auto-hides on scroll-down and comes back on
          scroll-up — the same state machine the iOS reader uses. Otherwise
          it stays visible. */}
      {docked ? createPortal(
        <div className="flex items-center gap-0.5 [&_button]:h-8 [&_button]:rounded-full">
          {toolbarControls}
        </div>,
        toolbarHost,
      ) : (
      <div
        className={cn(
          'absolute left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border border-border/60 bg-background/85 px-1.5 py-1 shadow-[0_6px_24px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xl [scrollbar-width:none]',
          'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          'dark:bg-[#2a2a2d]/85 dark:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.6)]',
          electronRuntime && '[-webkit-app-region:no-drag]',
          autoHideChrome && !chromeVisible && 'pointer-events-none -translate-y-[calc(100%+1rem)] opacity-0',
          '[&_button]:h-8 [&_button]:rounded-full',
        )}
        style={{
          top: focusMode && !electronRuntime
            ? 'calc(var(--ltm-safe-top, 0px) + 0.5rem)'
            : '0.5rem',
        }}
      >
        {toolbarControls}
      </div>
      )}

      <div
        ref={viewportRef}
        className={cn(
          /* Top padding clears the floating pill (0.5rem + 2.5rem + gap);
             scroll padding does the same for page jumps, which use
             scrollIntoView and would otherwise park the page under it. */
          'min-h-0 flex-1 overflow-auto p-3',
          !docked && 'pt-14 scroll-pt-14',
          /* Deliberately transparent. The pinch preview scales THIS element,
             so any background painted here scales and slides with the gesture —
             the surround visibly moving during a zoom, which Preview never
             does because it only ever scales the pages. The surround is painted
             by the parent instead, where the transform cannot reach it. */
          'bg-transparent',
          /* The padding is only the top of the scroll: after the first
             screen the pages run under the pill, which is what lets hiding
             it give the pixels back. */
        )}
        style={{
          touchAction: 'pan-x pan-y',
          ...(docked ? { paddingTop: topInset + 12, scrollPaddingTop: topInset + 12 } : null),
        }}
        /* A tap on the page brings the chrome back, the way every native
           reader behaves. Only while immersive — on desktop a click in the
           page is a selection gesture, not a chrome gesture. */
        onClick={focusMode ? toggleChrome : undefined}
      >
        {loading && (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Loading PDF...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && documentFile && (
          <div ref={previewContainerRef} className="mx-auto w-fit origin-top">
            <Document
              key={`${path}:${renderNonce}`}
              file={documentFile}
              options={PDFJS_DOCUMENT_OPTIONS_BLOCK}
              onLoadSuccess={(doc) => {
                setNumPages(doc.numPages)
                setPageNumber((prev) => clampPageBlock(prev, doc.numPages))
                /* Hand the proxy to the metrics hook, which measures every
                   page's box on idle rather than blocking load here. */
                setDocProxy(doc)
              }}
              onLoadError={(docError) => {
                const message = docError instanceof Error ? docError.message : 'Failed to render PDF.'
                const versionMismatch = message.includes('API version')
                  && message.includes('Worker version')
                  && message.includes('does not match')

                if (versionMismatch && renderNonce < 1) {
                  configurePdfWorkerBlock(true)
                  setRenderNonce((prev) => prev + 1)
                  return
                }

                setError(message)
              }}
              loading={(
                <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                  Rendering PDF...
                </div>
              )}
              className="flex w-fit flex-col gap-3"
            >
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <div
                  key={pageNum}
                  ref={(el) => { if (el) pageRefs.current.set(pageNum, el); else pageRefs.current.delete(pageNum) }}
                  data-page={pageNum}
                  style={{ minHeight: `${pageHeightForBlock(pageNum)}px` }}
                >
                  {pageNum >= retainWindow.start && pageNum <= retainWindow.end && docProxy ? (
                    <PdfPageCanvasBlock
                      doc={docProxy}
                      pageNumber={pageNum}
                      displayedWidth={pageBoxForBlock(pageNum).width}
                      displayedHeight={pageBoxForBlock(pageNum).height}
                      displayedScale={pageBoxForBlock(pageNum).scale}
                      plan={rasterPlanForBlock(pageNum)}
                      crop={crop}
                      paperTheme={paperTheme}
                      /* Retained-but-not-rendering pages hold their bitmap
                         instead of re-drawing: soft after a zoom, never blank. */
                      deferRaster={gestureActive
                        || pageNum < renderWindow.start
                        || pageNum > renderWindow.end}
                      isPrimary={pageNum === pageNumber}
                      penTool={markStyle.penTool}
                      onCommitHighlight={commitPenHighlightBlock}
                      geometry={geometryForBlock(pageNum)}
                      annotations={annotations}
                      inkColor={inkColor}
                      inkThickness={inkThickness}
                      onCommitInk={commitInkBlock}
                      linkHandlers={linkHandlers}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{ minHeight: `${pageBoxForBlock(pageNum).height}px` }}
                      /* Blank paper, not a labelled placeholder. A grey box
                         with a shadow and "Page 11" printed in the middle reads
                         as a page that failed rather than one that has not been
                         drawn yet — and while scrolling that is the majority of
                         what you see. */
                      className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.20)] dark:bg-[#232326] dark:shadow-[0_1px_6px_rgba(0,0,0,0.6)]"
                    />
                  )}
                </div>
              ))}
            </Document>
          </div>
        )}
        {!loading && !error && electronRuntime && fileSizeBytes !== null && fileSizeBytes >= LARGE_PDF_BYTES_THRESHOLD_BLOCK && (
          <p className="mx-auto mt-2 max-w-[40rem] text-center text-[11px] text-muted-foreground">
            Large PDF safety mode is active for Electron to reduce crash risk.
          </p>
        )}
      </div>

      {selectionRect && (
        <PdfSelectionHighlightBarBlock
          rect={selectionRect}
          boundsTop={viewportRef.current?.getBoundingClientRect().top ?? 0}
          onPick={(colorKey) => {
            applyMarkStyleBlock({ ...markStyle, highlightColorKey: colorKey })
            highlightSelectionBlock(colorKey)
          }}
        />
      )}

      {peek && docProxy && (
        <PdfLinkPeekBlock
          doc={docProxy}
          target={peek.target}
          anchor={peek.anchor}
          paperTheme={paperTheme}
          touch={peek.touch}
          onGo={() => { closePeek(); jumpToDestBlock(peek.target.pageNumber, peek.target.destTop) }}
          onPointerEnter={holdPeek}
          onPointerLeave={() => { if (!peek.touch) leavePeek() }}
        />
      )}

      {backTarget && (
        <div
          className={cn(
            'absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border/60 bg-background/90 p-1 text-xs shadow-[0_6px_24px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xl',
            'dark:bg-[#2a2a2d]/90',
            focusMode ? 'bottom-20' : 'bottom-5',
          )}
        >
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-muted"
            onClick={() => {
              viewportRef.current?.scrollTo({ top: backTarget.scrollTop, behavior: 'smooth' })
              setBackTarget(null)
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Back to page {backTarget.page}
          </button>
          <button
            type="button"
            title="Dismiss"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setBackTarget(null)}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {focusMode && !loading && !error && (
        <PdfPageScrubberBlock
          pageNumber={pageNumber}
          numPages={numPages}
          visible={chromeVisible}
          onSeek={(page, immediate) => { setPageNumber(page); scrollToPage(page, immediate) }}
        />
      )}
    </div>
  )
}
