import { useEffect, useState } from 'react'
import type { PdfNaturalPageMetricsBlock } from '@/services/lego_blocks/units/pdfViewportBlock'

/* Measures every page's natural box so placeholder heights are per-page.

   Estimating all pages from page 1 makes the scrollbar lie on any document
   that mixes paper sizes or orientations, and the resulting jump-on-render is
   the single most obvious way this viewer fails to feel like Preview.

   The walk is chunked onto idle callbacks rather than awaited during load:
   a serial getPage() pass over a few hundred pages is slow enough to stall
   first paint, and the estimate is usable from page 1 alone in the meantime. */

interface PdfPageProxyLikeBlock {
  getViewport(params: { scale: number }): { width: number; height: number }
  cleanup?: () => void
}

export interface PdfDocumentProxyLikeBlock {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxyLikeBlock>
}

const MEASURE_CHUNK_SIZE_BLOCK = 24

/* Past this point the per-page win stops paying for the retained pdf.js page
   proxies. Unmeasured pages fall back to page 1, which is what the viewer did
   for every page before. */
const MAX_EAGER_MEASURE_PAGES_BLOCK = 600

export interface PdfPageMetricsStateBlock {
  metricsByPage: ReadonlyMap<number, PdfNaturalPageMetricsBlock>
  fallbackMetrics: PdfNaturalPageMetricsBlock | null
}

const EMPTY_STATE_BLOCK: PdfPageMetricsStateBlock = {
  metricsByPage: new Map(),
  fallbackMetrics: null,
}

function scheduleIdleBlock(run: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 500 })
    return () => window.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(run, 16)
  return () => window.clearTimeout(handle)
}

export function usePdfPageMetricsBlock(
  doc: PdfDocumentProxyLikeBlock | null,
): PdfPageMetricsStateBlock {
  const [state, setState] = useState<PdfPageMetricsStateBlock>(EMPTY_STATE_BLOCK)

  useEffect(() => {
    if (!doc) {
      setState(EMPTY_STATE_BLOCK)
      return
    }

    let cancelled = false
    let cancelScheduled: (() => void) | null = null
    const measured = new Map<number, PdfNaturalPageMetricsBlock>()
    const lastPage = Math.min(doc.numPages, MAX_EAGER_MEASURE_PAGES_BLOCK)

    const measurePageBlock = async (pageNumber: number) => {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      measured.set(pageNumber, { width: viewport.width, height: viewport.height })
      /* Release raster resources; we only ever wanted the box. */
      page.cleanup?.()
    }

    const runChunkBlock = (startPage: number) => {
      if (cancelled) return

      const endPage = Math.min(startPage + MEASURE_CHUNK_SIZE_BLOCK - 1, lastPage)
      const pages: number[] = []
      for (let page = startPage; page <= endPage; page += 1) pages.push(page)

      void Promise.all(pages.map((page) => measurePageBlock(page).catch(() => undefined)))
        .then(() => {
          if (cancelled) return

          setState({
            metricsByPage: new Map(measured),
            fallbackMetrics: measured.get(1) ?? null,
          })

          if (endPage < lastPage) {
            cancelScheduled = scheduleIdleBlock(() => runChunkBlock(endPage + 1))
          }
        })
    }

    /* Page 1 first and on its own, so the fallback estimate lands immediately
       rather than after the first full chunk resolves. */
    void measurePageBlock(1)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return
        setState({
          metricsByPage: new Map(measured),
          fallbackMetrics: measured.get(1) ?? null,
        })
        if (lastPage > 1) {
          cancelScheduled = scheduleIdleBlock(() => runChunkBlock(2))
        }
      })

    return () => {
      cancelled = true
      cancelScheduled?.()
    }
  }, [doc])

  return state
}
