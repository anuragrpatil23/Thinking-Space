import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReadingAttentionBlock } from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { ChevronLeft, ChevronRight, Highlighter, RefreshCw, Undo2 } from 'lucide-react'
import { Document, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import PdfJsWorkerBlock from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import pdfWorkerSrcBlock from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from '@/components/lego_blocks/units/ui/button'
import PdfPageCanvasBlock from '@/components/lego_blocks/units/PdfPageCanvasBlock'
import PdfPageScrubberBlock from '@/components/lego_blocks/units/PdfPageScrubberBlock'
import PdfZoomMenuBlock from '@/components/lego_blocks/units/PdfZoomMenuBlock'
import type { PdfAnnotationToolBlock } from '@/components/lego_blocks/units/PdfAnnotationOverlayBlock'
import { usePdfAnnotationsBlock } from '@/components/lego_blocks/hooks/shared/usePdfAnnotationsBlock'
import {
  screenRectToQuadPointsBlock,
  type PdfPageGeometryBlock,
  type PointBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'
import { cn } from '@/lib/utils'
import { readPdfDocumentOrch } from '@/services/orchestrators/pdfDocumentsOrch'
import { usePdfPageMetricsBlock } from '@/components/lego_blocks/hooks/shared/usePdfPageMetricsBlock'
import {
  buildPdfRenderedWindowBlock,
  computeDisplayedPdfScaleBlock,
  computePdfPageBoxBlock,
  computeZoomScrollAnchorBlock,
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
  PDF_PAPER_THEME_LABELS_BLOCK,
  PDF_PAPER_THEMES_BLOCK,
  readPdfPaperThemeBlock,
  writePdfPaperThemeBlock,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'

let activePdfWorkerBlock: Worker | null = null
let activePdfWorkerVersionBlock: string | null = null

const LARGE_PDF_BYTES_THRESHOLD_BLOCK = 24 * 1024 * 1024
const MIN_SCALE_BLOCK = 0.6
const MAX_SCALE_BLOCK = 2.5
const TRACKPAD_ZOOM_SENSITIVITY_BLOCK = 0.0015
const TRACKPAD_COMMIT_DEBOUNCE_MS_BLOCK = 120
const HIGHLIGHT_COLOR_BLOCK: [number, number, number] = [250, 204, 21]
const HIGHLIGHT_OPACITY_BLOCK = 0.4
const INK_COLOR_BLOCK: [number, number, number] = [220, 38, 38]
const INK_THICKNESS_BLOCK = 1.6
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
}: PdfDocumentBlockProps) {
  const electronRuntime = isElectronRuntimeBlock()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const pinchTouchActiveRef = useRef(false)
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
  const [docProxy, setDocProxy] = useState<PDFDocumentProxy | null>(null)
  const [annotationTool, setAnnotationTool] = useState<PdfAnnotationToolBlock>('none')
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
    setPageNumber(1)
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

  const clearPreviewTransformBlock = () => {
    const previewTarget = previewContainerRef.current
    if (!previewTarget) return
    previewTarget.style.transform = ''
    previewTarget.style.transformOrigin = ''
    previewTarget.style.willChange = ''
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

    /* Scale about the gesture's focal point rather than the top of the page,
       so the content under the fingers/cursor stays put during the preview —
       the post-commit scroll anchor then preserves that same point. */
    const anchor = zoomAnchorRef.current
    const origin = anchor
      ? `${anchor.scrollLeft + anchor.focalX - previewTarget.offsetLeft}px ${anchor.scrollTop + anchor.focalY - previewTarget.offsetTop}px`
      : 'top center'

    previewTarget.style.transform = `scale(${transformScale})`
    previewTarget.style.transformOrigin = origin
    previewTarget.style.willChange = 'transform'
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

    const handleTouchStartBlock = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const distance = readTouchDistanceBlock(event.touches)
      if (!distance || distance <= 0) return

      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }

      const currentInteractiveScale = displayedScaleRef.current
      const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]
      beginZoomGestureBlock(
        (firstTouch.clientX + secondTouch.clientX) / 2,
        (firstTouch.clientY + secondTouch.clientY) / 2,
      )

      pinchTouchActiveRef.current = true
      pinchStartDistanceRef.current = distance
      pinchStartScaleRef.current = currentInteractiveScale

      if (zoomModeRef.current !== 'manual') {
        zoomModeRef.current = 'manual'
        setZoomMode('manual')
        scaleRef.current = currentInteractiveScale
        setScale(currentInteractiveScale)
      }
    }

    const handleTouchMoveBlock = (event: TouchEvent) => {
      if (!pinchTouchActiveRef.current) return
      const distance = readTouchDistanceBlock(event.touches)
      if (!distance || distance <= 0) return

      event.preventDefault()
      const nextScale = normalizeScaleBlock(pinchStartScaleRef.current * (distance / pinchStartDistanceRef.current))
      if (Math.abs((pendingScaleRef.current ?? scaleRef.current) - nextScale) < 0.01) return
      schedulePreviewScaleBlock(nextScale)
    }

    const handleTouchEndBlock = (event: TouchEvent) => {
      if (!pinchTouchActiveRef.current) return
      if (event.touches.length >= 2) return
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
  const pageSampler = useCallback(
    () => (numPages > 0 ? pageNumberRef.current : null),
    [numPages],
  )
  useReadingAttentionBlock(
    countsAsReading ? path : null,
    active && !loading && error === null,
    { pageSampler },
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
  /* Narrower on iOS: every windowed page is a retained bitmap, and WebContent
     dies on a per-process limit rather than degrading (docs/contracts/IOS-MEMORY.md). */
  const renderWindow = useMemo(() => buildPdfRenderedWindowBlock({
    centerPage: pageNumber,
    numPages,
    overscan: isIosSurface ? 1 : undefined,
  }), [isIosSurface, numPages, pageNumber])

  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const scrollToPage = useCallback((page: number) => {
    const el = pageRefs.current.get(page)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  const adjustManualScaleBlock = useCallback((delta: number) => {
    commitManualScaleBlock(displayedScaleRef.current + delta)
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
        adjustManualScaleBlock(0.1)
        return
      }
      if (zoomModifier && event.key === '-') {
        event.preventDefault()
        adjustManualScaleBlock(-0.1)
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
  }, [adjustManualScaleBlock, applyZoomModeBlock, numPages, scrollToPage])

  const {
    annotations,
    addAnnotation,
    undoLastAnnotation,
    saveState: annotationSaveState,
    saveError: annotationSaveError,
  } = usePdfAnnotationsBlock({ doc: docProxy, path, enabled: countsAsReading })

  /* Uncropped geometry per page. Annotations are stored in full-page PDF
     coordinates so that toggling the margin crop never moves an existing mark
     — the crop is a view concern and must not leak into the file. */
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
      color: INK_COLOR_BLOCK,
      opacity: 1,
      thickness: INK_THICKNESS_BLOCK,
    })
  }, [addAnnotation])

  /* Selection -> highlight. Rects are grouped by the page element that
     contains them, so a selection running across a page break produces one
     highlight per page rather than a single annotation with coordinates that
     belong to neither. */
  const highlightSelectionBlock = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    const text = selection.toString().trim()
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1)
    if (rects.length === 0) return

    const quadsByPage = new Map<number, number[]>()
    for (const [page, element] of pageRefs.current) {
      const pageRect = element.getBoundingClientRect()
      const geometry = geometryForBlock(page)

      for (const rect of rects) {
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const inside = centerX >= pageRect.left && centerX <= pageRect.right
          && centerY >= pageRect.top && centerY <= pageRect.bottom
        if (!inside) continue

        const quad = screenRectToQuadPointsBlock({
          left: rect.left - pageRect.left,
          top: rect.top - pageRect.top,
          width: rect.width,
          height: rect.height,
        }, geometry)

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
        color: HIGHLIGHT_COLOR_BLOCK,
        opacity: HIGHLIGHT_OPACITY_BLOCK,
        text,
      })
    }

    selection.removeAllRanges()
  }, [addAnnotation, geometryForBlock])

  /* With the highlight tool active, finishing a selection *is* the highlight —
     no confirm step. The pointerup listener is on the document because the
     gesture routinely ends outside the page box it started in. */
  useEffect(() => {
    if (annotationTool !== 'highlight') return
    const handleUpBlock = () => window.setTimeout(highlightSelectionBlock, 0)
    document.addEventListener('pointerup', handleUpBlock)
    return () => document.removeEventListener('pointerup', handleUpBlock)
  }, [annotationTool, highlightSelectionBlock])

  /* Auto-hiding chrome is a touch-surface behaviour. On desktop the toolbar is
     a persistent affordance next to a mouse, and hiding it there just makes
     controls feel like they moved. */
  const immersiveChrome = isIosSurface
  const { chromeVisible, toggleChrome } = useReaderChromeVisibilityBlock({
    scrollRef: viewportRef,
    enabled: immersiveChrome && !loading && error === null,
  })

  const applyPaperThemeBlock = useCallback((next: PdfPaperThemeBlock) => {
    setPaperTheme(next)
    writePdfPaperThemeBlock(next)
  }, [])

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col bg-card', className)}>
      <div
        className={cn(
          'z-20 flex flex-wrap items-center gap-1 border-b border-border/60 bg-card/95 px-3 py-2 backdrop-blur',
          /* Absolute only while immersive, so the desktop layout keeps the
             toolbar in flow and the page column never sits under it. */
          immersiveChrome && 'absolute inset-x-0 top-0 transition-transform duration-200 ease-out',
          immersiveChrome && !chromeVisible && '-translate-y-full',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoPrev}
          onClick={() => { const p = Math.max(1, pageNumber - 1); setPageNumber(p); scrollToPage(p) }}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[6.5rem] text-center text-xs text-muted-foreground">
          Page {pageNumber}{numPages > 0 ? ` / ${numPages}` : ''}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoNext}
          onClick={() => { const p = numPages > 0 ? Math.min(numPages, pageNumber + 1) : pageNumber; setPageNumber(p); scrollToPage(p) }}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-border/70" />


        <select
          value={paperTheme}
          onChange={(event) => applyPaperThemeBlock(event.target.value as PdfPaperThemeBlock)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          title="Paper tone"
          aria-label="Paper tone"
        >
          {PDF_PAPER_THEMES_BLOCK.map((theme) => (
            <option key={theme} value={theme}>{PDF_PAPER_THEME_LABELS_BLOCK[theme]}</option>
          ))}
        </select>

        <div className="mx-1 h-5 w-px bg-border/70" />

        <Button
          type="button"
          variant={annotationTool === 'highlight' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAnnotationTool((prev) => (prev === 'highlight' ? 'none' : 'highlight'))}
          title="Selecting text marks it. A Pencil always draws, no mode needed."
        >
          <Highlighter className="mr-1 h-3.5 w-3.5" />
          Highlight
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={undoLastAnnotation}
          title="Undo the last unsaved mark"
        >
          <Undo2 className="h-4 w-4" />
        </Button>

        {/* Marks are written into the PDF itself, so save state is not a
            detail to hide — an unwritable file is the one case where a
            reader's marks would otherwise vanish without a word. */}
        {annotationSaveState === 'pending' && (
          <span className="text-[11px] text-muted-foreground">Saving…</span>
        )}
        {annotationSaveState === 'saved' && (
          <span className="text-[11px] text-muted-foreground">Saved to PDF</span>
        )}
        {annotationSaveState === 'unwritable' && (
          <span className="text-[11px] text-destructive" title={annotationSaveError ?? undefined}>
            This PDF can't be written
          </span>
        )}

        {/* Pinch is the zoom on touch; on a pointer surface everything lives
            behind one button that reads the current zoom. */}
        {!immersiveChrome && (
          <>
            <div className="mx-1 h-5 w-px bg-border/70" />
            <PdfZoomMenuBlock
              zoomMode={zoomMode}
              displayedScale={displayedScale}
              onApplyZoomMode={applyZoomModeBlock}
              onAdjustScale={adjustManualScaleBlock}
            />
          </>
        )}
      </div>

      <div
        ref={viewportRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto bg-muted/10 p-3',
          /* The immersive toolbar overlays instead of sitting in flow, so the
             column needs its height back as padding or page 1 opens underneath
             it. Content still scrolls under the bar, which is the point. */
          immersiveChrome && 'pt-16',
        )}
        style={{ touchAction: 'pan-x pan-y' }}
        /* A tap on the page brings the chrome back, the way every native
           reader behaves. Only while immersive — on desktop a click in the
           page is a selection gesture, not a chrome gesture. */
        onClick={immersiveChrome ? toggleChrome : undefined}
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
                  {pageNum >= renderWindow.start && pageNum <= renderWindow.end && docProxy ? (
                    <PdfPageCanvasBlock
                      doc={docProxy}
                      pageNumber={pageNum}
                      displayedWidth={pageBoxForBlock(pageNum).width}
                      displayedHeight={pageBoxForBlock(pageNum).height}
                      displayedScale={pageBoxForBlock(pageNum).scale}
                      plan={rasterPlanForBlock(pageNum)}
                      crop={crop}
                      paperTheme={paperTheme}
                      geometry={geometryForBlock(pageNum)}
                      annotations={annotations}
                      inkColor={INK_COLOR_BLOCK}
                      inkThickness={INK_THICKNESS_BLOCK}
                      onCommitInk={commitInkBlock}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{ minHeight: `${pageHeightForBlock(pageNum)}px` }}
                      className="flex items-center justify-center rounded-md border border-dashed bg-background/70 text-xs text-muted-foreground shadow-sm"
                    >
                      Page {pageNum}
                    </div>
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

      {immersiveChrome && !loading && !error && (
        <PdfPageScrubberBlock
          pageNumber={pageNumber}
          numPages={numPages}
          visible={chromeVisible}
          onSeek={(page) => { setPageNumber(page); scrollToPage(page) }}
        />
      )}
    </div>
  )
}
