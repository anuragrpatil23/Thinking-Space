/* "12 pages left in chapter", from the PDF's own outline (its bookmarks).

   A page count to the end of a 681-page book is too far away to pull a reader
   forward; the end of the chapter is close enough to read toward. The outline
   is the only place a PDF says where chapters start, so a file without one
   shows nothing rather than a guess.

   Outlines nest (Part > Chapter > Section) and no level is labelled
   "chapter". The level used is the shallowest one whose stretches are short
   enough to finish in a sitting: a book whose top level is five Parts descends
   to its chapters, a book whose top level already is chapters stays there. */

export interface PdfOutlineEntryBlock {
  title: string
  /* 1-based page the entry points at. */
  page: number
  /* 0 for top-level entries. */
  depth: number
}

export interface PdfChapterStartBlock {
  title: string
  page: number
}

export interface PdfChapterProgressBlock {
  title: string
  /* The page this chapter starts on; names it among the chapter starts. */
  startPage: number
  /* Pages after the current one that still belong to this chapter. */
  pagesLeft: number
  nextTitle: string | null
}

/* An average stretch longer than this reads as a Part, not a chapter. */
const MAX_AVERAGE_CHAPTER_PAGES_BLOCK = 60

function startsAtDepthBlock(entries: PdfOutlineEntryBlock[], maxDepth: number, numPages: number): PdfChapterStartBlock[] {
  const byPage = new Map<number, PdfChapterStartBlock>()
  for (const entry of entries) {
    if (entry.depth > maxDepth) continue
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > numPages) continue
    /* Several entries on one page (a Part and its first chapter): the first,
       outermost one names the page. */
    if (!byPage.has(entry.page)) byPage.set(entry.page, { title: entry.title.trim(), page: entry.page })
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page)
}

export function pickPdfChapterStartsBlock(entries: PdfOutlineEntryBlock[], numPages: number): PdfChapterStartBlock[] {
  if (numPages <= 0 || entries.length === 0) return []
  const deepest = entries.reduce((max, entry) => Math.max(max, entry.depth), 0)
  let starts: PdfChapterStartBlock[] = []
  for (let depth = 0; depth <= deepest; depth += 1) {
    starts = startsAtDepthBlock(entries, depth, numPages)
    if (starts.length > 0 && numPages / starts.length <= MAX_AVERAGE_CHAPTER_PAGES_BLOCK) break
  }
  /* One boundary divides nothing: "pages left" would just be the book's. */
  return starts.length >= 2 ? starts : []
}

export function computePdfChapterProgressBlock(
  starts: PdfChapterStartBlock[],
  pageNumber: number,
  numPages: number,
): PdfChapterProgressBlock | null {
  if (starts.length === 0 || numPages <= 0) return null
  let index = -1
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i].page <= pageNumber) index = i
    else break
  }
  /* Before the first bookmark (cover, title page) there is no chapter yet. */
  if (index < 0) return null
  const next = starts[index + 1] ?? null
  const lastPage = next ? next.page - 1 : numPages
  return {
    title: starts[index].title,
    startPage: starts[index].page,
    pagesLeft: Math.max(0, lastPage - pageNumber),
    nextTitle: next ? next.title : null,
  }
}

export function formatPdfChapterProgressBlock(progress: PdfChapterProgressBlock): string {
  if (progress.pagesLeft === 0) return 'last page of chapter'
  return `${progress.pagesLeft} ${progress.pagesLeft === 1 ? 'page' : 'pages'} left in chapter`
}
