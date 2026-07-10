import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronLeft } from 'lucide-react'
import { getVisibleToolsSubtabs, TOOLS_SUBTABS } from '@/components/lego_blocks/units/toolsSubtabsBlock'

interface ToolsBreadcrumbHeaderBlockProps {
  // id of the current subtab from TOOLS_SUBTABS (e.g. 'ai', 'web')
  currentId: string
}

// Sidebar header for full-screen tool surfaces (AI, Web) that don't show the
// Tools shell list. Renders "Tools › <current>" where "Tools" opens a dropdown
// to jump between sibling tools. The menu is portaled to <body> so it isn't
// clipped by the sidebar's overflow.
export default function ToolsBreadcrumbHeaderBlock({ currentId }: ToolsBreadcrumbHeaderBlockProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => setOpen(false)

  const toggleMenu = () => {
    if (open) {
      closeMenu()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 6, left: rect.left })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    // Position is captured on open; dismiss if the layout shifts under it.
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [open])

  const current = TOOLS_SUBTABS.find(tab => tab.id === currentId)
  const siblings = getVisibleToolsSubtabs()

  return (
    <div className="mb-2 mt-4 px-4">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <button
          type="button"
          onClick={() => navigate('/tools')}
          aria-label="Back to Tools"
          title="Back to Tools"
          className="ltm-motion-fast -ml-1 flex h-5 w-5 items-center justify-center rounded-full outline-none transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          className="ltm-motion-fast rounded-full border border-muted-foreground/20 px-2 py-0.5 outline-none transition-colors hover:border-muted-foreground/40 hover:text-foreground focus:outline-none focus-visible:outline-none"
        >
          Tools
        </button>
        <span className={`inline-block opacity-40 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="text-foreground">{current?.label ?? ''}</span>
      </div>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="z-[1000] min-w-[200px] overflow-hidden rounded-xl border border-border/60 bg-background py-1 shadow-xl"
        >
          {siblings.map((tab) => {
            const Icon = tab.icon
            const active = tab.id === currentId
            return (
              <button
                key={tab.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  if (!active) navigate(tab.to)
                }}
                className={`ltm-motion-fast flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{tab.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
