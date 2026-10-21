import {
  PDF_PAPER_THEME_BACKGROUNDS_BLOCK,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'

/* The EPUB reader's pure parts: display preferences, the stylesheet they turn
   into, and where each book was left.

   A PDF is fixed artwork, so its paper tone has to be a pixel pass. An EPUB is
   reflowable text, so the same tones — and type size, face and spacing — are
   just CSS on the book's own markup. The tones share the PDF reader's paper
   colours and its stored choice, so switching formats keeps the same page. */

export function isEpubDocumentPathBlock(path: string): boolean {
  return /\.epub$/i.test(path)
}

export type EpubFontFaceBlock = 'publisher' | 'serif' | 'sans'
export type EpubFlowBlock = 'paginated' | 'scrolled'

export interface EpubReaderPrefsBlock {
  /** Percent of the book's own base size. */
  fontScale: number
  lineHeight: number
  fontFace: EpubFontFaceBlock
  flow: EpubFlowBlock
}

export const DEFAULT_EPUB_READER_PREFS_BLOCK: EpubReaderPrefsBlock = {
  fontScale: 100,
  lineHeight: 1.5,
  fontFace: 'publisher',
  flow: 'paginated',
}

export const EPUB_FONT_SCALE_STOPS_BLOCK: readonly number[] = [80, 90, 100, 110, 120, 135, 150, 175, 200]
export const EPUB_LINE_HEIGHTS_BLOCK: readonly number[] = [1.3, 1.5, 1.75]

/* Ink for each tone. Matches the ramps pdfPaperThemeBlock maps luminance
   onto, so a PDF and an EPUB in the same tone read as the same paper. */
const INK_BLOCK: Record<PdfPaperThemeBlock, string> = {
  original: '#1a1a1a',
  warm: '#1a1814',
  sepia: '#2e2214',
  night: '#e8e6e1',
}

const FONT_STACKS_BLOCK: Record<Exclude<EpubFontFaceBlock, 'publisher'>, string> = {
  serif: "'Iowan Old Style', 'Charter', 'Palatino', Georgia, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif",
}

/** The stylesheet laid over every section. `!important` is the only way to
    win against a book's own CSS, which is often itself `!important`. */
export function buildEpubReaderCssBlock(prefs: EpubReaderPrefsBlock, theme: PdfPaperThemeBlock): string {
  const background = PDF_PAPER_THEME_BACKGROUNDS_BLOCK[theme]
  const ink = INK_BLOCK[theme]
  const rules = [
    `html { color-scheme: ${theme === 'night' ? 'dark' : 'light'}; font-size: ${prefs.fontScale}% !important; }`,
    `html, body { background: ${background} !important; color: ${ink} !important; }`,
    `p, li, blockquote, dd, dt, td { line-height: ${prefs.lineHeight} !important; }`,
    'p { hyphens: auto; -webkit-hyphens: auto; }',
    'img, svg, video { max-width: 100%; }',
  ]
  /* The publisher's colours were chosen for white paper. On a toned page
     text inherits the tone's ink; images and their backgrounds are left. */
  if (theme !== 'original') {
    rules.push('body *:not(img):not(svg):not(svg *) { color: inherit !important; }')
  }
  if (theme === 'night') {
    rules.push('a, a * { color: #8ab4f8 !important; }')
  }
  if (prefs.fontFace !== 'publisher') {
    rules.push(`body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONT_STACKS_BLOCK[prefs.fontFace]} !important; }`)
  }
  return rules.join('\n')
}

/** Next stop up or down the type-size ladder, holding at the ends. */
export function stepEpubFontScaleBlock(current: number, direction: 1 | -1): number {
  if (direction > 0) return EPUB_FONT_SCALE_STOPS_BLOCK.find((stop) => stop > current) ?? current
  for (let i = EPUB_FONT_SCALE_STOPS_BLOCK.length - 1; i >= 0; i -= 1) {
    if (EPUB_FONT_SCALE_STOPS_BLOCK[i] < current) return EPUB_FONT_SCALE_STOPS_BLOCK[i]
  }
  return current
}

const PREFS_STORAGE_KEY_BLOCK = 'thinkspc:epub-reader-prefs'

export function readEpubReaderPrefsBlock(): EpubReaderPrefsBlock {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY_BLOCK) ?? 'null') as Partial<EpubReaderPrefsBlock> | null
    if (!parsed) return DEFAULT_EPUB_READER_PREFS_BLOCK
    return {
      fontScale: EPUB_FONT_SCALE_STOPS_BLOCK.includes(parsed.fontScale as number)
        ? parsed.fontScale as number : DEFAULT_EPUB_READER_PREFS_BLOCK.fontScale,
      lineHeight: EPUB_LINE_HEIGHTS_BLOCK.includes(parsed.lineHeight as number)
        ? parsed.lineHeight as number : DEFAULT_EPUB_READER_PREFS_BLOCK.lineHeight,
      fontFace: parsed.fontFace === 'serif' || parsed.fontFace === 'sans' || parsed.fontFace === 'publisher'
        ? parsed.fontFace : DEFAULT_EPUB_READER_PREFS_BLOCK.fontFace,
      flow: parsed.flow === 'scrolled' ? 'scrolled' : 'paginated',
    }
  } catch {
    return DEFAULT_EPUB_READER_PREFS_BLOCK
  }
}

