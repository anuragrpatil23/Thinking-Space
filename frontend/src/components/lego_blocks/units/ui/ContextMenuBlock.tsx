import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface ContextMenuItemBlock {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  /* Renders a checkmark column across the whole menu. Callers used to fake
     this by prefixing labels with '✓  ' or padding spaces, which does not line
     up in a proportional font and indents every row whether ticked or not. */
  checked?: boolean
}

export interface ContextMenuSeparatorBlock {
  key: string
  kind: 'separator'
}

export type ContextMenuEntryBlock = ContextMenuItemBlock | ContextMenuSeparatorBlock

interface ContextMenuBlockProps {
  entries: ContextMenuEntryBlock[]
  position: { x: number; y: number }
  onClose: () => void
}

export default function ContextMenuBlock({ entries, position, onClose }: ContextMenuBlockProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) { onClose(); return }
      if (!menuRef.current?.contains(event.target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const menuWidth = 228
  const itemCount = entries.filter((e) => !('kind' in e)).length
  const sepCount = entries.filter((e) => 'kind' in e && e.kind === 'separator').length
  const estimatedHeight = itemCount * 28 + sepCount * 9 + 10
  const maxX = Math.max(8, window.innerWidth - menuWidth - 8)
  const maxY = Math.max(8, window.innerHeight - estimatedHeight - 8)
  const style = {
    left: `${Math.min(position.x, maxX)}px`,
    top: `${Math.min(position.y, maxY)}px`,
  }

  // Portalled to the body, always. `position: fixed` resolves against the
  // nearest CSS-transformed ancestor rather than the viewport, and this menu is
  // opened from panels that can sit on the canvas surface — which is both
  // transformed and scaled. Rendered in place, the menu takes viewport
  // coordinates and lands somewhere else entirely. The portal is what makes the
  // coordinates mean what they say.
  return createPortal(
    <div
      ref={menuRef}
      className="context-menu-surface fixed z-[90] min-w-[220px] rounded-lg border border-border/80 bg-background/95 p-[5px] backdrop-blur-xl"
      style={style}
      role="menu"
    >
      {entries.map((entry) => {
        if ('kind' in entry && entry.kind === 'separator') {
          return <div key={entry.key} className="context-menu-divider my-1 border-t border-border/70" />
        }
        const item = entry as ContextMenuItemBlock
        return (
          <button
            key={item.key}
            type="button"
            className={cn(
              'context-menu-item flex w-full appearance-none items-center rounded-[5px] px-2.5 py-[5px] text-left text-xs leading-4 select-none outline-none',
              item.disabled && 'cursor-not-allowed opacity-40',
              !item.disabled && !item.destructive && 'text-foreground',
              !item.disabled && item.destructive && 'text-destructive',
            )}
            onClick={() => { item.onClick(); onClose() }}
            onMouseDown={(e) => { if (!item.disabled) e.preventDefault() }}
            disabled={item.disabled}
            role="menuitem"
          >
            {entries.some((other) => 'checked' in other && other.checked !== undefined) && (
              <span className="mr-1.5 w-3 shrink-0 text-center">{item.checked ? '✓' : ''}</span>
            )}
            {item.label}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
