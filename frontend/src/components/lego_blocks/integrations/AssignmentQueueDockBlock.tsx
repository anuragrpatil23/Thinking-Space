import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Inbox, Loader2 } from 'lucide-react'
import AssignmentQueueBlock from '@/components/lego_blocks/integrations/AssignmentQueueBlock'
import {
  getAssignmentQueueOrch,
  type AssignmentQueue,
} from '@/services/orchestrators/assignmentQueueOrch'
import { cn } from '@/lib/utils'

/**
 * The queue's entry point: a count in the organizer's chrome, and the panel it
 * opens.
 *
 * Why it is not a view in the toggle row beside it: Index, Lineage, List and
 * Canvas are four lenses onto the same thing — your undertakings. The queue is
 * not a lens, it is a chore, and a chore behind a tab is a chore you have to
 * remember to visit. ASSIGNMENT.md's whole premise is that involvement is
 * expensive, so the queue announces itself where you already are and opens into
 * a focus mode you leave with Escape.
 *
 * It lives in chrome rather than on a project page because it is deliberately
 * **unscoped**: the queue's job is that no chain goes unjudged, and chains land
 * under project keys nothing has adopted yet. A per-project count would hide
 * exactly the backlog this feature exists to drain. It is chrome for the
 * organizer only, though — this renders inside the organizer's own header, so
 * it cannot follow you into tabs where a chain assignment means nothing.
 *
 * It owns the one queue read and hands it down, so the number in the chrome and
 * the cards in the panel can never disagree about how much work is left.
 */

export default function AssignmentQueueDockBlock() {
  const [open, setOpen] = useState(false)
  const [queue, setQueue] = useState<AssignmentQueue | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setQueue(await getAssignmentQueueOrch())
    } catch {
      // A queue that cannot be read must not take the organizer down with it.
      // The badge simply does not appear.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const pending = queue?.items.length ?? 0
  const undisposed = queue?.undisposedCount ?? 0

  // Nothing proposed *and* nothing owing means there is genuinely nothing to
  // say — no empty badge, no zero to look at.
  if (!loading && pending === 0 && undisposed === 0 && !open) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
          pending > 0
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
            : 'border-border text-muted-foreground hover:bg-muted',
        )}
        title={
          pending > 0
            ? `${pending} to decide · ${undisposed} chains unsorted`
            : `${undisposed} chains unsorted, nothing suggested yet`
        }
      >
        {loading && !queue ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Inbox className="h-3.5 w-3.5" />
        )}
        {pending > 0 ? (
          <span>
            <span className="font-semibold tabular-nums">{pending}</span> to decide
          </span>
        ) : (
          <span className="tabular-nums">{undisposed}</span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8">
            <div
              className="absolute inset-0 bg-background/70 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="relative flex h-full max-h-[46rem] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
              <AssignmentQueueBlock
                queue={queue}
                loading={loading}
                onReload={load}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
