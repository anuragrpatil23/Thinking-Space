/* The pen and highlighter settings: colour, nib, and what each one means.

   One palette serves both tools. Annotation colours are read against printed
   text, so the set is chosen for that rather than for looking like a paint
   program: saturated enough to be unmistakable at a glance, light enough that
   a marker pass over body text stays readable underneath. Two readers'
   highlights on the same page should be distinguishable when they mean
   different things, which is the actual reason to offer more than one.

   Nibs are presets rather than a slider. A slider invites fiddling and gives
   the reader a decision they do not have an opinion about; three nibs cover
   underline, annotation and emphasis, which is the whole range in a book. */

export interface PdfMarkColorBlock {
  key: string
  label: string
  rgb: [number, number, number]
}

export const PDF_MARK_PALETTE_BLOCK: readonly PdfMarkColorBlock[] = [
  { key: 'yellow', label: 'Yellow', rgb: [250, 204, 21] },
  { key: 'green', label: 'Green', rgb: [34, 197, 94] },
  { key: 'blue', label: 'Blue', rgb: [59, 130, 246] },
  { key: 'pink', label: 'Pink', rgb: [236, 72, 153] },
  { key: 'red', label: 'Red', rgb: [220, 38, 38] },
  { key: 'ink', label: 'Ink', rgb: [32, 32, 36] },
]

/* What the Pencil does when it touches the page.

   There was no tool at first, on the reasoning that "a pen touching the page is
   unambiguous intent." It is not. A stylus dragged along a line of text means
   *highlight this* at least as often as *draw here*, and no heuristic separates
   them reliably — which is why Preview, Books, Notes and GoodNotes all resolve
   it with a tool picker rather than by guessing. Without one there was no way
   to highlight with the Pencil at all: dragging across a sentence drew a line
   through it and the reader had to switch to a finger to select. */
export type PdfPenToolBlock = 'pen' | 'highlighter'

export type PdfPenTypeBlock = 'pen' | 'marker'

export interface PdfPenPresetBlock {
  label: string
  /** Stroke width in PDF units. */
  thickness: number
  opacity: number
}

/* A marker is not just a fat pen: it is translucent, so overlapping strokes
   build up and the text underneath survives. That is why opacity belongs to
   the pen type rather than being its own control. */
export const PDF_PEN_PRESETS_BLOCK: Record<PdfPenTypeBlock, PdfPenPresetBlock> = {
  pen: { label: 'Pen', thickness: 1.6, opacity: 1 },
  marker: { label: 'Marker', thickness: 10, opacity: 0.35 },
}

export type PdfNibBlock = 'fine' | 'medium' | 'bold'

export const PDF_NIB_LABELS_BLOCK: Record<PdfNibBlock, string> = {
  fine: 'Fine',
  medium: 'Medium',
  bold: 'Bold',
}

const NIB_MULTIPLIERS_BLOCK: Record<PdfNibBlock, number> = {
  fine: 0.6,
  medium: 1,
  bold: 1.8,
}

export function resolvePdfStrokeThicknessBlock(penType: PdfPenTypeBlock, nib: PdfNibBlock): number {
  return Number((PDF_PEN_PRESETS_BLOCK[penType].thickness * NIB_MULTIPLIERS_BLOCK[nib]).toFixed(2))
}

export interface PdfMarkStyleBlock {
  penTool: PdfPenToolBlock
  penColorKey: string
  penType: PdfPenTypeBlock
  nib: PdfNibBlock
  highlightColorKey: string
}

export const DEFAULT_PDF_MARK_STYLE_BLOCK: PdfMarkStyleBlock = {
  penTool: 'pen',
  penColorKey: 'red',
  penType: 'pen',
  nib: 'medium',
  highlightColorKey: 'yellow',
}

export function resolvePdfMarkColorBlock(key: string): PdfMarkColorBlock {
  return PDF_MARK_PALETTE_BLOCK.find((color) => color.key === key) ?? PDF_MARK_PALETTE_BLOCK[0]
}

const MARK_STYLE_STORAGE_KEY_BLOCK = 'thinkspc:pdf-mark-style'

/* Field-by-field validation rather than a cast: the value survives app
   upgrades, and a palette key that no longer exists would otherwise produce an
   undefined colour deep inside the render path. */
export function readPdfMarkStyleBlock(): PdfMarkStyleBlock {
  if (typeof window === 'undefined') return DEFAULT_PDF_MARK_STYLE_BLOCK
  try {
    const raw = window.localStorage.getItem(MARK_STYLE_STORAGE_KEY_BLOCK)
    if (!raw) return DEFAULT_PDF_MARK_STYLE_BLOCK
    const parsed = JSON.parse(raw) as Partial<PdfMarkStyleBlock>
    return {
      penTool: parsed.penTool === 'highlighter' || parsed.penTool === 'pen'
        ? parsed.penTool
        : DEFAULT_PDF_MARK_STYLE_BLOCK.penTool,
      penColorKey: PDF_MARK_PALETTE_BLOCK.some((c) => c.key === parsed.penColorKey)
        ? parsed.penColorKey as string
        : DEFAULT_PDF_MARK_STYLE_BLOCK.penColorKey,
      highlightColorKey: PDF_MARK_PALETTE_BLOCK.some((c) => c.key === parsed.highlightColorKey)
        ? parsed.highlightColorKey as string
        : DEFAULT_PDF_MARK_STYLE_BLOCK.highlightColorKey,
      penType: parsed.penType === 'marker' || parsed.penType === 'pen'
        ? parsed.penType
        : DEFAULT_PDF_MARK_STYLE_BLOCK.penType,
      nib: parsed.nib === 'fine' || parsed.nib === 'medium' || parsed.nib === 'bold'
        ? parsed.nib
        : DEFAULT_PDF_MARK_STYLE_BLOCK.nib,
    }
  } catch {
    return DEFAULT_PDF_MARK_STYLE_BLOCK
  }
}

export function writePdfMarkStyleBlock(style: PdfMarkStyleBlock): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MARK_STYLE_STORAGE_KEY_BLOCK, JSON.stringify(style))
  } catch {
    /* Private browsing or a full quota: the preference just does not persist. */
  }
}
