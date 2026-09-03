import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, PenLine } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  PDF_MARK_PALETTE_BLOCK,
  PDF_NIB_LABELS_BLOCK,
  PDF_PEN_PRESETS_BLOCK,
  resolvePdfMarkColorBlock,
  type PdfMarkStyleBlock,
  type PdfNibBlock,
  type PdfPenToolBlock,
  type PdfPenTypeBlock,
} from '@/services/lego_blocks/units/pdfMarkStyleBlock'
import { cn } from '@/lib/utils'

/* Pen and highlighter settings.

   A panel rather than a `ContextMenuBlock`, because these are colours: a list
   of colour *names* makes you read a word and imagine the result, while six
   swatches let you point at the one you want. That is the one place in this
   toolbar where matching the menu primitive would cost more than it buys.

   Pen and highlighter share one panel because they share one palette and one
   question ("what does this mark look like"), and because two more toolbar
   buttons is what this toolbar least needs. */
export default function PdfMarkSettingsBlock({
  style,
  onChange,
}: {
  style: PdfMarkStyleBlock
  onChange: (next: PdfMarkStyleBlock) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const suppressReopenRef = useRef(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!position) return
    const onPointerDownBlock = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) { setPosition(null); return }
      if (!panelRef.current?.contains(event.target)) setPosition(null)
    }
    const onKeyDownBlock = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPosition(null)
    }
    window.addEventListener('pointerdown', onPointerDownBlock)
    window.addEventListener('keydown', onKeyDownBlock)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownBlock)
      window.removeEventListener('keydown', onKeyDownBlock)
    }
  }, [position])

  const penColor = resolvePdfMarkColorBlock(style.penColorKey)

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        /* Chromeless, with a transparent border holding the box constant —
           see PdfToolbarMenuBlock. */
        variant="ghost"
        size="sm"
        className={cn(
          'border border-transparent',
          '[&[aria-expanded=true]]:ring-0 [&[aria-expanded=true]]:ring-offset-0 [&[aria-expanded=true]]:outline-none',
          position && 'bg-muted text-foreground',
        )}
        title="Pen and highlighter"
        aria-haspopup="dialog"
        aria-expanded={position !== null}
        onPointerDown={() => { suppressReopenRef.current = position !== null }}
        onClick={() => {
          if (suppressReopenRef.current) {
            suppressReopenRef.current = false
            return
          }
          const rect = buttonRef.current?.getBoundingClientRect()
          if (!rect) return
          setPosition({ x: Math.max(8, rect.left), y: rect.bottom + 6 })
        }}
      >
        <PenLine className="mr-1.5 h-3.5 w-3.5" />
        {/* The current pen colour, so the toolbar answers "what will this draw"
            without opening anything. */}
        <span
          className="h-3 w-3 rounded-full ring-1 ring-black/20"
          style={{ background: `rgb(${penColor.rgb.join(' ')})` }}
        />
        <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
      </Button>

      {position && createPortal(
        <div
          ref={panelRef}
          /* Same surface as ContextMenuBlock. `bg-popover` is not a token in
             this app's theme, so it resolved to nothing and the panel rendered
             transparent over the page. */
          className="fixed z-[90] w-64 rounded-lg border border-border/80 bg-background/95 p-3 shadow-lg backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
          {/* What the Pencil does. There was no such control at first, on the
              reasoning that a stylus touching the page is unambiguous — it is
              not, and without this there was no way to highlight with the
              Pencil at all. */}
          <PdfMarkSectionLabelBlock>Apple Pencil</PdfMarkSectionLabelBlock>
          <div className="grid grid-cols-2 gap-1.5">
            {(['pen', 'highlighter'] as PdfPenToolBlock[]).map((penTool) => (
              <button
                key={penTool}
                type="button"
                onClick={() => onChange({ ...style, penTool })}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs transition-colors',
                  style.penTool === penTool
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:bg-muted',
                )}
              >
                {penTool === 'pen' ? 'Draw' : 'Highlight'}
              </button>
            ))}
          </div>

          <div className="my-3 h-px bg-border" />

          <PdfMarkSectionLabelBlock>
            {style.penTool === 'highlighter' ? 'Highlight colour' : 'Pen'}
          </PdfMarkSectionLabelBlock>
          <PdfSwatchRowBlock
            selectedKey={style.penTool === 'highlighter' ? style.highlightColorKey : style.penColorKey}
            onSelect={(key) => onChange(style.penTool === 'highlighter'
              ? { ...style, highlightColorKey: key }
              : { ...style, penColorKey: key })}
          />

          {style.penTool === 'pen' && (
          <>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {(Object.keys(PDF_PEN_PRESETS_BLOCK) as PdfPenTypeBlock[]).map((penType) => (
              <button
                key={penType}
                type="button"
                onClick={() => onChange({ ...style, penType })}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs transition-colors',
                  style.penType === penType
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:bg-muted',
                )}
              >
                {PDF_PEN_PRESETS_BLOCK[penType].label}
              </button>
            ))}
          </div>

          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {(Object.keys(PDF_NIB_LABELS_BLOCK) as PdfNibBlock[]).map((nib) => (
              <button
                key={nib}
                type="button"
                onClick={() => onChange({ ...style, nib })}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs transition-colors',
                  style.nib === nib
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:bg-muted',
                )}
              >
                {PDF_NIB_LABELS_BLOCK[nib]}
              </button>
            ))}
          </div>
          </>
          )}

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {style.penTool === 'highlighter'
              ? 'Drag the Pencil across text to highlight it. A finger still scrolls.'
              : 'Draw anywhere with the Pencil. A finger still scrolls.'}
            {' '}Selecting text with a finger always offers highlight colours.
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}

function PdfMarkSectionLabelBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function PdfSwatchRowBlock({
  selectedKey,
  onSelect,
}: {
  selectedKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {PDF_MARK_PALETTE_BLOCK.map((color) => (
        <button
          key={color.key}
          type="button"
          title={color.label}
          aria-label={color.label}
          aria-pressed={selectedKey === color.key}
          onClick={() => onSelect(color.key)}
          className={cn(
            'h-7 w-7 rounded-full ring-1 ring-inset ring-black/15 transition-transform',
            'hover:scale-110',
            /* Selection is an outer ring, not a checkmark: a tick on top of a
               swatch obscures the colour it is confirming. */
            selectedKey === color.key && 'ring-2 ring-offset-2 ring-offset-background ring-primary',
          )}
          style={{ background: `rgb(${color.rgb.join(' ')})` }}
        />
      ))}
    </div>
  )
}
