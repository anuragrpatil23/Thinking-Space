/* Where a reader left off in a PDF, so reopening the file resumes there.

   A position is a page plus a fraction of that page's height, not a scroll
   offset. Pixels mean nothing across a relaunch: the window may be a different
   width, the zoom a different mode, and page boxes are still being measured
   when the document first lays out. A fraction of a page survives all three.

   localStorage is the synchronous copy the viewer restores from, keyed by
   vault path — which is the same string on every device, so it is also the key
   the roaming copy uses (see pdfReadingPositionSyncOrch). A moved or renamed
   file starts again from the top.

   Every entry carries the time the reader last moved, and across devices the
   newest one wins. That is why being back at the start is stored like any other
   position rather than deleted: a missing entry would lose to another device's
   older, deeper one, and the file would jump back to where it had been. */

export interface PdfReadingPositionBlock {
  /** 1-based page whose box holds the top edge of the viewport. */
  page: number
  /** How far down that page the viewport top sits, 0-1. */
  offset: number
}

export interface PdfReadingPositionEntryBlock extends PdfReadingPositionBlock {
  /** Epoch ms the reader was last at this position. Newest wins across
   *  devices; oldest is evicted first. */
  at: number
}

export type PdfReadingPositionStoreBlock = Record<string, PdfReadingPositionEntryBlock>

export interface PdfPageRectBlock {
  top: number
  bottom: number
  height: number
}

const READING_POSITION_STORAGE_KEY_BLOCK = 'thinkspc:pdf-reading-positions'

/* One localStorage value holds every document, and it is re-serialized on each
   write, so it is capped. The oldest entries go first. */
export const MAX_PDF_READING_POSITIONS_BLOCK = 200

function clampOffsetBlock(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, 1))
}

/* The page under the top edge of the viewport, found from the page boxes
   themselves rather than from the viewer's current-page state — that state is
   derived for the toolbar and the render window and lags the scroll.

   Pages are stacked in order, so the first page whose bottom is below the
   viewport top is a binary search. When the top edge falls in the gap between
   two pages the answer is the next page at offset 0. */
export function locatePdfReadingPositionBlock(params: {
  numPages: number
  viewportTop: number
  pageRectFor: (page: number) => PdfPageRectBlock | null
}): PdfReadingPositionBlock | null {
  const { numPages, viewportTop, pageRectFor } = params
  if (numPages <= 0 || !Number.isFinite(viewportTop)) return null

  let low = 1
  let high = numPages
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const rect = pageRectFor(middle)
    if (!rect) return null
    if (rect.bottom <= viewportTop) low = middle + 1
    else high = middle
  }

  const rect = pageRectFor(low)
  /* A zero-height box is a page that is not laid out — the surface is hidden —
     and any position read from it would be noise. */
  if (!rect || !(rect.height > 0)) return null

  return {
    page: low,
    offset: clampOffsetBlock((viewportTop - rect.top) / rect.height),
  }
}

/* How far the scroller has to move to put a saved position back under the
   viewport top, given where that page's box currently is. */
export function computePdfReadingRestoreDeltaBlock(params: {
  position: PdfReadingPositionBlock
  viewportTop: number
  pageRect: PdfPageRectBlock
}): number {
  const { position, viewportTop, pageRect } = params
  return (pageRect.top - viewportTop) + clampOffsetBlock(position.offset) * pageRect.height
}

/* Field-by-field rather than a cast: the value outlives app upgrades and can be
   edited by hand, and a NaN page would otherwise reach the render window. */
export function parsePdfReadingPositionStoreBlock(raw: string | null): PdfReadingPositionStoreBlock {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const store: PdfReadingPositionStoreBlock = {}
  for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const { page, offset, at } = value as Partial<PdfReadingPositionEntryBlock>
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) continue
    store[path] = {
      page,
      offset: clampOffsetBlock(typeof offset === 'number' ? offset : 0),
      at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    }
  }
  return store
}

export function upsertPdfReadingPositionBlock(
  store: PdfReadingPositionStoreBlock,
  path: string,
  position: PdfReadingPositionBlock,
  now: number,
): PdfReadingPositionStoreBlock {
  const next = { ...store }

  next[path] = {
    page: Math.max(1, Math.floor(position.page)),
    offset: Number(clampOffsetBlock(position.offset).toFixed(4)),
    at: now,
  }

  const paths = Object.keys(next)
  if (paths.length <= MAX_PDF_READING_POSITIONS_BLOCK) return next

  paths.sort((a, b) => next[a].at - next[b].at)
  for (const stale of paths.slice(0, paths.length - MAX_PDF_READING_POSITIONS_BLOCK)) {
    delete next[stale]
  }
  return next
}

/* The newer of two entries for the same file; either may be absent. */
export function pickNewerPdfReadingPositionBlock(
  a: PdfReadingPositionEntryBlock | null | undefined,
  b: PdfReadingPositionEntryBlock | null | undefined,
): PdfReadingPositionEntryBlock | null {
  if (!a) return b ?? null
  if (!b) return a
  return b.at > a.at ? b : a
}

export function readPdfReadingPositionStoreBlock(): PdfReadingPositionStoreBlock {
  if (typeof window === 'undefined') return {}
  try {
    return parsePdfReadingPositionStoreBlock(
      window.localStorage.getItem(READING_POSITION_STORAGE_KEY_BLOCK),
    )
  } catch {
    return {}
  }
}

export function readPdfReadingPositionBlock(path: string): PdfReadingPositionEntryBlock | null {
  return readPdfReadingPositionStoreBlock()[path] ?? null
}

/* Read-merge-write, so two windows reading different files do not drop each
   other's entries. `at` is passed when adopting another device's entry, which
   must keep the time the reader was actually there. */
export function writePdfReadingPositionBlock(
  path: string,
  position: PdfReadingPositionBlock,
  at: number = Date.now(),
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      READING_POSITION_STORAGE_KEY_BLOCK,
      JSON.stringify(upsertPdfReadingPositionBlock(readPdfReadingPositionStoreBlock(), path, position, at)),
    )
  } catch {
    /* Private browsing or a full quota: the file simply opens at the top. */
  }
}
