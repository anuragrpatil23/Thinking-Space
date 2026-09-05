// Which pages of a PDF the attention went to.
//
// The third `where` shape, and the easiest of the three. A markdown block moves
// when you edit around it, so attention has to be re-anchored by content
// (inkAnchorBlock). A canvas element moves when you drag it, so a station
// stores the rect it observed and treats element ids as a drift hint. A PDF
// page does neither: page 47 is page 47 for the life of the file. The address
// is stable, discrete, and already what a person would say out loud — "I spent
// the evening on chapter 3" — so nothing has to be derived to make it legible.
//
// Which page you are on is not computed here. PdfDocumentBlock already tracks
// it with an IntersectionObserver over the page elements, picking the topmost
// intersecting one; this consumes that number and does the accounting, using
// the same credit primitive as the document total so the two cannot disagree.

import {
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  type ReadingAttentionStateBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'

export interface PdfPageDwellBlock {
  /** 1-based page number, as the viewer and the reader both count them. */
  page: number
  /** Attention credited while this page was the one being read, ms. */
  activeMs: number
}

export interface PdfAttentionStateBlock {
  /** Pages already left, in visit order. A page revisited appears twice —
   *  coming back to page 12 three times is a different fact from sitting on it
   *  once, and collapsing them at capture would throw that away. */
  closed: PdfPageDwellBlock[]
  current: { page: number; attention: ReadingAttentionStateBlock } | null
  /** Sitting start, until the first page opens and inherits it — the document
   *  takes a moment to load, and that time belongs to the first page rather
   *  than to nothing. Same anchoring the canvas needed. */
  pendingSinceMs: number | null
  /** Deepest page reached. Answers "did I finish it" without walking dwells. */
  maxPage: number
}

export function createPdfAttentionBlock(sinceMs: number | null): PdfAttentionStateBlock {
  return { closed: [], current: null, pendingSinceMs: sinceMs, maxPage: 0 }
}

function closeCurrent(state: PdfAttentionStateBlock, nowMs: number): PdfPageDwellBlock[] {
  if (!state.current) return state.closed
  const credited = creditReadingAttentionBlock(state.current.attention, nowMs)
  return [...state.closed, { page: state.current.page, activeMs: credited.creditedMs }]
}

/**
 * Credit the page being read and, if the reader has moved to another one,
 * close it and open the next.
 *
 * Crediting happens before the switch, so time up to the moment of turning the
 * page belongs to the page you were on. That is what keeps the dwells summing
 * to the document's own attention total.
 */
export function observePdfPageBlock(
  state: PdfAttentionStateBlock,
  page: number | null,
  nowMs: number,
): PdfAttentionStateBlock {
  if (page === null || !Number.isFinite(page) || page < 1 || !Number.isFinite(nowMs)) {
    return state
  }
  const maxPage = Math.max(state.maxPage, page)

  if (!state.current) {
    const from = state.pendingSinceMs ?? nowMs
    return {
      closed: state.closed,
      current: { page, attention: createReadingAttentionBlock(from) },
      pendingSinceMs: null,
      maxPage,
    }
  }

  if (state.current.page === page) {
    return {
      closed: state.closed,
      current: {
        page,
        attention: creditReadingAttentionBlock(state.current.attention, nowMs),
      },
      pendingSinceMs: null,
      maxPage,
    }
  }

  return {
    closed: closeCurrent(state, nowMs),
    current: { page, attention: createReadingAttentionBlock(nowMs) },
    pendingSinceMs: null,
    maxPage,
  }
}

/** Credit the current page for a signal that is presence but not a page turn. */
export function creditPdfAttentionBlock(
  state: PdfAttentionStateBlock,
  nowMs: number,
): PdfAttentionStateBlock {
  if (!state.current || !Number.isFinite(nowMs)) return state
  return {
    closed: state.closed,
    current: {
      page: state.current.page,
      attention: creditReadingAttentionBlock(state.current.attention, nowMs),
    },
    pendingSinceMs: null,
    maxPage: state.maxPage,
  }
}

/**
 * Finish the sitting. Dwells for the same page are summed — the visit order
 * mattered while reading, but what survives is how long each page held you.
 * Pages credited nothing were scrolled past, not read.
 */
export function finishPdfAttentionBlock(
  state: PdfAttentionStateBlock,
  nowMs: number,
): { pages: PdfPageDwellBlock[]; maxPage: number } {
  const all = state.current ? closeCurrent(state, nowMs) : state.closed
  const byPage = new Map<number, number>()
  for (const d of all) {
    if (d.activeMs <= 0) continue
    byPage.set(d.page, (byPage.get(d.page) ?? 0) + d.activeMs)
  }
  const pages = [...byPage.entries()]
    .map(([page, activeMs]) => ({ page, activeMs }))
    .sort((a, b) => a.page - b.page)
  return { pages, maxPage: state.maxPage }
}
