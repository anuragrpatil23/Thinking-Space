/* Where an internal PDF link points, and which part of that page to show in a
   peek.

   A link annotation carries a destination, not a region. "(Sablé-Meyer et al.,
   2022)" resolves to a point near the top of a reference entry; "Figure 2"
   resolves to a point near the figure or its caption. The peek has to turn
   that point into a rectangle worth looking at, and the right rectangle
   depends on what was linked:

   - A reference entry is a few lines of one column. Showing the full page
     width would put the neighbouring column's entries beside it, so the
     column is recovered from the text on the page.
   - A figure or table is wide and tall, and LaTeX anchors it inconsistently —
     at the top of the float with `hypcap`, at the caption without it, and APA
     style puts the caption above the image. So the peek shows a generous band
     on both sides of the anchor rather than guessing which side the image is.

   Coordinates here are top-down PDF units relative to the page's view box:
   the space the page is drawn in, before any zoom. */

export type PdfLinkKindBlock = 'citation' | 'figure' | 'table' | 'equation' | 'section' | 'other'

export interface PdfPeekRegionBlock {
  x: number
  y: number
  width: number
  height: number
}

/** A text run on the destination page, top-down: `y` is the baseline. */
export interface PdfPeekTextItemBlock {
  x: number
  y: number
  width: number
}

/** What a link's own text says it points at. Order matters: "Table 2" is a
    table even though it would also match the generic numbered-reference rule. */
