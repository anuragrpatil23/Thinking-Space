import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  pickPdfChapterStartsBlock,
  type PdfChapterStartBlock,
  type PdfOutlineEntryBlock,
} from '@/services/lego_blocks/units/pdfChapterProgressBlock'

/* Reads the PDF's outline once per document and resolves each bookmark to a
   page, for the "pages left in chapter" readout.

   Every bookmark costs a round trip to the pdf.js worker, so the walk stops at
   the levels a chapter can live on and at a fixed number of entries; a
   reference manual with ten thousand bookmarks would otherwise queue that many
   messages behind the page renders. A file with no outline, or one that fails
   to resolve, yields no chapters and the readout stays hidden. */

const MAX_OUTLINE_DEPTH_BLOCK = 2
const MAX_OUTLINE_ENTRIES_BLOCK = 1500

type PdfOutlineNodeBlock = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

async function resolveOutlinePageBlock(doc: PDFDocumentProxy, dest: PdfOutlineNodeBlock['dest']): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const ref = explicit[0]
  /* Most files reference the page object; some write a bare page index. */
  if (typeof ref === 'number') return ref + 1
  if (ref && typeof ref === 'object') {
    return (await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
  }
  return null
}

async function readOutlineEntriesBlock(doc: PDFDocumentProxy): Promise<PdfOutlineEntryBlock[]> {
  const outline = await doc.getOutline()
  if (!outline) return []
  const flat: Array<{ node: PdfOutlineNodeBlock; depth: number }> = []
  const walk = (nodes: PdfOutlineNodeBlock[], depth: number) => {
    for (const node of nodes) {
      if (flat.length >= MAX_OUTLINE_ENTRIES_BLOCK) return
      flat.push({ node, depth })
      if (depth < MAX_OUTLINE_DEPTH_BLOCK && node.items?.length) walk(node.items, depth + 1)
    }
  }
  walk(outline, 0)

  const entries: PdfOutlineEntryBlock[] = []
  for (const { node, depth } of flat) {
    /* One broken bookmark must not cost the reader every other chapter. */
    const page = await resolveOutlinePageBlock(doc, node.dest).catch(() => null)
    if (page !== null) entries.push({ title: node.title ?? '', page, depth })
  }
  return entries
}

export function usePdfChapterStartsBlock(doc: PDFDocumentProxy | null): PdfChapterStartBlock[] {
  const [starts, setStarts] = useState<PdfChapterStartBlock[]>([])

  useEffect(() => {
    setStarts([])
    if (!doc) return
    let cancelled = false
    readOutlineEntriesBlock(doc)
      .then((entries) => {
        if (!cancelled) setStarts(pickPdfChapterStartsBlock(entries, doc.numPages))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [doc])

  return starts
}
