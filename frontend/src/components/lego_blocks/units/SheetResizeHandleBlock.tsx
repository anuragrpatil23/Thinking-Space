import type { PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * The grab strip on a slide-over's left edge; pair with useResizableSheetBlock.
 * Fixed to the window at the sheet's edge, so it works whether or not the
 * sheet itself scrolls. Hidden on phones, where sheets are full width.
 */
export default function SheetResizeHandleBlock({ width, onPointerDown, onDoubleClick, resizing }: {
  width: number
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onDoubleClick: () => void
  resizing: boolean
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel (double-click to widen)"
      title="Drag to resize · double-click to widen"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{ right: width - 4 }}
      className={cn(
        'fixed inset-y-0 z-[200] hidden w-2 cursor-col-resize sm:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-sky-500/60',
        resizing && 'after:bg-sky-500/80',
      )}
    />
  )
}
