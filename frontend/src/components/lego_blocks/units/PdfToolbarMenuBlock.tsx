import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { cn } from '@/lib/utils'

/* One dropdown for the whole PDF toolbar.

   It exists so the toolbar's controls are literally the same component rather
   than merely similar ones. The first version mixed a native `<select>`, a
   shadcn `Button`, a borderless ghost icon and a bespoke trigger — four
   primitives with three heights, two corner radii and two chevron glyphs,
   sitting side by side. A native select in particular can never match, since
   its control is drawn by the platform.

   Trigger is `Button variant="ghost" size="sm"` — the same call every other
   toolbar control makes — so height, radius, focus ring and press animation
   come from one place and stay aligned when that place changes. */
export default function PdfToolbarMenuBlock({
  label,
  entries,
  title,
  active = false,
}: {
  label: ReactNode
  entries: ContextMenuEntryBlock[]
  title: string
  active?: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  /* ContextMenuBlock closes on any outside pointerdown, including one on this
     button, so without suppression the click would reopen it immediately. */
  const suppressReopenRef = useRef(false)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        /* Chromeless at rest: a reading toolbar is a row of labels, not a row
           of boxed controls. The transparent border is load-bearing — it holds
           the button's box constant so hover and open states change colour
           only. An earlier version swapped between bordered and borderless
           variants, which resized the button by 2px on press and made the whole
           toolbar twitch. State must never change an element's box. */
        variant="ghost"
        size="sm"
        className={cn(
          /* While the menu is open the button already reads as active, so the
             focus ring only adds a heavy offset outline on top of it. Kept for
             the closed state, where it is the only keyboard affordance. */
          '[&[aria-expanded=true]]:ring-0 [&[aria-expanded=true]]:ring-offset-0 [&[aria-expanded=true]]:outline-none',
          'border border-transparent',
          (active || menuPosition !== null) && 'bg-muted text-foreground',
        )}
        title={title}
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
      >
        {label}
        <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
      </Button>

      {menuPosition && (
        <ContextMenuBlock
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          entries={entries}
        />
      )}
    </>
  )
}
