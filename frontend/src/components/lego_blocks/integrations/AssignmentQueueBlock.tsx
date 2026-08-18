import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, CircleSlash, Inbox, Loader2, Pencil, SkipForward, Sparkles, Undo2, X } from 'lucide-react'
import {
  detachSessionOrch,
  disposeSessionsOrch,
  getQueueSessionTranscriptSourceOrch,
  type AssignmentQueue,
  type QueueSessionBlock,
  type QueueItem,
} from '@/services/orchestrators/assignmentQueueOrch'
import ChainTranscriptSlideOverBlock from '@/components/lego_blocks/integrations/ChainTranscriptSlideOverBlock'
import AssignmentManualPaneBlock from '@/components/lego_blocks/integrations/AssignmentManualPaneBlock'
import ActionBlock, { KbdBlock } from '@/components/lego_blocks/units/AssignmentActionBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  listUndertakingSectionsOrch,
  listUndertakingTitlesOrch,
} from '@/services/orchestrators/aiActivityUndertakingOrch'
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
 *   sessions in full; the rest of the queue is a rail you never have to read.
 * - **Grouped by proposal.** One keystroke disposes of every session that was
 *   obviously the same piece of work. Six sessions, one decision.
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
 * Two panes, because a session arrives in one of two states and only one of them
 * is a proposal. **Suggested** is the queue above. **Unsorted** is everything no
 * pass has had an opinion about — which was the larger half, counted in the
 * header and rendered nowhere, so the only remedy the UI offered for it was to
 * go and ask a model first. That inverted the contract's own order, in which AI
 * proposes but a human is always allowed to decide. The second pane lives in
 * `AssignmentManualPaneBlock`.
 *
 * The project chips are a **filter, not a scope**: every project stays listed
 * with its count, including the ones nothing has adopted yet. Scoping the read
 * itself would hide exactly the backlog this feature exists to drain — the same
 * reason the dock's count is unscoped.
 *
 * This block is *controlled*: the dock above it owns the one queue read, so the
 * count in the chrome and the cards in here can never disagree about how much
 * work is left.
 */

interface Props {
  queue: AssignmentQueue | null
  loading: boolean
  /** Re-read the vault. Called after every disposition, because a disposition
   *  can mint an undertaking or move a session. */
  onReload: () => Promise<void>
  onClose: () => void
}

interface UndoEntry {
  sessionIds: string[]
  projectId: string
  undertakingKey: string
  label: string
}

/** Opening a transcript has to derive sessions, which can take a beat and can
 *  fail outright on a device with no session cache. Three states, so neither
 *  case reads as a dead click. */
