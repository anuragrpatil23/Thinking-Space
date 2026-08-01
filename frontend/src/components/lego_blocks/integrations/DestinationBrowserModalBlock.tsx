import { useEffect, useMemo, useState } from 'react'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/lego_blocks/units/ui/button'
import FolderTreePickerBlock from '@/components/lego_blocks/integrations/FolderTreePickerBlock'
import {
  DESTINATION_RECENTS_KEY_BLOCK,
  readJsonStorageBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'

// The destination browser. One centred modal replacing two things (2026-07-31):
// the folder builder that used to unfold inside the settings popover, and the
// separate "Add Quick Destination" dialog. They were the same task — choose a
// folder, optionally remember it — split across two surfaces with two different
// pickers.
//
// Modal rather than popover because a tree needs vertical room; hanging one off
// the title bar puts a scroller inside a scroller.

const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70'

export interface DestinationBrowserModalBlockProps {
  open: boolean
  onClose: () => void
  /** Destination in effect when the modal opened. */
  value: string
  /** Fired on confirm, never on every tree click — browsing is not committing. */
  onConfirm: (path: string) => void
  mostUsed: Array<{ path: string; count: number }>
  /** Saves the chosen folder as a labelled chip. Returns false if rejected. */
  onSaveQuickDestination: (label: string, segments: string[]) => boolean
}

export default function DestinationBrowserModalBlock({
  open,
  onClose,
  value,
  onConfirm,
  mostUsed,
  onSaveQuickDestination,
}: DestinationBrowserModalBlockProps) {
  const [draftPath, setDraftPath] = useState(value)
  const [shortcutLabel, setShortcutLabel] = useState('')
  const [savedLabel, setSavedLabel] = useState('')

  // Re-seed each time it opens: the modal is a scratchpad, and reopening it
  // should show where the note currently points, not last visit's browsing.
  useEffect(() => {
    if (!open) return
    setDraftPath(value)
    setShortcutLabel('')
    setSavedLabel('')
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const recents = useMemo(() => {
    if (!open) return []
    return readJsonStorageBlock<string[][]>(DESTINATION_RECENTS_KEY_BLOCK, [])
      .map(segments => (Array.isArray(segments) ? segments.filter(Boolean).join('/') : ''))
      .filter(Boolean)
      .slice(0, 6)
  }, [open])

  if (!open) return null

  const handleSaveShortcut = () => {
    const label = shortcutLabel.trim()
    if (!label || !draftPath) return
    if (onSaveQuickDestination(label, draftPath.split('/').filter(Boolean))) {
      setSavedLabel(label)
      setShortcutLabel('')
    }
  }

  const jumpList = (
    title: string,
    paths: string[],
  ) => paths.length > 0 && (
    <div className="space-y-1.5">
      <div className={LABEL_CLASS}>{title}</div>
      <div className="space-y-1">
        {paths.map((path) => (
          <button
            key={`${title}-${path}`}
            type="button"
            onClick={() => setDraftPath(path)}
            className={cn(
              'ltm-motion-fast flex w-full items-center rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
              path === draftPath
                ? 'border-foreground/40 bg-muted text-foreground'
                : 'border-border/60 bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            <span className="min-w-0 break-all">{path}</span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="ltm-animate-fade-in flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Choose destination</h2>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {draftPath || 'No folder selected'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 gap-4 p-4 md:grid-cols-[1.4fr_1fr]">
            <FolderTreePickerBlock value={draftPath} onChange={setDraftPath} />

            <div className="min-w-0 space-y-4 overflow-auto">
              {jumpList('Most used', mostUsed.map(entry => entry.path))}
              {jumpList('Recent', recents)}

              <div className="space-y-1.5">
                <div className={LABEL_CLASS}>Save as quick destination</div>
                <div className="flex gap-1.5">
                  <input
                    value={shortcutLabel}
                    onChange={(event) => setShortcutLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); handleSaveShortcut() }
                    }}
                    placeholder="Chip name"
                    aria-label="Quick destination name"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors focus:border-foreground/30"
                  />
                  <button
                    type="button"
                    onClick={handleSaveShortcut}
                    disabled={!shortcutLabel.trim() || !draftPath}
                    className="ltm-motion-fast inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <Star className="h-3 w-3" />
                    Save
                  </button>
                </div>
                {savedLabel && (
                  <p className="text-[11px] text-muted-foreground">
                    Saved “{savedLabel}” — it's a chip in the destination row now.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!draftPath}
              onClick={() => { onConfirm(draftPath); onClose() }}
            >
              Use this folder
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
