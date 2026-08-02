import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Inbox, Loader2, SkipForward, Trash2, Undo2 } from 'lucide-react'
import {
  disposeChainsOrch,
  getAssignmentQueueOrch,
  type AssignmentQueue,
  type QueueItem,
} from '@/services/orchestrators/assignmentQueueOrch'
import { listUndertakingTitlesOrch } from '@/services/orchestrators/aiActivityUndertakingOrch'
import {
  confidenceBandBlock,
  type ProposalTargetBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'

/**
 * The assignment queue — the surface the whole feature is judged by.
 *
 * The design constraint is stated plainly in ASSIGNMENT.md and it is not about
 * aesthetics: "the moment I am involved things slow down." So everything here
 * is subordinate to how fast one person can clear a backlog.
 *
 * - **One row at a time, not a table.** A table invites reading; this invites
 *   deciding. The focused proposal shows its target, its reason and its chains
 *   in full, and the rest of the queue is a thin list you never have to read.
 * - **Grouped by proposal.** One keystroke disposes of every chain that was
 *   obviously the same piece of work. Six chains, one decision.
 * - **Confidence descending.** Abandoning halfway leaves the most good done.
 * - **Skip is free.** No penalty, no re-prompt, no "are you sure" — a queue
 *   that punishes skipping is a queue that gets closed instead.
 * - **Every disposition is logged**, including the retargets. That log is what
 *   eventually earns a confidence band the right to auto-apply, so it is not
 *   telemetry — it is the feature's own training data.
 *
 * Mint is deliberately the slowest path here (it types a title), because a key
 * is a permanent address and the friction is the point.
 */

interface Props {
  /** Omit to sweep every project that has chains, unadopted keys included. */
  projectId?: string
}

interface UndoEntry {
  chainIds: string[]
  projectId: string
  undertakingKey: string
  label: string
}

function bandToneBlock(confidence: number): string {
  switch (confidenceBandBlock(confidence)) {
    case 'high':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'medium':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-slate-500 dark:text-slate-400'
  }
}

export default function AssignmentQueueBlock({ projectId }: Props) {
  const [queue, setQueue] = useState<AssignmentQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retargeting, setRetargeting] = useState(false)
  const [retargetQuery, setRetargetQuery] = useState('')
  const [titles, setTitles] = useState<Array<{ key: string; title: string }>>([])
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  const retargetInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setQueue(await getAssignmentQueueOrch(projectId))
      setCursor(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const items = queue?.items ?? []
  const current: QueueItem | undefined = items[cursor]

  // Titles are loaded for the project the *focused* item belongs to, not the
  // page's project: with no projectId the queue spans projects, and offering
  // F9's undertakings while retargeting a Thinking-Space chain would let one
  // keystroke stamp across a boundary the row does not show.
  useEffect(() => {
    if (!current) return
    let alive = true
    void listUndertakingTitlesOrch(current.group.projectId).then(list => {
      if (alive) setTitles(list)
    })
    return () => { alive = false }
  }, [current?.group.projectId])

  useEffect(() => {
    if (retargeting) retargetInputRef.current?.focus()
  }, [retargeting])

  const dispose = useCallback(
    async (target: ProposalTargetBlock | null, label: string) => {
      if (!current || busy) return
      setBusy(true)
      setError(null)
      try {
        const result = await disposeChainsOrch({
          chainIds: current.chains.map(chain => chain.chainId),
          projectId: current.group.projectId,
          proposed: current.group.target,
          confidence: current.group.confidence,
          target,
        })
        if (result.undertaking && result.stamped.length) {
          setUndo({
            chainIds: result.stamped,
            projectId: current.group.projectId,
            undertakingKey: result.undertaking,
            label,
          })
        }
        // Reload rather than splice the item out locally: a disposition can
        // mint an undertaking or move a chain, and a hand-maintained copy of
        // the queue would quietly disagree with the vault after the first one.
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        setRetargeting(false)
        setRetargetQuery('')
      }
    },
    [current, busy, load],
  )

  const undoLast = useCallback(async () => {
    if (!undo || busy) return
    setBusy(true)
    try {
      const { detachChainOrch } = await import('@/services/orchestrators/assignmentQueueOrch')
      for (const chainId of undo.chainIds) {
        await detachChainOrch(undo.projectId, chainId, undo.undertakingKey)
      }
      setUndo(null)
      await load()
    } finally {
      setBusy(false)
    }
  }, [undo, busy, load])

  const matches = useMemo(() => {
    const q = retargetQuery.trim().toLowerCase()
    const pool = titles.filter(entry => entry.key !== (current?.group.target as { key?: string })?.key)
    if (!q) return pool.slice(0, 8)
    return pool
      .filter(entry => entry.title.toLowerCase().includes(q) || entry.key.toLowerCase().includes(q))
      .slice(0, 8)
  }, [titles, retargetQuery, current])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (busy) return
      const tag = (event.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      if (retargeting) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setRetargeting(false)
          setRetargetQuery('')
        }
        return
      }
      if (typing) return

      switch (event.key) {
        case 'a':
          event.preventDefault()
          if (current) void dispose(current.group.target, 'accepted')
          break
        case 'r':
          event.preventDefault()
          if (current) setRetargeting(true)
          break
        case 'b':
          event.preventDefault()
          if (current) void dispose({ kind: 'bucket' }, 'bucketed')
          break
        case 's':
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          setCursor(index => Math.min(index + 1, Math.max(items.length - 1, 0)))
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          setCursor(index => Math.max(index - 1, 0))
          break
        case 'u':
          event.preventDefault()
          void undoLast()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items.length, busy, retargeting, dispose, undoLast])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
      </div>
    )
  }

  const undisposed = queue?.undisposedCount ?? 0
  const unproposed = queue?.unproposed.length ?? 0

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <header className="mb-5 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Assignment queue</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {undisposed} chain{undisposed === 1 ? '' : 's'} still owe a disposition
            {unproposed > 0 && <> · {unproposed} awaiting a proposal</>}
          </p>
        </div>
        {undo && (
          <button
            onClick={() => void undoLast()}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo {undo.label} <kbd className="ml-1 opacity-60">u</kbd>
          </button>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* A proposal naming a chain that does not exist produces an empty queue
          and no reason for it. Loud, not silent — this is a proposing pass with
          a bug, and it must not read as "nothing to do". */}
      {(queue?.orphanedProposals.length ?? 0) > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {queue!.orphanedProposals.length} proposal
          {queue!.orphanedProposals.length === 1 ? '' : 's'} name a chain that does not exist — a
          proposing pass sent bad chain ids (
          {[...new Set(queue!.orphanedProposals.map(p => p.proposedBy))].join(', ')}).
        </div>
      )}

      {!current ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <Inbox className="mx-auto h-6 w-6 text-slate-400" />
          <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
            Nothing proposed right now.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unproposed > 0
              ? `${unproposed} chains are waiting on a proposing pass. Ask Kai to run one.`
              : 'Every chain has a disposition.'}
          </p>
        </div>
      ) : (
        <>
          <article className="rounded-lg border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                {current.group.projectId}
                {current.group.target.kind === 'new' && ' · would mint'}
                {current.group.target.kind === 'bucket' && ' · not an undertaking'}
              </span>
              <span className={`text-xs font-medium ${bandToneBlock(current.group.confidence)}`}>
                {Math.round(current.group.confidence * 100)}% confident
              </span>
            </div>

            <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50">
              {current.targetTitle}
            </h3>
            {current.group.proposals[0]?.rationale && (
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                {current.group.proposals[0].rationale}
              </p>
            )}

            <ul className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-700">
              {current.chains.map(chain => (
                <li key={chain.chainId} className="flex items-baseline gap-2 text-sm">
                  <ChevronRight className="h-3 w-3 shrink-0 translate-y-0.5 text-slate-400" />
                  <span className="truncate text-slate-700 dark:text-slate-200">{chain.title}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">
                    {chain.date} · {chain.activeMinutes}m
                  </span>
                </li>
              ))}
            </ul>

            {retargeting ? (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <input
                  ref={retargetInputRef}
                  value={retargetQuery}
                  onChange={event => setRetargetQuery(event.target.value)}
                  placeholder="Filter undertakings, or type a new title…"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <ul className="mt-2 space-y-1">
                  {matches.map(entry => (
                    <li key={entry.key}>
                      <button
                        onClick={() => void dispose({ kind: 'existing', key: entry.key }, 'retargeted')}
                        className="w-full truncate rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {entry.title}
                      </button>
                    </li>
                  ))}
                  {retargetQuery.trim() && (
                    <li>
                      {/* The mint. Last in the list and it costs a typed title,
                          because a key is a permanent address. */}
                      <button
                        onClick={() =>
                          void dispose({ kind: 'new', title: retargetQuery.trim() }, 'created')
                        }
                        className="w-full truncate rounded px-2 py-1 text-left text-sm font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950"
                      >
                        Create “{retargetQuery.trim()}”
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <ActionBlock icon={Check} label="Accept" hint="a" onClick={() => void dispose(current.group.target, 'accepted')} primary />
                <ActionBlock icon={ChevronRight} label="Retarget" hint="r" onClick={() => setRetargeting(true)} />
                <ActionBlock icon={Trash2} label="Not an undertaking" hint="b" onClick={() => void dispose({ kind: 'bucket' }, 'bucketed')} />
                <ActionBlock icon={SkipForward} label="Skip" hint="s" onClick={() => setCursor(i => Math.min(i + 1, items.length - 1))} />
                {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-slate-400" />}
              </div>
            )}
          </article>

          {items.length > 1 && (
            <ol className="mt-4 space-y-0.5">
              {items.map((item, index) => (
                <li key={`${item.group.projectId}:${item.group.targetId}`}>
                  <button
                    onClick={() => setCursor(index)}
                    className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs ${
                      index === cursor
                        ? 'bg-slate-100 font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className={`tabular-nums ${bandToneBlock(item.group.confidence)}`}>
                      {Math.round(item.group.confidence * 100)}%
                    </span>
                    <span className="truncate">{item.targetTitle}</span>
                    <span className="ml-auto shrink-0 opacity-60">{item.chains.length}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

function ActionBlock({
  icon: Icon,
  label,
  hint,
  onClick,
  primary,
}: {
  icon: typeof Check
  label: string
  hint: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
        primary
          ? 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
          : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <kbd className="ml-0.5 text-[10px] opacity-60">{hint}</kbd>
    </button>
  )
}
