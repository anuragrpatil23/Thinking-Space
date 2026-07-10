import { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { cn } from '@/lib/utils'

interface OverflowMenuButtonBlockProps {
  entries: ContextMenuEntryBlock[]
  title?: string
  className?: string
}

/**
 * Three-dot overflow button that opens a ContextMenuBlock anchored below it,
 * right-aligned to the button. Shares the entry shape and visual style of the
 * explorer right-click menu.
 */
export default function OverflowMenuButtonBlock({
  entries,
  title = 'More actions',
  className,
}: OverflowMenuButtonBlockProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // ContextMenuBlock closes itself on any outside pointerdown — including one
  // on this button — so without suppression the follow-up click would reopen
  // the menu immediately, making the button impossible to toggle closed.
  const suppressReopenRef = useRef(false)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={title}
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
          setMenuPosition({ x: Math.max(8, rect.right - 228), y: rect.bottom + 6 })
        }}
        className={cn(
          'rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          menuPosition !== null && 'bg-muted text-foreground',
          className,
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menuPosition && (
        <ContextMenuBlock
          entries={entries}
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
        />
      )}
    </>
  )
}
