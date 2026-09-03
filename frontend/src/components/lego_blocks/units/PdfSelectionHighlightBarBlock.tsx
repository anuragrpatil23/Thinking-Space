import { createPortal } from 'react-dom'
import { PDF_MARK_PALETTE_BLOCK } from '@/services/lego_blocks/units/pdfMarkStyleBlock'

/* The highlight control, shown only when there is text selected.

   This replaces a "Highlight" mode toggle, which was wrong twice over. It made
   you arm a tool before selecting, so the obvious gesture — select the sentence
   you care about — did nothing unless you had armed it earlier; and it put the
   highlighter colour in a settings panel, far from the moment you actually have
   an opinion about which colour this passage should be.

   Selecting text and being offered colours is what Preview and Books both do,
   and it needs no mode at all: the selection *is* the intent. */
export default function PdfSelectionHighlightBarBlock({
  rect,
  boundsTop,
  onPick,
}: {
  /** Selection bounds in client coordinates. */
  rect: DOMRect
  /** Top of the reading area, in client coordinates. */
  boundsTop: number
  onPick: (colorKey: string) => void
}) {
  const BAR_HEIGHT = 44
  const BAR_WIDTH = 236

  /* Above the selection by preference, below it when there is no room —
     measured against the top of the reading area rather than the window, or a
     selection on the first visible line puts the bar on top of the toolbar. */
  const preferredTop = rect.top - BAR_HEIGHT - 10
  const top = preferredTop < boundsTop + 8 ? rect.bottom + 10 : preferredTop
  const left = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - BAR_WIDTH / 2,
      window.innerWidth - BAR_WIDTH - 8,
    ),
  )

  return createPortal(
    <div
      className="fixed z-[95] flex items-center gap-1.5 rounded-full border border-border/80 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-xl"
      style={{ top, left, width: BAR_WIDTH, height: BAR_HEIGHT }}
      /* Keep the selection alive: a pointerdown that reaches the document
         collapses it, and then there is nothing left to highlight. */
      onPointerDown={(event) => event.preventDefault()}
    >
      {PDF_MARK_PALETTE_BLOCK.map((color) => (
        <button
          key={color.key}
          type="button"
          title={`Highlight ${color.label.toLowerCase()}`}
          aria-label={`Highlight ${color.label.toLowerCase()}`}
          onClick={() => onPick(color.key)}
          className="h-6 w-6 rounded-full ring-1 ring-inset ring-black/15 transition-transform hover:scale-110"
          style={{ background: `rgb(${color.rgb.join(' ')})` }}
        />
      ))}
    </div>,
    document.body,
  )
}
