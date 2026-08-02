import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Inbox, Loader2, SkipForward, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import {
  detachChainOrch,
  disposeChainsOrch,
  getQueueChainTranscriptSourceOrch,
  type AssignmentQueue,
  type QueueChainBlock,
  type QueueItem,
} from '@/services/orchestrators/assignmentQueueOrch'
import ChainTranscriptSlideOverBlock from '@/components/lego_blocks/integrations/ChainTranscriptSlideOverBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { listUndertakingTitlesOrch } from '@/services/orchestrators/aiActivityUndertakingOrch'
import {
  confidenceBandBlock,
  type ProposalTargetBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'
import { cn } from '@/lib/utils'

/**
 * The assignment queue — the surface the whole feature is judged by.
 *
 * The design constraint is stated plainly in ASSIGNMENT.md and it is not about
 * aesthetics: "the moment I am involved things slow down." So everything here
 * is subordinate to how fast one person can clear a backlog.
 *
 * - **One decision at a time, not a table.** A table invites reading; this
 *   invites deciding. The focused proposal shows its target, its reason and its
 *   chains in full; the rest of the queue is a rail you never have to read.
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
 *
 * This block is *controlled*: the dock above it owns the one queue read, so the
 * count in the chrome and the cards in here can never disagree about how much
 * work is left.
 */

interface Props {
  queue: AssignmentQueue | null
  loading: boolean
  /** Re-read the vault. Called after every disposition, because a disposition
   *  can mint an undertaking or move a chain. */
  onReload: () => Promise<void>
  onClose: () => void
}

interface UndoEntry {
  chainIds: string[]
  projectId: string
  undertakingKey: string
  label: string
}

/** Opening a transcript has to derive chains, which can take a beat and can
 *  fail outright on a device with no session cache. Three states, so neither
 *  case reads as a dead click. */
type TranscriptState =
  | { kind: 'closed' }
  | { kind: 'loading'; title: string }
  | { kind: 'open'; chain: ActivityChain }
  | { kind: 'missing'; title: string }

type BandTone = { text: string; bar: string; soft: string }

function bandToneBlock(confidence: number): BandTone {
  switch (confidenceBandBlock(confidence)) {
    case 'high':
      return {
        text: 'text-emerald-600 dark:text-emerald-400',
        bar: 'bg-emerald-500',
        soft: 'bg-emerald-500/15',
      }
    case 'medium':
      return {
        text: 'text-amber-600 dark:text-amber-400',
        bar: 'bg-amber-500',
        soft: 'bg-amber-500/15',
      }
    default:
      return {
        text: 'text-muted-foreground',
        bar: 'bg-muted-foreground/50',
        soft: 'bg-muted-foreground/10',
      }
  }
}

export default function AssignmentQueueBlock({ queue, loading, onReload, onClose }: Props) {
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retargeting, setRetargeting] = useState(false)
  const [retargetQuery, setRetargetQuery] = useState('')
  const [titles, setTitles] = useState<Array<{ key: string; title: string }>>([])
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  const [transcript, setTranscript] = useState<TranscriptState>({ kind: 'closed' })
  const retargetInputRef = useRef<HTMLInputElement | null>(null)

  const items = queue?.items ?? []
  const current: QueueItem | undefined = items[cursor]

  // The cursor is an index into a list that shrinks under it. Clamping here
  // rather than resetting to 0 keeps you where you were after a disposition,
  // which is the difference between clearing a queue and re-finding your place
  // in one.
  useEffect(() => {
    setCursor(index => Math.max(0, Math.min(index, items.length - 1)))
  }, [items.length])

  // Titles are loaded for the project the *focused* item belongs to, not the
  // page's project: the queue spans projects, and offering F9's undertakings
  // while retargeting a Thinking-Space chain would let one keystroke stamp
  // across a boundary the card does not show.
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
        await onReload()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        setRetargeting(false)
        setRetargetQuery('')
      }
    },
    [current, busy, onReload],
  )

  const undoLast = useCallback(async () => {
    if (!undo || busy) return
    setBusy(true)
    try {
      for (const chainId of undo.chainIds) {
        await detachChainOrch(undo.projectId, chainId, undo.undertakingKey)
      }
      setUndo(null)
      await onReload()
    } finally {
      setBusy(false)
    }
  }, [undo, busy, onReload])

  const openChain = useCallback(async (chain: QueueChainBlock) => {
    setTranscript({ kind: 'loading', title: chain.title })
    try {
      const derived = await getQueueChainTranscriptSourceOrch(chain.projectId, chain.chainId)
      setTranscript(derived ? { kind: 'open', chain: derived } : { kind: 'missing', title: chain.title })
    } catch {
      setTranscript({ kind: 'missing', title: chain.title })
    }
  }, [])

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

      // While a transcript is open the reader owns the keyboard: `a` must not
      // silently accept a proposal behind the panel you are still reading.
      if (transcript.kind !== 'closed') {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setTranscript({ kind: 'closed' })
        }
        return
      }

      if (retargeting) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
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
    // Capture, so the queue's own Escape handling for the retarget field runs
    // before the dock's close-on-Escape: backing out of a retarget must not
    // also close the panel.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, items.length, busy, retargeting, transcript.kind, dispose, undoLast])

  const undisposed = queue?.undisposedCount ?? 0
  const unproposed = queue?.unproposed.length ?? 0
  const orphaned = queue?.orphanedProposals ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">Assignment queue</h2>
          {/* Plain words on purpose. The code and the contract say "disposed"
              because a chain's answer can be "not an undertaking", which is not
              the same as filed — but nobody should have to learn that word to
              read a header. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length > 0 && (
              <>
                <span className="font-medium text-foreground">{items.length}</span> to decide ·{' '}
              </>
            )}
            {undisposed} unsorted
            {unproposed > 0 && <> · {unproposed} with nothing suggested yet</>}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {undo && (
            <button
              onClick={() => void undoLast()}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo {undo.label}
              <KbdBlock>u</KbdBlock>
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close the queue"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {(error || orphaned.length > 0) && (
        <div className="shrink-0 space-y-2 border-b border-border px-5 py-2.5">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {/* A proposal naming a chain that does not exist produces an empty
              queue and no reason for it. Loud, not silent — this is a proposing
              pass with a bug, and it must not read as "nothing to do". */}
          {orphaned.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {orphaned.length} proposal{orphaned.length === 1 ? '' : 's'} name a chain that does not
              exist — a proposing pass sent bad chain ids (
              {[...new Set(orphaned.map(p => p.proposedBy))].join(', ')}).
            </p>
          )}
        </div>
      )}

      {loading && !queue ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
        </div>
      ) : !current ? (
        <EmptyBlock unproposed={unproposed} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {items.length > 1 && (
            <nav className="hidden w-64 shrink-0 overflow-y-auto border-r border-border py-2 md:block">
              {items.map((item, index) => {
                const tone = bandToneBlock(item.group.confidence)
                return (
                  <button
                    key={`${item.group.projectId}:${item.group.targetId}`}
                    onClick={() => setCursor(index)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left text-xs',
                      index === cursor ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className={cn('mt-px w-8 shrink-0 tabular-nums font-medium', tone.text)}>
                      {Math.round(item.group.confidence * 100)}%
                    </span>
                    <span
                      className={cn(
                        'line-clamp-2 min-w-0 flex-1',
                        index === cursor ? 'font-medium text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {item.targetTitle}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground/60">
                      {item.chains.length}
                    </span>
                  </button>
                )
              })}
            </nav>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <CardBlock
                item={current}
                position={cursor + 1}
                total={items.length}
                onOpenChain={openChain}
              />
            </div>

            <footer className="shrink-0 border-t border-border px-6 py-3">
              {retargeting ? (
                <div>
                  <input
                    ref={retargetInputRef}
                    value={retargetQuery}
                    onChange={event => setRetargetQuery(event.target.value)}
                    placeholder="Filter undertakings, or type a new title…"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
                  />
                  <ul className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
                    {matches.map(entry => (
                      <li key={entry.key}>
                        <button
                          onClick={() => void dispose({ kind: 'existing', key: entry.key }, 'retargeted')}
                          className="w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          {entry.title}
                        </button>
                      </li>
                    ))}
                    {retargetQuery.trim() && (
                      <li>
                        {/* The mint. Last in the list and it costs a typed
                            title, because a key is a permanent address. */}
                        <button
                          onClick={() =>
                            void dispose({ kind: 'new', title: retargetQuery.trim() }, 'created')
                          }
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950"
                        >
                          <Sparkles className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">Create “{retargetQuery.trim()}”</span>
                        </button>
                      </li>
                    )}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    <KbdBlock>esc</KbdBlock> to back out
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionBlock icon={Check} label="Accept" hint="a" primary onClick={() => void dispose(current.group.target, 'accepted')} />
                  <ActionBlock icon={ChevronRight} label="Retarget" hint="r" onClick={() => setRetargeting(true)} />
                  <ActionBlock icon={Trash2} label="Not an undertaking" hint="b" onClick={() => void dispose({ kind: 'bucket' }, 'bucketed')} />
                  <ActionBlock icon={SkipForward} label="Skip" hint="s" onClick={() => setCursor(i => Math.min(i + 1, items.length - 1))} />
                </div>
              )}
            </footer>
          </div>
        </div>
      )}

      <ChainTranscriptSlideOverBlock
        chain={transcript.kind === 'open' ? transcript.chain : null}
        onClose={() => setTranscript({ kind: 'closed' })}
      />
      {(transcript.kind === 'loading' || transcript.kind === 'missing') && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-xs shadow-lg">
            {transcript.kind === 'loading' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Opening “{transcript.title}”…</span>
              </>
            ) : (
              <>
                {/* Not an error. The stored digest is real; the sessions behind
                    it just aren't derivable here. Say which, and move on. */}
                <span className="text-muted-foreground">
                  No transcript available for “{transcript.title}” on this device.
                </span>
                <button
                  onClick={() => setTranscript({ kind: 'closed' })}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CardBlock({
  item,
  position,
  total,
  onOpenChain,
}: {
  item: QueueItem
  position: number
  total: number
  onOpenChain: (chain: QueueChainBlock) => void
}) {
  const tone = bandToneBlock(item.group.confidence)
  const pct = Math.round(item.group.confidence * 100)

  return (
    <article className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{item.group.projectId}</span>
        {item.group.target.kind === 'new' && (
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-medium text-sky-700 dark:text-sky-400">
            would mint
          </span>
        )}
        {item.group.target.kind === 'bucket' && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">not an undertaking</span>
        )}
        <span className="ml-auto tabular-nums normal-case tracking-normal">
          {position} of {total}
        </span>
      </div>

      <h3 className="mt-3 text-xl font-semibold leading-snug tracking-tight">{item.targetTitle}</h3>

      {item.group.proposals[0]?.rationale && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {item.group.proposals[0].rationale}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2.5">
        <div className={cn('h-1.5 w-28 overflow-hidden rounded-full', tone.soft)}>
          <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn('text-xs font-medium tabular-nums', tone.text)}>{pct}% confident</span>
      </div>

      {/* Each chain opens its transcript in the standard slide-over. For a chain
          from months ago the title is not enough to judge a proposal on — being
          able to remember what it actually was is the difference between an
          answer and a guess. */}
      <ul className="mt-5 space-y-px border-t border-border pt-4">
        {item.chains.map(chain => (
          <li key={chain.chainId}>
            <button
              onClick={() => onOpenChain(chain)}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50"
              title="Open the transcript"
            >
              <ChevronRight className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate">{chain.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {chain.date} · {chain.activeMinutes}m
              </span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  )
}

function EmptyBlock({ unproposed }: { unproposed: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium">
        {unproposed > 0 ? 'Nothing to decide yet.' : 'All sorted.'}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {unproposed > 0
          ? `${unproposed} chains still need sorting, but nothing has been suggested for them yet. Ask Kai to take a pass.`
          : 'Every chain has an answer.'}
      </p>
    </div>
  )
}

function KbdBlock({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground">
      {children}
    </kbd>
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
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border border-border hover:bg-muted',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <kbd
        className={cn(
          'ml-0.5 rounded px-1 py-px font-mono text-[10px] leading-none',
          primary ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
        )}
      >
        {hint}
      </kbd>
    </button>
  )
}
