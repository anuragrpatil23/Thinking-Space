import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  computePdfCropBoxBlock,
  EMPTY_PDF_CROP_BOX_BLOCK,
  mergePdfCropBoxesBlock,
  readPdfTextItemBoxBlock,
  selectPdfCropSamplePagesBlock,
  type PdfCropBoxBlock,
  type PdfTextItemBoxBlock,
} from '@/services/lego_blocks/units/pdfMarginCropBlock'

/* Measures a document-wide margin crop from a sample of pages.

   Runs on idle for the same reason the page-metrics walk does: `getTextContent`
   on a spread of pages is slow enough to be felt during first paint, and the
   viewer is perfectly usable uncropped in the meantime. The crop then lands as
   a single layout change rather than trickling in page by page. */
export function usePdfMarginCropBlock(
  doc: PDFDocumentProxy | null,
  enabled: boolean,
): PdfCropBoxBlock {
  const [crop, setCrop] = useState<PdfCropBoxBlock>(EMPTY_PDF_CROP_BOX_BLOCK)

  useEffect(() => {
    if (!doc || !enabled) {
      setCrop(EMPTY_PDF_CROP_BOX_BLOCK)
      return
    }

    let cancelled = false
    let idleHandle: number | null = null

    const measureBlock = async () => {
      const pages = selectPdfCropSamplePagesBlock(doc.numPages)
      const boxes: PdfCropBoxBlock[] = []

      for (const pageNumber of pages) {
        if (cancelled) return
        try {
          const page = await doc.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })
          const textContent = await page.getTextContent()

          const itemBoxes: PdfTextItemBoxBlock[] = []
          for (const item of textContent.items) {
            const box = readPdfTextItemBoxBlock(item as Parameters<typeof readPdfTextItemBoxBlock>[0])
            if (box) itemBoxes.push(box)
          }

          /* A page with almost no text — a plate, a part title — would drag the
             union out to the full sheet and defeat the crop entirely. */
          if (itemBoxes.length < 8) continue

          boxes.push(computePdfCropBoxBlock({
            itemBoxes,
            pageMetrics: { width: viewport.width, height: viewport.height },
          }))
        } catch {
          /* One unreadable page should not cost the whole document its crop. */
        }
      }

      if (!cancelled) setCrop(mergePdfCropBoxesBlock(boxes))
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => { void measureBlock() }, { timeout: 2000 })
    } else {
      idleHandle = window.setTimeout(() => { void measureBlock() }, 32)
    }

    return () => {
      cancelled = true
      if (idleHandle === null) return
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
    }
  }, [doc, enabled])

  return crop
}
