import { describe, it, expect } from 'vitest'
import {
  createPdfAttentionBlock,
  creditPdfAttentionBlock,
  finishPdfAttentionBlock,
  observePdfPageBlock,
} from '@/services/lego_blocks/units/pdfAttentionBlock'
import {
  IDLE_CEILING_MS,
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'

const T0 = 1_756_500_000_000

describe('pdfAttentionBlock', () => {
  it('opens on the first page it sees', () => {
    const s = observePdfPageBlock(createPdfAttentionBlock(T0), 1, T0)
    expect(s.current?.page).toBe(1)
    expect(s.maxPage).toBe(1)
  })

  it('credits a page held across several signals', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 7, T0)
    s = observePdfPageBlock(s, 7, T0 + 30_000)
    s = observePdfPageBlock(s, 7, T0 + 90_000)
    const { pages } = finishPdfAttentionBlock(s, T0 + 90_000)
    expect(pages).toEqual([{ page: 7, activeMs: 90_000 }])
  })

  it('closes a page when the reader turns to another', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 7, T0)
    s = observePdfPageBlock(s, 8, T0 + 60_000)
    const { pages } = finishPdfAttentionBlock(s, T0 + 100_000)
    expect(pages).toEqual([
      { page: 7, activeMs: 60_000 },
      { page: 8, activeMs: 40_000 },
    ])
  })

  // Coming back to a page is normal reading. Visit order matters while
  // reading; what survives is how long the page held you in total.
  it('sums repeat visits to the same page', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 12, T0)
    s = observePdfPageBlock(s, 13, T0 + 60_000)
    s = observePdfPageBlock(s, 12, T0 + 120_000)
    const { pages } = finishPdfAttentionBlock(s, T0 + 180_000)
    expect(pages).toEqual([
      { page: 12, activeMs: 120_000 },
      { page: 13, activeMs: 60_000 },
    ])
  })

  it('returns pages in page order, not visit order', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 40, T0)
    s = observePdfPageBlock(s, 3, T0 + 60_000)
    s = observePdfPageBlock(s, 20, T0 + 120_000)
    const { pages } = finishPdfAttentionBlock(s, T0 + 180_000)
    expect(pages.map(p => p.page)).toEqual([3, 20, 40])
  })

  it('tracks the deepest page reached even after going back', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 5, T0)
    s = observePdfPageBlock(s, 210, T0 + 30_000)
    s = observePdfPageBlock(s, 6, T0 + 60_000)
    expect(finishPdfAttentionBlock(s, T0 + 90_000).maxPage).toBe(210)
  })

  it('drops pages merely scrolled past', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 1, T0)
    // Four page changes in the same instant — scrolling fast, reading none —
    // then settling on the last one.
    s = observePdfPageBlock(s, 2, T0)
    s = observePdfPageBlock(s, 3, T0)
    s = observePdfPageBlock(s, 4, T0)
    s = observePdfPageBlock(s, 4, T0 + 90_000)
    const { pages } = finishPdfAttentionBlock(s, T0 + 90_000)
    expect(pages).toEqual([{ page: 4, activeMs: 90_000 }])
  })

  // The invariant that makes the per-page numbers trustworthy: they partition
  // the document's own attention rather than duplicating or losing part of it.
  it('partitions exactly the attention the document credits', () => {
    const signals = [0, 30_000, 90_000, 91_000, 200_000, 260_000].map(d => T0 + d)
    const pages = [4, 4, 5, 5, 6, 6]
    let doc = createReadingAttentionBlock(T0)
    let pdf = observePdfPageBlock(createPdfAttentionBlock(T0), pages[0], signals[0])
    for (let i = 1; i < signals.length; i += 1) {
      doc = creditReadingAttentionBlock(doc, signals[i])
      pdf = observePdfPageBlock(pdf, pages[i], signals[i])
    }
    const { pages: dwells } = finishPdfAttentionBlock(pdf, signals[signals.length - 1])
    expect(dwells.reduce((a, d) => a + d.activeMs, 0)).toBe(doc.creditedMs)
  })

  // The bug the canvas shipped with: a document takes time to load, and the
  // first page opens late. That lead-in belongs to the first page.
  it('covers the load time in the first page', () => {
    let doc = createReadingAttentionBlock(T0)
    let pdf = createPdfAttentionBlock(T0)
    pdf = observePdfPageBlock(pdf, null, T0 + 1_000)      // not loaded yet
    doc = creditReadingAttentionBlock(doc, T0 + 1_000)
    pdf = observePdfPageBlock(pdf, 1, T0 + 3_000)         // first page appears
    doc = creditReadingAttentionBlock(doc, T0 + 3_000)
    pdf = observePdfPageBlock(pdf, 1, T0 + 120_000)
    doc = creditReadingAttentionBlock(doc, T0 + 120_000)
    const { pages } = finishPdfAttentionBlock(pdf, T0 + 120_000)
    expect(pages.reduce((a, d) => a + d.activeMs, 0)).toBe(doc.creditedMs)
  })

  it('holds the invariant across a walk-away', () => {
    let doc = createReadingAttentionBlock(T0)
    let pdf = observePdfPageBlock(createPdfAttentionBlock(T0), 9, T0)
    const away = T0 + 40 * 60_000
    doc = creditReadingAttentionBlock(doc, away)
    pdf = observePdfPageBlock(pdf, 9, away)
    const { pages } = finishPdfAttentionBlock(pdf, away)
    expect(doc.creditedMs).toBe(IDLE_CEILING_MS)
    expect(pages.reduce((a, d) => a + d.activeMs, 0)).toBe(IDLE_CEILING_MS)
  })

  it('credits presence that is not a page turn', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 3, T0)
    s = creditPdfAttentionBlock(s, T0 + 45_000)
    expect(finishPdfAttentionBlock(s, T0 + 45_000).pages[0].activeMs).toBe(45_000)
  })

  it('ignores an unusable page rather than losing the current one', () => {
    let s = observePdfPageBlock(createPdfAttentionBlock(T0), 3, T0)
    s = observePdfPageBlock(s, 0, T0 + 10_000)
    s = observePdfPageBlock(s, null, T0 + 20_000)
    s = observePdfPageBlock(s, Number.NaN, T0 + 30_000)
    expect(s.current?.page).toBe(3)
  })
})
