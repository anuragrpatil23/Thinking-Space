/* Paper tones for the PDF reader, applied to the rasterized bitmap.

   **Never implement these as a CSS filter on the canvas.** That is precisely
   the failure documented in docs/contracts/IOS-MEMORY.md: Excalidraw's dark
   mode is `filter: invert(93%) hue-rotate(180deg)` on live canvas elements, and
   WebKit must allocate a second full-size composited buffer per canvas per
   repaint. At 2x retina across several viewport-sized page canvases that is a
   reliable way to get the WebContent process killed — and the cost is paid on
   every composite frame, i.e. continuously while scrolling.

   A pixel pass over the ImageData costs one pass per raster instead. Rasters
   happen on zoom commits and page entry, not on frames, so the cost is bounded
   by interaction rather than by time on screen.

   The transforms are luminance-based rather than per-channel inversions.
   Inverting channels turns black text on white into white text on black but
   also turns a red heading cyan; mapping luminance onto a tinted ramp keeps
   hue relationships intact and is what makes a night page read like paper
   rather than like a photographic negative. */

export type PdfPaperThemeBlock = 'original' | 'warm' | 'sepia' | 'night'

export const PDF_PAPER_THEMES_BLOCK: readonly PdfPaperThemeBlock[] = [
  'original',
  'warm',
  'sepia',
  'night',
]

export const PDF_PAPER_THEME_LABELS_BLOCK: Record<PdfPaperThemeBlock, string> = {
  original: 'Original',
  warm: 'Warm',
  sepia: 'Sepia',
  night: 'Night',
}

/* Page background each theme presents, so the container behind a page that has
   not finished rastering matches the page that is about to appear. */
export const PDF_PAPER_THEME_BACKGROUNDS_BLOCK: Record<PdfPaperThemeBlock, string> = {
  original: '#ffffff',
  warm: '#faf4e8',
  sepia: '#f2e5cd',
  night: '#14161a',
}

interface PaperRampBlock {
  /* Colour at luminance 0 (ink) and at luminance 1 (paper). */
  ink: [number, number, number]
  paper: [number, number, number]
  /* How much of the original hue to retain, 0-1. */
  chroma: number
}

const PAPER_RAMPS_BLOCK: Record<Exclude<PdfPaperThemeBlock, 'original'>, PaperRampBlock> = {
  warm: { ink: [26, 24, 20], paper: [250, 244, 232], chroma: 0.75 },
  sepia: { ink: [46, 34, 20], paper: [242, 229, 205], chroma: 0.6 },
  /* Night keeps a little more chroma than sepia so syntax-coloured or
     illustrated pages do not flatten to monochrome. */
  night: { ink: [232, 230, 225], paper: [20, 22, 26], chroma: 0.65 },
}

/* Rec. 709 luma. */
function luminanceBlock(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/* Applies the theme to an ImageData buffer in place.

   Exported separately from the canvas so it can be tested on a plain buffer and
   so a future worker-side raster can reuse it without a DOM. */
export function applyPdfPaperThemeToImageDataBlock(
  data: Uint8ClampedArray,
  theme: PdfPaperThemeBlock,
): void {
  if (theme === 'original') return
  const ramp = PAPER_RAMPS_BLOCK[theme]
  if (!ramp) return

  const [inkR, inkG, inkB] = ramp.ink
  const [paperR, paperG, paperB] = ramp.paper
  const { chroma } = ramp

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]

    const lum = luminanceBlock(r, g, b)

    /* Base tone: the page's own ink/paper ramp at this luminance. */
    const baseR = inkR + (paperR - inkR) * lum
    const baseG = inkG + (paperG - inkG) * lum
    const baseB = inkB + (paperB - inkB) * lum

    /* Then reintroduce the pixel's own colour deviation, so a red heading stays
       red instead of collapsing onto the ramp. Deviation is measured against
       the pixel's own luminance in the source, which is why a neutral grey
       contributes nothing here and text stays exactly on the ramp. */
    const deviationR = r - lum * 255
    const deviationG = g - lum * 255
    const deviationB = b - lum * 255

    data[index] = baseR + deviationR * chroma
    data[index + 1] = baseG + deviationG * chroma
    data[index + 2] = baseB + deviationB * chroma
  }
}

export function isPdfPaperThemeBlock(value: unknown): value is PdfPaperThemeBlock {
  return typeof value === 'string' && (PDF_PAPER_THEMES_BLOCK as readonly string[]).includes(value)
}

/* Persisted separately from the app theme on purpose: a reader who works in a
   dark UI at night may still want the page itself on paper, and the two
   preferences genuinely diverge. */
const PAPER_THEME_STORAGE_KEY_BLOCK = 'thinkspc:pdf-paper-theme'

export function readPdfPaperThemeBlock(): PdfPaperThemeBlock {
  if (typeof window === 'undefined') return 'original'
  try {
    const stored = window.localStorage.getItem(PAPER_THEME_STORAGE_KEY_BLOCK)
    return isPdfPaperThemeBlock(stored) ? stored : 'original'
  } catch {
    return 'original'
  }
}

export function writePdfPaperThemeBlock(theme: PdfPaperThemeBlock): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PAPER_THEME_STORAGE_KEY_BLOCK, theme)
  } catch {
    /* Private browsing or a full quota: the preference simply does not persist. */
  }
}
