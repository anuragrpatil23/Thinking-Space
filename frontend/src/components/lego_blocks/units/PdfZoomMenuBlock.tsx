import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import ContextMenuBlock from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import type { PdfZoomModeBlock } from '@/services/lego_blocks/units/pdfViewportBlock'
import { cn } from '@/lib/utils'

/* Every zoom control behind one button that reads the current zoom.

   Six always-visible controls (fit width, fit page, 100%, −, %, +) is a
   desktop-app habit, and in this reader it wrapped the toolbar onto a second
   row — spending a strip of a reading screen on controls that are used once a
   session, next to a pinch gesture that does the same job continuously. */
export default function PdfZoomMenuBlock({
  zoomMode,
  displayedScale,
  onApplyZoomMode,
  onAdjustScale,
  className,
}: {
  zoomMode: PdfZoomModeBlock
  displayedScale: number
  onApplyZoomMode: (mode: PdfZoomModeBlock) => void
  onAdjustScale: (delta: number) => void
  className?: string
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  /* ContextMenuBlock closes on any outside pointerdown, including one on this
     button, so without suppression the click would reopen it immediately. */
  const suppressReopenRef = useRef(false)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

  const closeBlock = () => setMenuPosition(null)
  const runBlock = (action: () => void) => () => { action(); closeBlock() }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Zoom"
        aria-haspopup="menu"
        aria-expanded={menuPosition !== null}
        onPointerDown={() => { suppressReopenRef.current = menuPosition !== null }}
        onClick={() => {
          if (suppressReopenRef.current) {
            suppressReopenRef.current = false
            return
          }
          const rect = buttonRef.current?.getBoundingClientRect()
          if (!rect) return
          setMenuPosition({ x: Math.max(8, rect.left), y: rect.bottom + 6 })
        }}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2.5',
          'text-xs tabular-nums text-foreground transition-colors hover:bg-muted',
          menuPosition !== null && 'bg-muted',
          className,
        )}
      >
        {(displayedScale * 100).toFixed(0)}%
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {menuPosition && (
        <ContextMenuBlock
          position={menuPosition}
          onClose={closeBlock}
          entries={[
            {
              key: 'fit-width',
              label: zoomMode === 'fit-width' ? '✓ Fit width' : 'Fit width',
              onClick: runBlock(() => onApplyZoomMode('fit-width')),
            },
            {
              key: 'fit-page',
              label: zoomMode === 'fit-page' ? '✓ Fit page  ⌘9' : 'Fit page  ⌘9',
              onClick: runBlock(() => onApplyZoomMode('fit-page')),
            },
            {
              key: 'actual',
              label: zoomMode === 'actual' ? '✓ Actual size  ⌘0' : 'Actual size  ⌘0',
              onClick: runBlock(() => onApplyZoomMode('actual')),
            },
            { key: 'sep', kind: 'separator' },
            /* Stepping leaves the menu open: zooming in is usually more than
               one step, and reopening the menu each time is the whole reason
               these were on the toolbar to begin with. */
            { key: 'in', label: 'Zoom in  ⌘+', onClick: () => onAdjustScale(0.1) },
            { key: 'out', label: 'Zoom out  ⌘−', onClick: () => onAdjustScale(-0.1) },
          ]}
        />
      )}
    </>
  )
}
