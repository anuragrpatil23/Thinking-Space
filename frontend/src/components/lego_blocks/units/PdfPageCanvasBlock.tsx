import { useEffect, useRef } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfRasterPlanBlock } from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
import { pdfRasterPlanKeyBlock } from '@/services/lego_blocks/units/pdfRasterBudgetBlock'
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
import PdfAnnotationOverlayBlock, {
  type PdfAnnotationToolBlock,
} from '@/components/lego_blocks/units/PdfAnnotationOverlayBlock'
import type {
  PdfAnnotationDraftBlock,
  PdfPageGeometryBlock,
  PointBlock,
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
  /** Uncropped page box in PDF units, for annotation coordinate conversion. */
  geometry?: PdfPageGeometryBlock
  annotations?: readonly PdfAnnotationDraftBlock[]
  annotationTool?: PdfAnnotationToolBlock
  inkColor?: [number, number, number]
  inkThickness?: number
  onCommitInk?: (pageNumber: number, strokePdfPoints: PointBlock[]) => void
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
  geometry,
  annotations,
  annotationTool = 'none',
  inkColor = [250, 204, 21],
  inkThickness = 2,
  onCommitInk,
}: PdfPageCanvasBlockProps) {
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

    let cancelled = false
    let renderTask: { cancel: () => void } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        /* Cropping is expressed as a viewport offset rather than by drawing a
           sub-rectangle: pdf.js then rasters only the region we keep, so a
           heavily cropped page costs proportionally less to render. */
        const rasterScale = plan.rasterScale * plan.outputScale
        const viewport = page.getViewport({
          scale: rasterScale,
          offsetX: -crop.left * rasterScale,
          offsetY: -crop.top * rasterScale,
        })

        /* Render into a detached canvas. The one already on screen keeps its
           pixels until this resolves, which is what removes the blank frame. */
        const canvas = document.createElement('canvas')
        canvas.width = plan.canvasWidth
        canvas.height = plan.canvasHeight
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
      } catch (error) {
        if (!isRenderingCancelledBlock(error)) {
          /* A page that will not raster is not worth tearing the viewer down
             for — the placeholder box stays and the rest of the document
             remains readable. */
          console.warn(`PDF page ${pageNumber} failed to render`, error)
        }
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [
    doc, pageNumber, planKey, cropKey, paperTheme,
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
      className={cn('relative overflow-hidden rounded-md border bg-background shadow-sm', className)}
      style={{
        width: `${displayedWidth}px`,
        height: `${displayedHeight}px`,
        background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[paperTheme],
      }}
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
          tool={annotationTool}
          inkColor={inkColor}
          inkThickness={inkThickness}
          onCommitInk={(points) => onCommitInk(pageNumber, points)}
        />
      )}
    </div>
  )
}
