import { useCallback, useEffect, useRef } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfRasterPlanBlock } from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
import {
  derivePdfPreviewPlanBlock,
  pdfRasterPlanKeyBlock,
} from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
import {
  EMPTY_PDF_CROP_BOX_BLOCK,
  type PdfCropBoxBlock,
} from '@/services/lego_blocks/units/pdfMarginCropBlock'
import {
  applyPdfPaperThemeToImageDataBlock,
  PDF_PAPER_THEME_BACKGROUNDS_BLOCK,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'
import { cn } from '@/lib/utils'
import PdfAnnotationOverlayBlock from '@/components/lego_blocks/units/PdfAnnotationOverlayBlock'
import { usePenInkCaptureBlock } from '@/components/lego_blocks/hooks/units/usePenInkCaptureBlock'
import {
  strokeToSvgPathBlock,
  type PdfAnnotationDraftBlock,
  type PdfPageGeometryBlock,
  type PointBlock,
} from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'
import './pdfTextLayerBlock.css'

/* One rendered PDF page, with the bitmap decoupled from the layout box.

   The host div carries the layout size (`naturalMetrics * displayedScale`) and
   the canvas inside it is always `width: 100%; height: 100%`. So when zoom
   changes, React restyles one div and the existing bitmap is stretched into
   the new box by the compositor — instantly, and with correct geometry. The
   re-raster then lands asynchronously and swaps a sharp bitmap into the same
   box. Nothing jumps, because the box was never waiting on the bitmap.

   This is what react-pdf's `<Page scale>` could not do: it drove the canvas
   backing store from a React prop, so every scale change tore down the canvas,
   the text layer, and the annotation layer for every page in the render window
   and left a blank frame in between.

   The text layer is built exactly once per page. pdf.js emits span positions as
   `calc(var(--total-scale-factor) * Npx)`, so setting that variable on the
   container rescales every span in CSS with no JS and no rebuild. Building it
   against a scale-1 viewport makes the convention self-consistent: at scale 1
   "scaled px" and "unscaled px" are the same number, so the variable is the
   only scaling applied. */

interface PdfPageCanvasBlockProps {
  doc: PDFDocumentProxy
  pageNumber: number
  /** Layout box in CSS pixels — `naturalMetrics * displayedScale`. */
  displayedWidth: number
  displayedHeight: number
  /** CSS pixels per PDF unit, for the text layer's scale variable. */
  displayedScale: number
  plan: PdfRasterPlanBlock
  /** Margins to trim, in PDF units. The layout box is already cropped space. */
  crop?: PdfCropBoxBlock
  paperTheme?: PdfPaperThemeBlock
  enableTextLayer?: boolean
  className?: string
  /** While a zoom gesture is in flight, hold the existing bitmap. */
  deferRaster?: boolean
  /** The page the reader is actually on. It skips the queue. */
  isPrimary?: boolean
  penTool?: 'pen' | 'highlighter'
  onCommitHighlight?: (pageNumber: number, rects: DOMRect[], text: string) => void
  /** Uncropped page box in PDF units, for annotation coordinate conversion. */
  geometry?: PdfPageGeometryBlock
  annotations?: readonly PdfAnnotationDraftBlock[]
  inkColor?: [number, number, number]
  inkThickness?: number
  onCommitInk?: (pageNumber: number, strokePdfPoints: PointBlock[]) => void
}

/* Page rasters run one at a time, process-wide.

   pdf.js draws on the main thread, so three windowed pages re-rastering
   together after a zoom commit is three multi-megapixel canvas jobs racing for
   it — which reads as a freeze right after every zoom. Serializing does not
   make the total work smaller, but it keeps each job short enough that input
   and scrolling stay responsive between them. */
let rasterQueueBlock: Promise<void> = Promise.resolve()

function enqueueRasterBlock(job: () => Promise<void>): Promise<void> {
  const next = rasterQueueBlock.then(job, job)
  rasterQueueBlock = next.catch(() => undefined)
  return next
}

/* A cancelled render rejects; that is the normal path when the user keeps
   zooming, not an error worth surfacing. */
function isRenderingCancelledBlock(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

export default function PdfPageCanvasBlock({
  doc,
  pageNumber,
  displayedWidth,
  displayedHeight,
  displayedScale,
  plan,
  crop = EMPTY_PDF_CROP_BOX_BLOCK,
  paperTheme = 'original',
  enableTextLayer = true,
  className,
  deferRaster = false,
  isPrimary = false,
  penTool = 'pen',
  onCommitHighlight,
  geometry,
  annotations,
  inkColor = [250, 204, 21],
  inkThickness = 2,
  onCommitInk,
}: PdfPageCanvasBlockProps) {
  const livePathRef = useRef<SVGPathElement | null>(null)

  /* The in-flight stroke is written straight onto the path element. A React
     state update per pointer sample would cap the stroke at the render rate
     rather than the pen's sample rate. */
  const paintLiveStrokeBlock = useCallback((points: readonly { x: number; y: number }[]) => {
    const path = livePathRef.current
    if (!path) return
    if (points.length === 0) {
      path.removeAttribute('d')
      return
    }
    path.setAttribute('d', strokeToSvgPathBlock(points))
  }, [])

  const penHandlers = usePenInkCaptureBlock({
    geometry,
    enabled: Boolean(geometry && onCommitInk),
    tool: penTool,
    onPaint: paintLiveStrokeBlock,
    onCommit: (points) => onCommitInk?.(pageNumber, points),
    onCommitHighlight: (rects, text) => onCommitHighlight?.(pageNumber, rects, text),
  })

  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const textHostRef = useRef<HTMLDivElement | null>(null)
  const planKey = pdfRasterPlanKeyBlock(plan)
  const cropKey = `${crop.left}:${crop.top}:${crop.right}:${crop.bottom}`

  /* Raster. Keyed on the bitmap size rather than on the scale, so a pinch that
     stays inside one rung of the quantization ladder never cancels an
     in-flight render or schedules a redundant one. */
  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) return
    /* Rastering mid-gesture is the worst possible time: pdf.js draws on the
       main thread, so a multi-megapixel page render competes with the very
       frames the pinch needs. The stale bitmap is already being scaled by the
       compositor and looks correct; this just waits for the gesture to end. */
    if (deferRaster) return

    let cancelled = false
    let renderTask: { cancel: () => void } | null = null

    /* The page in front of the reader never waits behind its neighbours.
       Serializing every page equally meant the one being looked at could sit
       third in line behind two off-screen ones, which is most of why the
       viewer felt slow to draw. Overscan pages still queue. */
    const drawPassBlock = async (
      page: Awaited<ReturnType<typeof doc.getPage>>,
      passPlan: typeof plan,
    ) => {
      /* Cropping is expressed as a viewport offset rather than by drawing a
         sub-rectangle: pdf.js then rasters only the region we keep, so a
         heavily cropped page costs proportionally less to render. */
      const rasterScale = passPlan.rasterScale * passPlan.outputScale
      const viewport = page.getViewport({
        scale: rasterScale,
        offsetX: -crop.left * rasterScale,
        offsetY: -crop.top * rasterScale,
      })

      /* Render into a detached canvas. The one already on screen keeps its
         pixels until this resolves, which is what removes the blank frame. */
      const canvas = document.createElement('canvas')
      canvas.width = passPlan.canvasWidth
      canvas.height = passPlan.canvasHeight
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'

      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return

      const task = page.render({ canvas, canvasContext: context, viewport })
      renderTask = task
      await task.promise
      if (cancelled) return

      /* One pass over the bitmap, not a CSS filter on a live canvas — see the
         header of pdfPaperThemeBlock for why that distinction is load-bearing
         on iOS. */
      if (paperTheme !== 'original') {
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        applyPdfPaperThemeToImageDataBlock(image.data, paperTheme)
        context.putImageData(image, 0, 0)
      }

      host.replaceChildren(canvas)
    }

    const runBlock = async () => {
      try {
        if (cancelled) return
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        /* Two passes, because a full-resolution page is hundreds of
           milliseconds of blocked main thread and the reader should not stare
           at nothing for that long. The cheap pass is a quarter of the work and
           lands almost immediately, upscaled by CSS into the same box; the
           sharp pass then replaces it in place. Yielding between them lets the
           frame with the cheap bitmap actually get painted. */
        const previewPlan = derivePdfPreviewPlanBlock(plan)
        if (previewPlan) {
          await drawPassBlock(page, previewPlan)
          if (cancelled) return
          await new Promise((resolve) => window.requestAnimationFrame(resolve))
          if (cancelled) return
        }

        await drawPassBlock(page, plan)
      } catch (error) {
        if (!isRenderingCancelledBlock(error)) {
          /* A page that will not raster is not worth tearing the viewer down
             for — the placeholder box stays and the rest of the document
             remains readable. */
          console.warn(`PDF page ${pageNumber} failed to render`, error)
        }
      }
    }

    if (isPrimary) void runBlock()
    else void enqueueRasterBlock(runBlock)

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [
    deferRaster, isPrimary, doc, pageNumber, planKey, cropKey, paperTheme,
    crop.left, crop.top, plan.canvasHeight, plan.canvasWidth, plan.outputScale, plan.rasterScale,
  ])

  /* Text layer, built once per page and rescaled by CSS variable thereafter. */
  useEffect(() => {
    const host = textHostRef.current
    if (!host || !enableTextLayer) return

    let cancelled = false
    let layer: { cancel: () => void } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const textLayer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: host,
          viewport: page.getViewport({ scale: 1 }),
        })
        if (cancelled) return

        layer = textLayer
        await textLayer.render()
      } catch {
        /* Selection is a convenience; a page whose text layer fails is still
           readable, so this stays silent. */
      }
    })()

    return () => {
      cancelled = true
      layer?.cancel()
      host.replaceChildren()
    }
  }, [doc, pageNumber, enableTextLayer])

  return (
    <div
      /* Matched to Preview, from a side-by-side reference:

         - **No border.** The sheet is defined by its shadow alone. A drawn
           outline is the thing that makes a page look like a UI card.
         - **Square corners.** Preview never rounds a page; a rounded corner
           reads as a card rather than as paper.
         - A soft, low shadow spread around the sheet rather than a tight drop. */
      className={cn(
        'relative overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.20)]',
        'dark:shadow-[0_1px_6px_rgba(0,0,0,0.6)]',
        className,
      )}
      style={{
        width: `${displayedWidth}px`,
        height: `${displayedHeight}px`,
        background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[paperTheme],
        /* Let a pen event reach onPointerDown instead of being consumed as a
           scroll gesture; touch still pans, which is what keeps finger-scroll
           working while the pen draws. */
        touchAction: 'pan-x pan-y',
      }}
      {...penHandlers}
    >
      <div ref={canvasHostRef} className="h-full w-full" />
      {enableTextLayer && (
        /* pdf.js lays spans out in full-page coordinates, so under a crop the
           layer is positioned at negative offsets and clipped by the parent
           rather than being rebuilt in cropped space. */
        <div
          ref={textHostRef}
          className="textLayer"
          style={{
            ['--total-scale-factor' as string]: `${displayedScale}`,
            inset: 'auto',
            left: `${-crop.left * displayedScale}px`,
            top: `${-crop.top * displayedScale}px`,
            width: `${displayedWidth + (crop.left + crop.right) * displayedScale}px`,
            height: `${displayedHeight + (crop.top + crop.bottom) * displayedScale}px`,
          }}
        />
      )}

      {geometry && annotations && onCommitInk && (
        <PdfAnnotationOverlayBlock
          pageNumber={pageNumber}
          geometry={geometry}
          displayedWidth={displayedWidth}
          displayedHeight={displayedHeight}
          annotations={annotations}
          inkColor={inkColor}
          inkThickness={inkThickness}
          livePathRef={livePathRef}
        />
      )}
    </div>
  )
}
