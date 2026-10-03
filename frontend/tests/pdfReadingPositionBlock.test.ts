import { describe, expect, it } from 'vitest'
import {
  computePdfReadingRestoreDeltaBlock,
  locatePdfReadingPositionBlock,
  MAX_PDF_READING_POSITIONS_BLOCK,
  parsePdfReadingPositionStoreBlock,
  pickNewerPdfReadingPositionBlock,
  upsertPdfReadingPositionBlock,
  type PdfPageRectBlock,
  type PdfReadingPositionStoreBlock,
} from '@/services/lego_blocks/units/pdfReadingPositionBlock'

const PAGE_HEIGHT = 1000
const PAGE_GAP = 12
const FIRST_PAGE_TOP = 12

/* A column of equal pages as the viewer lays them out, seen from a scroller
   whose top edge is at y = 0 and which has been scrolled by `scrollTop`. */
function stackedPagesBlock(scrollTop: number, numPages: number) {
  let reads = 0
  const pageRectFor = (page: number): PdfPageRectBlock | null => {
    if (page < 1 || page > numPages) return null
    reads += 1
    const top = FIRST_PAGE_TOP + (page - 1) * (PAGE_HEIGHT + PAGE_GAP) - scrollTop
    return { top, bottom: top + PAGE_HEIGHT, height: PAGE_HEIGHT }
  }
  return { pageRectFor, readCount: () => reads }
}

describe('pdfReadingPositionBlock', () => {
  it('reports the start of page 1 for an unscrolled document', () => {
    const { pageRectFor } = stackedPagesBlock(0, 40)
    const position = locatePdfReadingPositionBlock({ numPages: 40, viewportTop: 0, pageRectFor })
    expect(position).toEqual({ page: 1, offset: 0 })
  })

  it('finds the page under the viewport top and how far into it', () => {
    const scrollTop = FIRST_PAGE_TOP + 6 * (PAGE_HEIGHT + PAGE_GAP) + 250
    const { pageRectFor } = stackedPagesBlock(scrollTop, 40)
    const position = locatePdfReadingPositionBlock({ numPages: 40, viewportTop: 0, pageRectFor })
    expect(position?.page).toBe(7)
    expect(position?.offset).toBeCloseTo(0.25, 5)
  })

  it('resolves the gap between two pages to the top of the next one', () => {
    const scrollTop = FIRST_PAGE_TOP + PAGE_HEIGHT + PAGE_GAP / 2
    const { pageRectFor } = stackedPagesBlock(scrollTop, 40)
    expect(locatePdfReadingPositionBlock({ numPages: 40, viewportTop: 0, pageRectFor }))
      .toEqual({ page: 2, offset: 0 })
  })

  it('does not read every page box of a long document', () => {
    const scrollTop = FIRST_PAGE_TOP + 700 * (PAGE_HEIGHT + PAGE_GAP)
    const stack = stackedPagesBlock(scrollTop, 1000)
    const position = locatePdfReadingPositionBlock({
      numPages: 1000,
      viewportTop: 0,
      pageRectFor: stack.pageRectFor,
    })
    expect(position?.page).toBe(701)
    expect(stack.readCount()).toBeLessThan(15)
  })

  it('reports nothing when the surface is not laid out', () => {
    expect(locatePdfReadingPositionBlock({
      numPages: 10,
      viewportTop: 0,
      pageRectFor: () => ({ top: 0, bottom: 0, height: 0 }),
    })).toBeNull()
    expect(locatePdfReadingPositionBlock({
      numPages: 0,
      viewportTop: 0,
      pageRectFor: () => null,
    })).toBeNull()
  })

  it('restores to the position it located, at a different zoom', () => {
    const scrollTop = FIRST_PAGE_TOP + 6 * (PAGE_HEIGHT + PAGE_GAP) + 250
    const { pageRectFor } = stackedPagesBlock(scrollTop, 40)
    const position = locatePdfReadingPositionBlock({ numPages: 40, viewportTop: 0, pageRectFor })!

    /* Reopened unscrolled, with every page half the height it was. */
    const pageRect = { top: 3048, bottom: 3548, height: 500 }
    expect(computePdfReadingRestoreDeltaBlock({ position, viewportTop: 0, pageRect }))
      .toBeCloseTo(3048 + 125, 5)
  })

  it('stores a return to the start, so it can outrank an older deeper position', () => {
    const store = upsertPdfReadingPositionBlock({}, 'a.pdf', { page: 12, offset: 0.5 }, 100)
    expect(store['a.pdf']).toEqual({ page: 12, offset: 0.5, at: 100 })

    const back = upsertPdfReadingPositionBlock(store, 'a.pdf', { page: 1, offset: 0 }, 200)
    expect(back['a.pdf']).toEqual({ page: 1, offset: 0, at: 200 })
    expect(pickNewerPdfReadingPositionBlock(store['a.pdf'], back['a.pdf'])).toBe(back['a.pdf'])
  })

  it('picks the most recently read position across devices', () => {
    const mac = { page: 50, offset: 0.2, at: 2000 }
    const ipad = { page: 30, offset: 0.7, at: 1000 }
    expect(pickNewerPdfReadingPositionBlock(ipad, mac)).toBe(mac)
    expect(pickNewerPdfReadingPositionBlock(mac, ipad)).toBe(mac)
    expect(pickNewerPdfReadingPositionBlock(null, ipad)).toBe(ipad)
    expect(pickNewerPdfReadingPositionBlock(mac, undefined)).toBe(mac)
    expect(pickNewerPdfReadingPositionBlock(null, null)).toBeNull()
  })

  it('evicts the least recently read document past the cap', () => {
    let store: PdfReadingPositionStoreBlock = {}
    for (let index = 0; index <= MAX_PDF_READING_POSITIONS_BLOCK; index += 1) {
      store = upsertPdfReadingPositionBlock(store, `doc-${index}.pdf`, { page: 2, offset: 0 }, index)
    }
    expect(Object.keys(store)).toHaveLength(MAX_PDF_READING_POSITIONS_BLOCK)
    expect(store['doc-0.pdf']).toBeUndefined()
    expect(store[`doc-${MAX_PDF_READING_POSITIONS_BLOCK}.pdf`]).toBeDefined()
  })

  it('discards malformed stored values instead of trusting them', () => {
    expect(parsePdfReadingPositionStoreBlock(null)).toEqual({})
    expect(parsePdfReadingPositionStoreBlock('not json')).toEqual({})
    expect(parsePdfReadingPositionStoreBlock('[1,2]')).toEqual({})
    expect(parsePdfReadingPositionStoreBlock(JSON.stringify({
      'good.pdf': { page: 4, offset: 0.3, at: 9 },
      'no-page.pdf': { offset: 0.3 },
      'nan-page.pdf': { page: 'seven', offset: 0.1 },
      'wild-offset.pdf': { page: 2, offset: 40 },
    }))).toEqual({
      'good.pdf': { page: 4, offset: 0.3, at: 9 },
      'wild-offset.pdf': { page: 2, offset: 1, at: 0 },
    })
  })
})
