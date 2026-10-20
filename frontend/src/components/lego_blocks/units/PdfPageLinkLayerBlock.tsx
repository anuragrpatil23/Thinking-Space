import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cn } from '@/lib/utils'
import type { PdfCropBoxBlock } from '@/services/lego_blocks/units/pdfMarginCropBlock'
import {
  detectPdfFigureMentionLinksBlock,
  loadPdfPageLinksBlock,
  type PdfPageLinkBlock,
} from '@/components/lego_blocks/units/pdfPageLinksBlock'

/* The page's link annotations as hit targets over the text layer.

   pdf.js draws a link's border into the bitmap at most; following it, or
   showing where it goes, is the viewer's job. These boxes are invisible —
   the blue citation text is already on the page — and only change the cursor.

   They sit above the text layer, as pdf.js's own annotation layer does, so a
   drag that starts exactly on a citation hits the link rather than selecting.
   A pen stroke that starts on one still draws: the pointer events bubble to
   the page, and a pen click is not treated as a follow. */
export interface PdfLinkPointerBlock {
  link: PdfPageLinkBlock
  anchor: DOMRect
  pointerType: string
}

export default function PdfPageLinkLayerBlock({
  doc,
  pageNumber,
  displayedScale,
  crop,
  onEnter,
  onLeave,
  onActivate,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  displayedScale: number
  crop: PdfCropBoxBlock
  onEnter: (event: PdfLinkPointerBlock) => void
  onLeave: () => void
  onActivate: (event: PdfLinkPointerBlock) => void
}) {
  const [links, setLinks] = useState<PdfPageLinkBlock[]>([])
  const pointerTypeRef = useRef('mouse')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        const loaded = await loadPdfPageLinksBlock(page)
        if (cancelled) return
        setLinks(loaded)
        /* Second pass: figure and table mentions the file never linked. It
           waits on the document's caption index, so the real links above
           are live first. */
        const detected = await detectPdfFigureMentionLinksBlock(doc, page, loaded)
        if (!cancelled && detected.length > 0) setLinks([...loaded, ...detected])
      } catch {
        /* Links are a convenience; the page still reads without them. */
      }
    })()
    return () => { cancelled = true }
  }, [doc, pageNumber])

  if (links.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {links.map((link) => (
        <span
          key={link.id}
          role="link"
          tabIndex={-1}
          title={link.kind === 'external' ? link.url : undefined}
          className={cn(
            'pointer-events-auto absolute cursor-pointer',
            /* A found reference looks like plain text, so it gets a faint
               dotted underline; a real link is already blue on the page. */
            link.kind === 'internal' && link.detected && 'border-b border-dotted border-sky-600/50 dark:border-sky-400/50',
          )}
          style={{
            left: `${(link.rect.left - crop.left) * displayedScale}px`,
            top: `${(link.rect.top - crop.top) * displayedScale}px`,
            width: `${link.rect.width * displayedScale}px`,
            height: `${link.rect.height * displayedScale}px`,
          }}
          onPointerDown={(event) => { pointerTypeRef.current = event.pointerType }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return
            onEnter({ link, anchor: event.currentTarget.getBoundingClientRect(), pointerType: 'mouse' })
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') onLeave()
          }}
          onClick={(event) => {
            const pointerType = pointerTypeRef.current
            pointerTypeRef.current = 'mouse'
            if (pointerType === 'pen') return
            event.preventDefault()
            event.stopPropagation()
            onActivate({ link, anchor: event.currentTarget.getBoundingClientRect(), pointerType })
          }}
        />
      ))}
    </div>
  )
}
