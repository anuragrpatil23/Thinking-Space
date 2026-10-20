import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  classifyPdfLinkTextBlock,
  computePdfCaptionRegionBlock,
  computePdfPeekRegionBlock,
  findPdfFigureMentionsBlock,
  parsePdfCaptionStartBlock,
  parsePdfExplicitDestBlock,
  type PdfCaptionKindBlock,
  type PdfCaptionStyleBlock,
  type PdfLinkKindBlock,
  type PdfPeekRegionBlock,
} from '@/services/lego_blocks/units/pdfLinkTargetBlock'

/* The pdf.js half of link peeking: reading a page's links, finding figure and
   table mentions in papers that were built without links, and resolving
   either to the page and region it points at. The geometry and classification
   decisions live in pdfLinkTargetBlock, where they are tested without a
   document. */

/** Top-down PDF units, relative to the page's view box. */
export interface PdfLinkRectBlock {
  left: number
  top: number
  width: number
  height: number
}

/** A figure/table found by its caption rather than by a link destination. */
export interface PdfCaptionDestBlock {
  caption: PdfCaptionKindBlock
  number: string
}

export type PdfPageLinkBlock =
  | {
    kind: 'internal'
    id: string
    rect: PdfLinkRectBlock
    dest: string | unknown[] | PdfCaptionDestBlock
    text: string
    /** A few characters preceding the link on its line, for "Figure [2]". */
    before?: string
    /** Found in the text, not stored in the file: drawn with a hint underline. */
    detected?: boolean
  }
  | { kind: 'external'; id: string; rect: PdfLinkRectBlock; url: string }

export interface PdfLinkPeekTargetBlock {
  pageNumber: number
  /** Top-down point to jump to. */
  destTop: number | null
  region: PdfPeekRegionBlock
  linkKind: PdfLinkKindBlock
}

interface PageTextItemBlock {
  str: string
  x: number
  /** Top-down baseline. */
  y: number
  width: number
  height: number
}

