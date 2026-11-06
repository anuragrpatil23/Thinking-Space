import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useResizableSheetBlock } from '@/components/lego_blocks/hooks/useResizableSheetBlock'
import SheetResizeHandleBlock from '@/components/lego_blocks/units/SheetResizeHandleBlock'

// The slide-over frame every right-hand sheet is built on: the scrim, the
// resizable panel, its surface and layer, and Esc to close. What goes inside
// (a header, a scrolling body, a pinned footer) is the sheet's own.
//
// It exists because each sheet used to copy this, and the copies drifted: one
// scrim was lighter, one surface ignored the card token, one Esc only worked
// with focus inside, and sheets on z-50 sat under drawers on z-121. Change the
// frame here and every sheet changes with it.
//
// The panel is a flex column that does not scroll itself. A sheet that is one
// reading column wraps its content in a `min-h-0 flex-1 overflow-auto` body
// (DrawerShellBlock does); a form gives its body that and pins its footer.

export function SheetFrameBlock({
  sheetKey,
  defaultWidth,
  minWidth,
  onClose,
  ariaLabel,
  as: Panel = 'div',
  onSubmit,
  className,
  children,
}: {
  /** Where the dragged width is remembered. */
  sheetKey: string
  defaultWidth: number
  minWidth?: number
  onClose: () => void
  ariaLabel: string
  /** A form sheet makes the panel itself the form, so its pinned footer can submit. */
  as?: 'div' | 'form'
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
  className?: string
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target
      if (target instanceof Element && target.closest('[data-prevent-sheet-escape="true"]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sheet = useResizableSheetBlock(sheetKey, defaultWidth, minWidth ? { minWidth } : undefined)

  return createPortal(
    <>
      <div className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <SheetResizeHandleBlock {...sheet.handle} />
      {/* `bg-card`, not `bg-background`: the page background is a faint grey
          that the panel was inheriting, so a sheet read as a dimmer copy of the
          page instead of a sheet lifted off it. */}
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onSubmit={onSubmit as never}
        data-ltm-sheet=""
        style={{ width: `min(96vw, ${sheet.width}px)` }}
        className={cn(
          'fixed inset-y-0 right-0 z-[121] flex flex-col overflow-hidden border-l border-black/[0.06] bg-card pt-[max(env(safe-area-inset-top),3.5rem)] shadow-[0_8px_40px_rgba(20,20,24,0.14)] animate-slide-in dark:border-white/[0.06] sm:pt-0',
          sheet.resizing && 'select-none',
          className,
        )}
      >
        {children}
      </Panel>
    </>,
    document.body,
  )
}

/** The close button every sheet's header ends with. */
export function SheetCloseButtonBlock({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className={cn('rounded-md p-1 text-muted-foreground hover:bg-muted', className)}
      aria-label="Close"
    >
      <X className="h-5 w-5" />
    </button>
  )
}