export function classifyPdfLinkTextBlock(text: string, before = ''): PdfLinkKindBlock {
  const value = text.trim()
  if (!value) return 'other'
  /* Many templates link only the number of "Figure 2", so the word that
     names it sits just outside the link box; `before` is the line up to the
     box, cut so that `before + text` reads as the original line. */
  if (value.length <= 8) {
    const tail = `${before}${value}`
    /* The slack can also carry a letter past the number ("Table 2 w"). */
    const end = '[^\\d]{0,3}$'
    if (new RegExp(`\\bfig(ure)?s?\\.?\\s*\\d+[a-z]{0,3}${end}`, 'i').test(tail)) return 'figure'
    if (new RegExp(`\\btables?\\s*\\d+${end}`, 'i').test(tail)) return 'table'
    if (new RegExp(`\\b(sec(tion)?s?\\.?|§)\\s*\\d[\\d.]*${end}`, 'i').test(tail)) return 'section'
    if (/\b[Aa]ppendi(x|ces)\s+[A-Z]\b/.test(tail)) return 'section'
    if (new RegExp(`\\beq(uation)?s?\\.?\\s*\\(?\\d+\\)?${end}`, 'i').test(tail)) return 'equation'
  }
  if (/^(fig(ure)?s?\.?)\s*\d/i.test(value) || /^fig(ure)?s?\.?$/i.test(value)) return 'figure'
  if (/^(tab(le)?s?\.?)\s*\d/i.test(value) || /^tables?$/i.test(value)) return 'table'
  if (/^(eq(uation)?s?\.?)\s*\(?\d/i.test(value) || /^\(\d+(\.\d+)?[a-z]?\)$/i.test(value)) return 'equation'
  /* A link box sliced out of a longer run can carry a stray character on
     either side ("e Figure 4)"), so figure/table also match unanchored. */
  if (/\bfig(ure)?s?\.?\s*\d/i.test(value)) return 'figure'
  if (/\btables?\s*\d/i.test(value)) return 'table'
  if (/^(sec(tion)?s?\.?|§|appendix|app\.)\s*[\dA-Z]/i.test(value) || /^\d+(\.\d+)+$/.test(value)) return 'section'
  /* Author-year ("Hornik et al., 1989", "2021") and numeric ("[12]", "12")
     citation styles. Bare digits come last: a bare number that is not one of
     the cases above is most often a numbered reference. */
  /* natbib often links author and year as two boxes: "(Deitke et al.," */
  if (/\bet al\b/i.test(value)) return 'citation'
  /* A lone surname box, "(Liu" or "Zhang", is the author half of a citation. */
  if (/\(\p{Lu}\p{Ll}+/u.test(value) || /^\p{Lu}\p{Ll}+$/u.test(value)) return 'citation'
  /* The author half of a split author-year box: "(Fodor,", "Tuli et",
     "; Reed & Johnsen,", or a surname broken across lines, "(Golo-". */
  if (/(^|[(;\s])\p{Lu}[\p{L}'’ -]*(,|\s+et\b|\s+&|\s+and\b)/u.test(value) || /^\W*\(\p{Lu}\p{Ll}+-$/u.test(value)) return 'citation'
  if (/\b(1[5-9]|20)\d{2}[a-z]?\b/.test(value) || /^\[?\d+([,–-]\s*\d+)*\]?$/.test(value)) return 'citation'
  return 'other'
}

/** The page-relative point of an explicit destination array, as pdf.js
    returns it: `[pageRef, { name }, ...args]`. Bottom-up PDF units; null where
    the destination type leaves that axis unspecified. */
export function parsePdfExplicitDestBlock(dest: readonly unknown[]): { left: number | null; top: number | null } {
  const mode = (dest[1] as { name?: unknown } | undefined)?.name
  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  switch (mode) {
    case 'XYZ':
      return { left: num(dest[2]), top: num(dest[3]) }
    case 'FitH':
    case 'FitBH':
      return { left: null, top: num(dest[2]) }
    case 'FitV':
    case 'FitBV':
      return { left: num(dest[2]), top: null }
    case 'FitR':
      return { left: num(dest[2]), top: num(dest[5]) }
    default:
      return { left: null, top: null }
  }
}

const COLUMN_GUTTER_PX_BLOCK = 6
const BAND_HEIGHT_BLOCK: Record<Exclude<PdfLinkKindBlock, 'figure' | 'table'>, number> = {
  citation: 96,
  equation: 72,
  section: 150,
  other: 120,
}

function clampBlock(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** The rectangle of the destination page to show for a link of this kind. */
export function computePdfPeekRegionBlock(params: {
  kind: PdfLinkKindBlock
  pageWidth: number
  pageHeight: number
  /** Top-down destination point; null when the destination does not say. */
  destLeft: number | null
  destTop: number | null
  textItems: readonly PdfPeekTextItemBlock[]
}): PdfPeekRegionBlock {
  const { kind, pageWidth, pageHeight, destLeft, destTop, textItems } = params

  if (kind === 'figure' || kind === 'table') {
    if (destTop === null) return { x: 0, y: 0, width: pageWidth, height: pageHeight }
    const top = clampBlock(destTop - pageHeight * 0.4, 0, pageHeight)
    const bottom = clampBlock(destTop + pageHeight * 0.35, 0, pageHeight)
    return { x: 0, y: top, width: pageWidth, height: Math.max(1, bottom - top) }
  }

  const bandTop = clampBlock((destTop ?? 0) - 4, 0, pageHeight)
  const bandBottom = clampBlock(bandTop + BAND_HEIGHT_BLOCK[kind], 0, pageHeight)

  if (destLeft === null) {
    return { x: 0, y: bandTop, width: pageWidth, height: Math.max(1, bandBottom - bandTop) }
  }

  /* The column is whichever half of the page the destination starts in;
     its right edge is where that half's text in the band actually ends. A
     single-column page has lines that start left of centre and run to the
     right margin, so the same rule returns the full measure there. */
  const half = pageWidth / 2
  const inLeftHalf = destLeft < half
  let right = -Infinity
  for (const item of textItems) {
    if (item.y < bandTop || item.y > bandBottom) continue
    if (item.x < destLeft - COLUMN_GUTTER_PX_BLOCK) continue
    if (inLeftHalf ? item.x >= half : item.x < half - 12) continue
    right = Math.max(right, item.x + item.width)
  }
  if (!Number.isFinite(right)) right = inLeftHalf ? half : pageWidth - Math.max(0, destLeft - half)

  const x = clampBlock(destLeft - COLUMN_GUTTER_PX_BLOCK, 0, pageWidth)
  const width = clampBlock(right + COLUMN_GUTTER_PX_BLOCK, x + 1, pageWidth) - x
  return { x, y: bandTop, width, height: Math.max(1, bandBottom - bandTop) }
}

/* ---- Captions -------------------------------------------------------------

   Finding the figure itself, rather than trusting where a link landed. A
   caption is the one reliable landmark a figure has, and its typography says
   which side of it the figure is on:

   - "Figure 3: Comparison of…" — a label followed by text on the same line.
     LaTeX's default: the caption sits *under* the image.
   - "Figure 4" alone on its line, title on the next — APA and many journals:
     the label sits *above* the image.
   - Tables put their caption above the table in both conventions.

   A mention in running text ("as Figure 2 shows", "Fig. 3bc") is never a
   caption: it either has no colon/period after the number or does not start
   the text run. */

export type PdfCaptionKindBlock = 'figure' | 'table'
export type PdfCaptionStyleBlock = 'label-above' | 'caption-below'

export interface PdfCaptionBlock {
  kind: PdfCaptionKindBlock
  number: string
  style: PdfCaptionStyleBlock
}

const CAPTION_START_RE_BLOCK = /^\s*(Figure|Fig\.|FIGURE|Table|TABLE)\s*(\d+)\s*([:.|]?)\s*(.*)$/

/** A text run that starts a caption, or null. `restOfLine` is the text that
    follows on the same baseline in other runs (pdf.js often splits a line). */
export function parsePdfCaptionStartBlock(str: string, restOfLine = ''): PdfCaptionBlock | null {
  const match = CAPTION_START_RE_BLOCK.exec(str)
  if (!match) return null
  const kind: PdfCaptionKindBlock = /^t/i.test(match[1]) ? 'table' : 'figure'
  const punctuation = match[3]
  const trailing = `${match[4]} ${restOfLine}`.trim()
  if (punctuation) {
    return { kind, number: match[2], style: kind === 'table' ? 'label-above' : 'caption-below' }
  }
  /* No punctuation: only a label standing alone on its line is a caption. */
  if (trailing.length === 0) return { kind, number: match[2], style: 'label-above' }
  return null
}

/** "Figure 3bc", "Fig. 2", "Table 1" inside running text, as offsets into the
    string. Plural and range forms point at their first number. */
export function findPdfFigureMentionsBlock(str: string): Array<{ start: number; end: number; kind: PdfCaptionKindBlock; number: string }> {
  const out: Array<{ start: number; end: number; kind: PdfCaptionKindBlock; number: string }> = []
  const re = /\b(Figs?\.|Figures?|Tables?)\s*(\d+)[a-z]{0,3}\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(str)) !== null) {
    out.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: /^t/i.test(match[1]) ? 'table' : 'figure',
      number: match[2],
    })
  }
  return out
}

/** The region around a figure or table, located by its caption. */
export function computePdfCaptionRegionBlock(params: {
  style: PdfCaptionStyleBlock
  pageWidth: number
  pageHeight: number
  /** Top-down baseline of the caption's first line. */
  captionTop: number
  captionLeft: number
  /** Right end of the caption's first line. */
  captionLineRight: number
}): PdfPeekRegionBlock {
  const { style, pageWidth: w, pageHeight: h, captionTop, captionLeft, captionLineRight } = params
  /* A caption that starts in one half and whose first line ends before the
     middle belongs to a single-column float; otherwise the float is full
     width. The first line is used because a caption's last line is short. */
  let x = 0
  let right = w
  /* An APA label ("Figure 4" alone) is short whatever the float's width, so
     its line length says nothing; only its side of the page does. */
  if (style === 'caption-below' && captionLineRight < w * 0.55) {
    x = Math.max(0, captionLeft - 10)
    right = Math.min(w, captionLineRight + 10)
  } else if (captionLeft > w * 0.45) {
    x = Math.max(0, captionLeft - 10)
  }

  const top = style === 'label-above'
    ? captionTop - 14
    : captionTop - h * 0.5
  const bottom = style === 'label-above'
    ? captionTop + h * 0.55
    : captionTop + h * 0.1
  const clampedTop = clampBlock(top, 0, h)
  const clampedBottom = clampBlock(bottom, 0, h)
  return { x, y: clampedTop, width: right - x, height: Math.max(1, clampedBottom - clampedTop) }
}