interface RawTextItemBlock {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

async function pageTextItemsBlock(page: PDFPageProxy): Promise<PageTextItemBlock[]> {
  const [x0, , , y1] = page.view
  const out: PageTextItemBlock[] = []
  for (const raw of (await page.getTextContent()).items as RawTextItemBlock[]) {
    const t = raw.transform
    if (typeof raw.str !== 'string' || !raw.str.trim() || !t) continue
    /* Rotated runs (arXiv's sidebar stamp) are not running text. */
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue
    out.push({
      str: raw.str,
      x: t[4] - x0,
      y: y1 - t[5],
      width: raw.width ?? 0,
      height: raw.height || Math.abs(t[3]) || 10,
    })
  }
  return out
}

/* Character offsets -> horizontal extent within a run. pdf.js gives a run's
   total advance, not per-glyph positions, so this assumes even glyph widths:
   a few points of error, which is fine for a hit box and for picking words. */
function sliceExtentBlock(item: PageTextItemBlock, start: number, end: number): { left: number; width: number } {
  const perChar = item.str.length > 0 ? item.width / item.str.length : 0
  return { left: item.x + start * perChar, width: Math.max(1, (end - start) * perChar) }
}

/* The words under a link, and the few characters just before it on the same
   run. A link usually covers part of a longer run — "see Figure 4). See the
   online…" is one run — so only the overlapped characters are taken;
   matching the whole run is what made "Figure 4" read as an unknown link.
   Both strings are cut at the same offset, so `before + text` reads as the
   original line ("(see Figu" + "re 1)"): a template that links only the
   number of "Figure 1" is classified from that joined tail. */
function textAroundRectBlock(items: readonly PageTextItemBlock[], rect: PdfLinkRectBlock): { text: string; before: string } {
  const parts: string[] = []
  let before = ''
  let leftmost = Infinity
  for (const item of items) {
    if (item.y < rect.top || item.y > rect.top + rect.height + 2) continue
    if (item.x + item.width < rect.left || item.x > rect.left + rect.width) continue
    const perChar = item.str.length > 0 ? item.width / item.str.length : 0
    if (perChar <= 0) continue
    /* One character of slack each side: the even-width estimate drifts, and
       losing the "1" of "Figure 1" costs more than a stray parenthesis. */
    const start = Math.max(0, Math.floor((rect.left - item.x) / perChar) - 1)
    const end = Math.min(item.str.length, Math.ceil((rect.left + rect.width - item.x) / perChar) + 1)
    if (end <= start) continue
    parts.push(item.str.slice(start, end))
    if (item.x < leftmost) {
      leftmost = item.x
      before = item.str.slice(Math.max(0, start - 12), start)
    }
  }
  return { text: parts.join(' ').replace(/\s+/g, ' ').trim(), before }
}

/* The rest of a run's line, for telling a caption from a mention. Only runs
   that continue the line with a word-sized gap count, so the other column's
   text on the same baseline is never mistaken for a caption's title. */
function lineContinuationBlock(items: readonly PageTextItemBlock[], from: PageTextItemBlock): { text: string; right: number } {
  const sameLine = items
    .filter((item) => item !== from && Math.abs(item.y - from.y) < 2 && item.x > from.x)
    .sort((a, b) => a.x - b.x)
  let right = from.x + from.width
  const words: string[] = []
  for (const item of sameLine) {
    if (item.x - right > 15) break
    words.push(item.str)
    right = Math.max(right, item.x + item.width)
  }
  return { text: words.join(' ').trim(), right }
}

/* ---- Caption index ------------------------------------------------------ */

interface CaptionEntryBlock {
  pageNumber: number
  style: PdfCaptionStyleBlock
  top: number
  left: number
  lineRight: number
  pageWidth: number
  pageHeight: number
}

const captionIndexCacheBlock = new WeakMap<PDFDocumentProxy, Promise<Map<string, CaptionEntryBlock>>>()

/** Every figure and table caption in the document, keyed "figure:3". Built
    once per open document, on first need, from the text pdf.js already
    extracts; the first caption for a number wins, so a list of figures at the
    back cannot shadow the real one. */
export function getPdfCaptionIndexBlock(doc: PDFDocumentProxy): Promise<Map<string, CaptionEntryBlock>> {
  const cached = captionIndexCacheBlock.get(doc)
  if (cached) return cached
  const build = (async () => {
    const index = new Map<string, CaptionEntryBlock>()
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const [x0, y0, x1, y1] = page.view
      const items = await pageTextItemsBlock(page)
      for (const item of items) {
        const continuation = lineContinuationBlock(items, item)
        const caption = parsePdfCaptionStartBlock(item.str, continuation.text)
        if (!caption) continue
        const key = `${caption.kind}:${caption.number}`
        if (index.has(key)) continue
        index.set(key, {
          pageNumber,
          style: caption.style,
          top: item.y - item.height,
          left: item.x,
          lineRight: continuation.right,
          pageWidth: x1 - x0,
          pageHeight: y1 - y0,
        })
      }
    }
    return index
  })()
  captionIndexCacheBlock.set(doc, build)
  return build
}

/* ---- Loading a page's links --------------------------------------------- */

export async function loadPdfPageLinksBlock(page: PDFPageProxy): Promise<PdfPageLinkBlock[]> {
  const annotations = await page.getAnnotations({ intent: 'display' })
  const [x0, , , y1] = page.view
  const links: PdfPageLinkBlock[] = []
  let items: PageTextItemBlock[] | null = null

  for (const annotation of annotations as Array<Record<string, unknown>>) {
    if (annotation.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue
    const [ax1, ay1, ax2, ay2] = annotation.rect as number[]
    const rect = {
      left: Math.min(ax1, ax2) - x0,
      top: y1 - Math.max(ay1, ay2),
      width: Math.abs(ax2 - ax1),
      height: Math.abs(ay2 - ay1),
    }
    const id = String(annotation.id ?? `${rect.left}:${rect.top}`)

    const dest = annotation.dest
    if (typeof dest === 'string' || Array.isArray(dest)) {
      if (!items) items = await pageTextItemsBlock(page)
      links.push({ kind: 'internal', id, rect, dest, ...textAroundRectBlock(items, rect) })
      continue
    }
    /* pdf.js has already dropped javascript: and other unsafe schemes from
       `url`; only web links are followed, the same rule openExternalUrlOrch
       enforces again on the way out. */
    if (typeof annotation.url === 'string' && /^https?:\/\//i.test(annotation.url)) {
      links.push({ kind: 'external', id, rect, url: annotation.url })
    }
  }
  return links
}

function overlapsBlock(a: PdfLinkRectBlock, b: PdfLinkRectBlock): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height
}

/** "Fig. 3bc" and "Table 1" in the running text of a page, as links to their
    captions — for papers built without hyperlinks. Only mentions whose
    caption actually exists become links, and none duplicate a real link. */
