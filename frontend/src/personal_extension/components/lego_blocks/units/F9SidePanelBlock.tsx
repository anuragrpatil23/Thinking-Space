// A panel that slides in from the right over the F9 page, for something to
// look at beside where you are (a company's row of Drops), without leaving it.
// Escape, the close button or a click on the dimmed page closes it.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function F9SidePanelBlock({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/20 dark:bg-black/40" />
      <div className="relative flex h-full w-[min(1180px,94vw)] flex-col bg-[#F5F5F7] shadow-[0_0_60px_-10px_rgba(0,0,0,0.4)] dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-3.5 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
            {subtitle && <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