type TranscriptState =
  | { kind: 'closed' }
  | { kind: 'loading'; title: string }
  | { kind: 'open'; session: ActivityChain }
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
  const [sections, setSections] = useState<Array<{ key: string; title: string }>>([])
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  const [transcript, setTranscript] = useState<TranscriptState>({ kind: 'closed' })
  const retargetInputRef = useRef<HTMLInputElement | null>(null)

  // The two correction primitives, held as edits to the *focused proposal*
  // rather than as separate flows. Renaming a proposed undertaking and dropping
  // a session that does not belong are the two things a person actually wants to
  // do to a suggestion, and both are worthless if they cost more than the
  // decision itself — so they live on the card and are spent by pressing
  // Accept, not by a save button.
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const [draftSection, setDraftSection] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())

  const [mode, setMode] = useState<'proposed' | 'unsorted'>('proposed')

  const items = queue?.items ?? []
  const unproposedChains = useMemo(() => queue?.unproposed ?? [], [queue])
  const current: QueueItem | undefined = items[cursor]
  const focusKey = current ? `${current.group.projectId}:${current.group.targetId}` : ''

  const clearEdits = useCallback(() => {
    setDraftTitle(null)
    setDraftSection(null)
    setExcluded(new Set())
  }, [])

  // Edits belong to one proposal. Moving the cursor abandons them rather than
  // carrying a title you typed for a different undertaking onto this one.
  useEffect(() => { clearEdits() }, [focusKey, clearEdits])

  const selectedChains = useMemo(
    () => (current?.sessions ?? []).filter(session => !excluded.has(session.sessionId)),
    [current, excluded],
  )

  /** What Accept would actually do, once the edits on the card are applied. */
  const effectiveTarget: ProposalTargetBlock | null = useMemo(() => {
    if (!current) return null
    const target = current.group.target
    if (target.kind !== 'new') return target
    if (draftTitle === null && draftSection === null) return target
    return {
      kind: 'new',
      title: (draftTitle ?? target.title).trim() || target.title,
      section: draftSection ?? target.section,
      head: target.head,
    }
  }, [current, draftTitle, draftSection])

  // The cursor is an index into a list that shrinks under it. Clamping here
  // rather than resetting to 0 keeps you where you were after a disposition,
  // which is the difference between clearing a queue and re-finding your place
  // in one.
  useEffect(() => {
    setCursor(index => Math.max(0, Math.min(index, items.length - 1)))
  }, [items.length])

  // Titles are loaded for the project the *focused* item belongs to, not the
  // page's project: the queue spans projects, and offering F9's undertakings
  // while retargeting a Thinking-Space session would let one keystroke stamp
  // across a boundary the card does not show.
  useEffect(() => {
    if (!current) return
    let alive = true
    void listUndertakingTitlesOrch(current.group.projectId).then(list => {
      if (alive) setTitles(list)
    })
    void listUndertakingSectionsOrch(current.group.projectId).then(list => {
      if (alive) setSections(list)
    })
    return () => { alive = false }
  }, [current?.group.projectId])

  useEffect(() => {
    if (retargeting) retargetInputRef.current?.focus()
  }, [retargeting])

  const dispose = useCallback(
    async (target: ProposalTargetBlock | null, label: string) => {
      if (!current || busy || selectedChains.length === 0) return
      setBusy(true)
      setError(null)
      try {
        const result = await disposeSessionsOrch({
          // Only the sessions still selected. A dropped session is not disposed of
          // — it keeps its proposal and comes back on its own, which is the
          // point: "these five yes, that one no" should not cost six decisions.
          sessionIds: selectedChains.map(session => session.sessionId),
          projectId: current.group.projectId,
          proposed: current.group.target,
          confidence: current.group.confidence,
          target,
        })
        if (result.undertaking && result.stamped.length) {
          setUndo({
            sessionIds: result.stamped,
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
        // Explicit, not left to the focus-change effect: accepting a subset
        // leaves the same group focused, so the exclusions would otherwise
        // persist onto the sessions that just came back.
        clearEdits()
      }
    },
    [current, busy, selectedChains, onReload, clearEdits],
  )

  const undoLast = useCallback(async () => {
    if (!undo || busy) return
    setBusy(true)
    try {
      for (const sessionId of undo.sessionIds) {
        await detachSessionOrch(undo.projectId, sessionId, undo.undertakingKey)
      }
      setUndo(null)
      await onReload()
    } finally {
      setBusy(false)
    }
  }, [undo, busy, onReload])

  const openChain = useCallback(async (session: QueueSessionBlock) => {
    setTranscript({ kind: 'loading', title: session.title })
    try {
      const derived = await getQueueSessionTranscriptSourceOrch(session.projectId, session.sessionId)
      setTranscript(derived ? { kind: 'open', session: derived } : { kind: 'missing', title: session.title })
    } catch {
      setTranscript({ kind: 'missing', title: session.title })
    }
  }, [])

  const matches = useMemo(() => {
    const q = retargetQuery.trim().toLowerCase()
    const pool = titles.filter(entry => entry.key !== (current?.group.target as { key?: string })?.key)
    if (!q) return pool
    // Uncapped: the list scrolls, and a cap reads as "these are all we have".
    return pool.filter(
      entry => entry.title.toLowerCase().includes(q) || entry.key.toLowerCase().includes(q),
    )
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

      // The unsorted pane is a selection surface, not a one-key queue: `b` there
      // has to be a letter you can type into a title, not a disposition for
      // however many sessions happen to be picked.
      if (mode !== 'proposed') return

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
          if (effectiveTarget) void dispose(effectiveTarget, 'accepted')
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
  }, [current, items.length, busy, mode, retargeting, transcript.kind, dispose, undoLast])

  const undisposed = queue?.undisposedCount ?? 0
  const unproposed = unproposedChains.length
  const orphaned = queue?.orphanedProposals ?? []
  const unreadable = queue?.unreadableLines ?? { proposals: 0, verdicts: 0, samples: [] }
  const unreadableTotal = unreadable.proposals + unreadable.verdicts

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">Assignment queue</h2>
          {/* Plain words on purpose. The code and the contract say "disposed"
              because a session's answer can be "not an undertaking", which is not
              the same as filed — but nobody should have to learn that word to
              read a header. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {undisposed} session{undisposed === 1 ? '' : 's'} still owe an answer
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

      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-5 py-2">
        <TabBlock
          active={mode === 'proposed'}
          onClick={() => setMode('proposed')}
          label="Suggested"
          count={items.length}
        />
        <TabBlock
          active={mode === 'unsorted'}
          onClick={() => setMode('unsorted')}
          label="Unsorted"
          count={unproposed}
        />
      </div>

      {(error || orphaned.length > 0 || unreadableTotal > 0) && (
        <div className="shrink-0 space-y-2 border-b border-border px-5 py-2.5">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {/* A proposal naming a session that does not exist produces an empty
              queue and no reason for it. Loud, not silent — this is a proposing
              pass with a bug, and it must not read as "nothing to do". */}
          {orphaned.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {orphaned.length} proposal{orphaned.length === 1 ? '' : 's'} name a session that does not
              exist — a proposing pass sent bad session ids (
              {[...new Set(orphaned.map(p => p.proposedBy))].join(', ')}).
            </p>
          )}
          {/* One level below `orphaned`: a line that never became a proposal at
              all. This is the banner that was missing when a schema rekey made
              the whole log unreadable and the pane rendered "Nothing suggested"
              over it. Red rather than amber — an orphan is one bad pass, this is
              data on disk the app cannot read. */}
          {unreadableTotal > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <p>
                {unreadableTotal} line{unreadableTotal === 1 ? '' : 's'} on disk could not be read
                {unreadable.proposals > 0 && ` (${unreadable.proposals} proposal${unreadable.proposals === 1 ? '' : 's'})`}
                {unreadable.verdicts > 0 && ` (${unreadable.verdicts} verdict${unreadable.verdicts === 1 ? '' : 's'})`}
                . This queue is incomplete, not empty.
              </p>
              {unreadable.samples.length > 0 && (
                <p className="mt-1 truncate font-mono text-[11px] opacity-80" title={unreadable.samples[0]}>
                  {unreadable.samples[0]}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {loading && !queue ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
        </div>
      ) : mode === 'unsorted' ? (
        <AssignmentManualPaneBlock
          sessions={unproposedChains}
          onReload={onReload}
          onOpenChain={openChain}
        />
      ) : !current ? (
        <EmptyBlock unproposed={unproposed} onShowUnsorted={() => setMode('unsorted')} />
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
                      {item.sessions.length}
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
                sections={sections}
                title={draftTitle ?? current.targetTitle}
                renamed={draftTitle !== null}
                sectionKey={
                  draftSection ??
                  (current.group.target.kind === 'new' ? current.group.target.section ?? null : null)
                }
                sectionLabel={current.targetSection}
                editable={current.group.target.kind === 'new'}
                excluded={excluded}
                onRename={setDraftTitle}
                onSection={setDraftSection}
                onToggleChain={sessionId =>
                  setExcluded(prev => {
                    const next = new Set(prev)
                    if (next.has(sessionId)) next.delete(sessionId)
                    else next.add(sessionId)
                    return next
                  })
                }
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
                  <ActionBlock
                    icon={Check}
                    label={
                      excluded.size > 0
                        ? `Accept ${selectedChains.length} of ${current.sessions.length}`
                        : 'Accept'
                    }
                    hint="a"
                    primary
                    disabled={selectedChains.length === 0}
                    onClick={() => effectiveTarget && void dispose(effectiveTarget, 'accepted')}
                  />
                  <ActionBlock icon={ChevronRight} label="Retarget" hint="r" onClick={() => setRetargeting(true)} />
                  <ActionBlock icon={CircleSlash} label="Not an undertaking" hint="b" onClick={() => void dispose({ kind: 'bucket' }, 'bucketed')} />
                  <ActionBlock icon={SkipForward} label="Skip" hint="s" onClick={() => setCursor(i => Math.min(i + 1, items.length - 1))} />
                </div>
              )}
            </footer>
          </div>
        </div>
      )}

      <ChainTranscriptSlideOverBlock
        chain={transcript.kind === 'open' ? transcript.session : null}
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
  sections,
  title,
  renamed,
  sectionKey,
  sectionLabel,
  editable,
  excluded,
  onRename,
  onSection,
  onToggleChain,
  onOpenChain,
}: {
  item: QueueItem
  position: number
  total: number
  sections: Array<{ key: string; title: string }>
  title: string
  renamed: boolean
  sectionKey: string | null
  sectionLabel: string | null
  /** Only a mint is editable. Joining an existing undertaking must not rename
   *  it from here — that record is an address other sessions already point at. */
  editable: boolean
  excluded: ReadonlySet<string>
  onRename: (title: string | null) => void
  onSection: (key: string) => void
  onToggleChain: (sessionId: string) => void
  onOpenChain: (session: QueueSessionBlock) => void
}) {
  const tone = bandToneBlock(item.group.confidence)
  const pct = Math.round(item.group.confidence * 100)
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState(title)

  const sectionTitle = sectionKey
    ? sections.find(entry => entry.key === sectionKey)?.title ?? sectionKey
    : sectionLabel

  return (
    <article className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{item.group.projectId}</span>
        {item.group.target.kind === 'new' && (
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-medium text-sky-700 dark:text-sky-400">
            would mint
          </span>
        )}
        {item.group.target.kind === 'bucket' && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">not an undertaking</span>
        )}
        {/* Where it lands. A proposal that mints without saying which section it
            mints into is asking for a decision with a third of the facts. */}
        {editable && sections.length > 0 ? (
          <label className="flex items-center gap-1 normal-case tracking-normal">
            <span className="text-muted-foreground/70">in</span>
            <select
              value={sectionKey ?? ''}
              onChange={event => onSection(event.target.value)}
              className="rounded border border-transparent bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground outline-none hover:border-border focus:border-ring"
            >
              {!sectionKey && <option value="">Pick a section…</option>}
              {sections.map(entry => (
                <option key={entry.key} value={entry.key}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          sectionTitle && (
            <span className="normal-case tracking-normal">
              in <span className="font-medium text-foreground">{sectionTitle}</span>
            </span>
          )
        )}
        <span className="ml-auto tabular-nums normal-case tracking-normal">
          {position} of {total}
        </span>
      </div>

      {/* The rename primitive, spent at the moment of decision. A suggested
          title is usually 90% right, and re-typing it in the retarget field to
          fix one word is the kind of friction that makes a queue get closed. */}
      {editing ? (
        <input
          autoFocus
          value={buffer}
          onChange={event => setBuffer(event.target.value)}
          onBlur={() => {
            setEditing(false)
            onRename(buffer.trim() && buffer !== item.targetTitle ? buffer.trim() : null)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.stopPropagation()
              setBuffer(title)
              setEditing(false)
            }
          }}
          className="mt-3 w-full rounded-md border border-ring bg-background px-2 py-1 text-xl font-semibold leading-snug tracking-tight outline-none"
        />
      ) : (
        <div className="group/title mt-3 flex items-start gap-2">
          <h3 className="text-xl font-semibold leading-snug tracking-tight">{title}</h3>
          {editable && (
            <button
              onClick={() => { setBuffer(title); setEditing(true) }}
              title="Rename before accepting"
              aria-label="Rename before accepting"
              className="mt-1.5 shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/title:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {renamed && (
            <span className="mt-2 shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
              renamed
            </span>
          )}
        </div>
      )}

      {item.group.proposals[0]?.rationale && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {item.group.proposals[0].rationale}
        </p>
      )}

      {/* Shown only on a mint, because that is the only irreversible decision on
          this card — a key is an address, and a second address for a strand that
          already has one cannot be taken back by editing a pointer. The proposer
          scored this when it wrote the claim; surfacing it anywhere but here
          would be telling the human after they had already decided. Advisory:
          a new strand may legitimately resemble its neighbours. */}
      {item.group.target.kind === 'new' && (item.group.proposals[0]?.similar?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          <p className="font-medium">This resembles an undertaking you already have:</p>
          <ul className="mt-1 space-y-0.5">
            {item.group.proposals[0].similar?.map(entry => (
              <li key={entry.key} className="truncate" title={entry.key}>
                {entry.title || entry.key}
              </li>
            ))}
          </ul>
          <p className="mt-1 opacity-75">Retarget to file it there instead, or accept to mint anyway.</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2.5">
        <div className={cn('h-1.5 w-28 overflow-hidden rounded-full', tone.soft)}>
          <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn('text-xs font-medium tabular-nums', tone.text)}>{pct}% confident</span>
      </div>

      {/* Each session opens its transcript in the standard slide-over. For a session
          from months ago the title is not enough to judge a proposal on — being
          able to remember what it actually was is the difference between an
          answer and a guess. */}
      <ul className="mt-5 space-y-px border-t border-border pt-4">
        {item.sessions.map(session => {
          const dropped = excluded.has(session.sessionId)
          return (
            <li key={session.sessionId} className="group/session flex items-center gap-1">
              <button
                onClick={() => onOpenChain(session)}
                className={cn(
                  'flex min-w-0 flex-1 items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50',
                  dropped && 'text-muted-foreground/50 line-through',
                )}
                title="Open the transcript"
              >
                <ChevronRight className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground/60" />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {session.date} · {session.activeMinutes}m · {1} session
                  {1 === 1 ? '' : 's'}
                </span>
              </button>
              {/* Dropping a session is not a disposition — it just takes it out of
                  *this* answer and lets it come back on its own. One wrong session
                  in a group of six should not cost the other five. */}
              <button
                onClick={() => onToggleChain(session.sessionId)}
                title={dropped ? 'Put it back in this group' : "Doesn't belong here"}
                aria-label={dropped ? 'Put it back in this group' : 'Drop from this group'}
                className={cn(
                  'shrink-0 rounded p-1 transition-opacity hover:bg-muted',
                  dropped
                    ? 'text-muted-foreground opacity-100'
                    : 'text-muted-foreground/40 opacity-0 hover:text-foreground focus:opacity-100 group-hover/session:opacity-100',
                )}
              >
                {dropped ? <Undo2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </li>
          )
        })}
      </ul>
      {excluded.size > 0 && (
        <p className="mt-3 px-2 text-xs text-muted-foreground">
          {excluded.size} dropped — {excluded.size === 1 ? 'it stays' : 'they stay'} in the queue and
          will come back on {excluded.size === 1 ? 'its' : 'their'} own.
        </p>
      )}
    </article>
  )
}

function EmptyBlock({ unproposed, onShowUnsorted }: { unproposed: number; onShowUnsorted: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium">
        {unproposed > 0 ? 'Nothing suggested right now.' : 'All sorted.'}
      </p>
      {/* An AI pass is an accelerator here, never a gate. "Ask Kai to take a
          pass" used to be the only thing this said, which left the larger half
          of the backlog unreachable until a model had had an opinion about it. */}
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {unproposed > 0
          ? `${unproposed} sessions still need an answer. Sort them yourself, or ask Kai to take a pass first.`
          : 'Every session has an answer.'}
      </p>
      {unproposed > 0 && (
        <button
          onClick={onShowUnsorted}
          className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Sort them
        </button>
      )}
    </div>
  )
}

/** An underlined tab rather than a pill group: the panel already has a pill for
 *  every project id in the rail, and two competing pill vocabularies in the same
 *  40 vertical pixels is what made this read as a control panel. */
function TabBlock({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors after:absolute after:inset-x-2.5 after:-bottom-2 after:h-px',
        active
          ? 'font-medium text-foreground after:bg-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span className={cn('tabular-nums', active ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
        {count}
      </span>
    </button>
  )
}