export async function detectPdfFigureMentionLinksBlock(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  existing: readonly PdfPageLinkBlock[],
): Promise<PdfPageLinkBlock[]> {
  const index = await getPdfCaptionIndexBlock(doc)
  if (index.size === 0) return []
  const items = await pageTextItemsBlock(page)
  const out: PdfPageLinkBlock[] = []
  for (const item of items) {
    /* The caption's own label is not a reference to itself. */
    if (parsePdfCaptionStartBlock(item.str, lineContinuationBlock(items, item).text)) continue
    for (const mention of findPdfFigureMentionsBlock(item.str)) {
      if (!index.has(`${mention.kind}:${mention.number}`)) continue
      const extent = sliceExtentBlock(item, mention.start, mention.end)
      const rect = { left: extent.left, top: item.y - item.height * 0.85, width: extent.width, height: item.height * 1.1 }
      if (existing.some((link) => overlapsBlock(link.rect, rect))) continue
      out.push({
        kind: 'internal',
        id: `detected:${page.pageNumber}:${Math.round(rect.left)}:${Math.round(rect.top)}`,
        rect,
        dest: { caption: mention.kind, number: mention.number },
        text: item.str.slice(mention.start, mention.end),
        detected: true,
      })
    }
  }
  return out
}

/* ---- Resolving a link to a peek ----------------------------------------- */

function captionTargetBlock(entry: CaptionEntryBlock, kind: PdfCaptionKindBlock): PdfLinkPeekTargetBlock {
  return {
    pageNumber: entry.pageNumber,
    destTop: entry.style === 'label-above' ? entry.top : entry.top - entry.pageHeight * 0.45,
    linkKind: kind,
    region: computePdfCaptionRegionBlock({
      style: entry.style,
      pageWidth: entry.pageWidth,
      pageHeight: entry.pageHeight,
      captionTop: entry.top,
      captionLeft: entry.left,
      captionLineRight: entry.lineRight,
    }),
  }
}

function isCaptionDestBlock(dest: unknown): dest is PdfCaptionDestBlock {
  return typeof dest === 'object' && dest !== null && !Array.isArray(dest) && 'caption' in dest
}

export async function resolvePdfLinkPeekTargetBlock(
  doc: PDFDocumentProxy,
  link: Extract<PdfPageLinkBlock, { kind: 'internal' }>,
): Promise<PdfLinkPeekTargetBlock | null> {
  if (isCaptionDestBlock(link.dest)) {
    const entry = (await getPdfCaptionIndexBlock(doc)).get(`${link.dest.caption}:${link.dest.number}`)
    return entry ? captionTargetBlock(entry, link.dest.caption) : null
  }

  const linkKind = classifyPdfLinkTextBlock(link.text, link.before)

  /* A real link to a figure or table: its caption is a better landmark than
     wherever the link happened to land. */
  if (linkKind === 'figure' || linkKind === 'table') {
    const number = /(\d+)/.exec(link.text)?.[1]
    const entry = number ? (await getPdfCaptionIndexBlock(doc)).get(`${linkKind}:${number}`) : undefined
    if (entry) return captionTargetBlock(entry, linkKind)
  }

  const explicit = typeof link.dest === 'string' ? await doc.getDestination(link.dest) : link.dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null

  const ref = explicit[0]
  let pageIndex: number
  /* Most files reference the page object; some write a bare page index. */
  if (typeof ref === 'number') pageIndex = ref
  else if (ref && typeof ref === 'object') pageIndex = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
  else return null
  if (pageIndex < 0 || pageIndex >= doc.numPages) return null

  const page = await doc.getPage(pageIndex + 1)
  const [x0, y0, x1, y1] = page.view
  const point = parsePdfExplicitDestBlock(explicit)
  const destLeft = point.left === null ? null : point.left - x0
  const destTop = point.top === null ? null : y1 - point.top

  const needsColumn = linkKind !== 'figure' && linkKind !== 'table' && destLeft !== null
  const textItems = needsColumn ? await pageTextItemsBlock(page) : []

  return {
    pageNumber: pageIndex + 1,
    destTop,
    linkKind,
    region: computePdfPeekRegionBlock({
      kind: linkKind,
      pageWidth: x1 - x0,
      pageHeight: y1 - y0,
      destLeft,
      destTop,
      textItems,
    }),
  }
}
