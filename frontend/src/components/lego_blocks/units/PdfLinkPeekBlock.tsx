import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfLinkPeekTargetBlock } from '@/components/lego_blocks/units/pdfPageLinksBlock'
import {
  applyPdfPaperThemeToImageDataBlock,
  PDF_PAPER_THEME_BACKGROUNDS_BLOCK,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'
import { cn } from '@/lib/utils'

/* A card showing what a link points at, drawn from the PDF itself.

   It is a crop of the destination page, not extracted text: a reference
   entry, a figure, a table or an equation all read correctly as pixels, and
   the reader sees exactly what they would see after jumping. Only the crop is
   rasterised — a canvas the size of the card, not of the page — so a peek
   costs a few hundred kilobytes rather than a page-sized bitmap
   (docs/contracts/IOS-MEMORY.md). The paper tone is applied the same way the
   pages get it, as a pixel pass, never a CSS filter. */

const CARD_PADDING_PX_BLOCK = 8
const FOOTER_PX_BLOCK = 30
const MAX_CANVAS_SIDE_PX_BLOCK = 2048
const KIND_LABELS_BLOCK: Record<PdfLinkPeekTargetBlock['linkKind'], string> = {
  citation: 'Reference',
  figure: 'Figure',
  table: 'Table',
  equation: 'Equation',
  section: 'Section',
  other: 'Link',
}

export default function PdfLinkPeekBlock({
  doc,
  target,
  anchor,
  paperTheme,
  touch,
  onGo,
  onPointerEnter,
  onPointerLeave,
}: {
  doc: PDFDocumentProxy
  target: PdfLinkPeekTargetBlock
  anchor: DOMRect
  paperTheme: PdfPaperThemeBlock
  /** Opened by a tap: there is no hover to leave, so the card carries the jump. */
  touch: boolean
  onGo: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  const wide = target.linkKind === 'figure' || target.linkKind === 'table'
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const cardW = Math.min(wide ? 560 : 440, viewportW - 24)
  const innerW = cardW - CARD_PADDING_PX_BLOCK * 2
  const maxInnerH = Math.min(wide ? 520 : 320, viewportH * 0.6)
  const { region } = target
  /* Fit the crop to the card's width, then shrink if that makes it too tall. */
  const cssScale = Math.min(innerW / region.width, maxInnerH / region.height)
  const imageW = Math.round(region.width * cssScale)
  const imageH = Math.round(region.height * cssScale)
  const cardH = imageH + CARD_PADDING_PX_BLOCK * 2 + FOOTER_PX_BLOCK

  const below = anchor.bottom + 8 + cardH <= viewportH - 12 || anchor.top - 8 - cardH < 12
  const top = below ? anchor.bottom + 8 : anchor.top - 8 - cardH
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - cardW / 2, viewportW - cardW - 12))

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let task: { cancel: () => void } | null = null

    void (async () => {
      try {
        const page = await doc.getPage(target.pageNumber)
        if (cancelled) return
        const dpr = window.devicePixelRatio || 1
        const rasterScale = Math.min(
          cssScale * dpr,
          MAX_CANVAS_SIDE_PX_BLOCK / Math.max(region.width, region.height),
        )
        const viewport = page.getViewport({
          scale: rasterScale,
          offsetX: -region.x * rasterScale,
          offsetY: -region.y * rasterScale,
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(region.width * rasterScale))
        canvas.height = Math.max(1, Math.ceil(region.height * rasterScale))
        canvas.style.display = 'block'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return

        const render = page.render({ canvas, canvasContext: context, viewport })
        task = render
        await render.promise
        if (cancelled) return

        if (paperTheme !== 'original') {
          const image = context.getImageData(0, 0, canvas.width, canvas.height)
          applyPdfPaperThemeToImageDataBlock(image.data, paperTheme)
          context.putImageData(image, 0, 0)
        }
        host.replaceChildren(canvas)
      } catch {
        /* A peek that cannot render leaves the blank sheet; the link still
           jumps. */
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [cssScale, doc, paperTheme, region.height, region.width, region.x, region.y, target.pageNumber])

  return createPortal(
    <div
      role="dialog"
      data-pdf-link-peek=""
      aria-label={`${KIND_LABELS_BLOCK[target.linkKind]} on page ${target.pageNumber}`}
      className={cn(
        'fixed z-[85] rounded-xl border border-border/70 bg-background/95 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl',
        'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
        shown ? 'translate-y-0 opacity-100' : (below ? '-translate-y-1 opacity-0' : 'translate-y-1 opacity-0'),
      )}
      style={{ left, top, width: cardW, padding: CARD_PADDING_PX_BLOCK }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        ref={hostRef}
        className="mx-auto overflow-hidden rounded-md ring-1 ring-inset ring-black/5 dark:ring-white/10"
        style={{ width: imageW, height: imageH, background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[paperTheme] }}
      />
      <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-muted-foreground" style={{ height: FOOTER_PX_BLOCK }}>
        <span>
          <span className="font-medium text-foreground/80">{KIND_LABELS_BLOCK[target.linkKind]}</span>
          {' · '}page {target.pageNumber}
        </span>
        {touch ? (
          <button
            type="button"
            onClick={onGo}
            className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted/70"
          >
            Go to page
          </button>
        ) : (
          <span>Click to jump</span>
        )}
      </div>
    </div>,
    document.body,
  )
}