export function writeEpubReaderPrefsBlock(prefs: EpubReaderPrefsBlock): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY_BLOCK, JSON.stringify(prefs))
  } catch {
    /* Preferences are a convenience; a full or blocked store keeps defaults. */
  }
}

/* ---- Where each book was left -------------------------------------------

   A CFI, the EPUB standard's address for a point in the text: it survives a
   different window width, font size or layout, which a page number or scroll
   offset would not. Keyed by vault path like the PDF positions, one capped
   map in localStorage, oldest evicted first. */

export interface EpubReadingPositionEntryBlock {
  cfi: string
  /** 0-1 through the whole book, for display before the book has opened. */
  fraction: number
  at: number
}

const POSITIONS_STORAGE_KEY_BLOCK = 'thinkspc:epub-reading-positions'
export const MAX_EPUB_READING_POSITIONS_BLOCK = 200

type PositionStoreBlock = Record<string, EpubReadingPositionEntryBlock>

function readPositionStoreBlock(): PositionStoreBlock {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(POSITIONS_STORAGE_KEY_BLOCK) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as PositionStoreBlock : {}
  } catch {
    return {}
  }
}

export function readEpubReadingPositionBlock(path: string): EpubReadingPositionEntryBlock | null {
  const entry = readPositionStoreBlock()[path]
  return entry && typeof entry.cfi === 'string' && entry.cfi.startsWith('epubcfi(') ? entry : null
}

/** Pure: the store with `path` set and the oldest entries over the cap gone. */
export function withEpubReadingPositionBlock(
  store: PositionStoreBlock,
  path: string,
  entry: EpubReadingPositionEntryBlock,
): PositionStoreBlock {
  const next = { ...store, [path]: entry }
  const keys = Object.keys(next)
  if (keys.length <= MAX_EPUB_READING_POSITIONS_BLOCK) return next
  keys.sort((a, b) => next[a].at - next[b].at)
  for (const key of keys.slice(0, keys.length - MAX_EPUB_READING_POSITIONS_BLOCK)) delete next[key]
  return next
}

export function writeEpubReadingPositionBlock(path: string, cfi: string, fraction: number): void {
  try {
    const next = withEpubReadingPositionBlock(readPositionStoreBlock(), path, {
      cfi,
      fraction: Number.isFinite(fraction) ? Math.max(0, Math.min(fraction, 1)) : 0,
      at: Date.now(),
    })
    window.localStorage.setItem(POSITIONS_STORAGE_KEY_BLOCK, JSON.stringify(next))
  } catch {
    /* Losing a position costs a reader their place, not their data. */
  }
}
