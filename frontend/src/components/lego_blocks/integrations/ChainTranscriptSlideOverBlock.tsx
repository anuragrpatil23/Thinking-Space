import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Loader2, AlertTriangle, History, FileText } from 'lucide-react'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  countReadableSessionsBlock,
  getChainSessionTranscriptsBlock,
  type ChainSessionStatusBlock,
  type ChainSessionTranscriptBlock,
} from '@/services/lego_blocks/units/getChainTranscriptBlock'
import { cn } from '@/lib/utils'

/**
 * A chain's transcript, session by session.
 *
 * The sessions are the navigation, not a detail: a chain merges work that ran
 * hours apart, and the merged view is what let a session go missing unnoticed —
 * the Aug 2 chain rendered its CSS work in full and reported the deleted
 * session that wrote 220 assignment proposals as one line of italics halfway
 * down a scroll. So the list is always visible when there is more than one
 * session, every session states whether it is readable, and an unreadable one
 * is a card you cannot scroll past rather than a sentence you can.
 */

interface ChainTranscriptSlideOverBlockProps {
  /** The chain whose transcript should render. `null` closes the panel. */
  chain: ActivityChain | null
  onClose: () => void
}

function fmtClock(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

/** Render a chain's date + time span for the header, e.g. "Jun 11 · 4:48pm–9:14am +1d". */
function fmtChainWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const date = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const a = fmtClock(startIso)
  const b = endIso ? fmtClock(endIso) : a
  if (!endIso || a === b) return `${date} · ${a}`
  const end = new Date(endIso)
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const dayDelta = Math.round((endDay - startDay) / 86_400_000)
  const span = dayDelta > 0 ? `${a}–${b} +${dayDelta}d` : `${a}–${b}`
  return `${date} · ${span}`
}

function fmtSessionWhen(s: ParsedSession): string {
  const a = fmtClock(s.startedIso)
  if (!s.endedIso || s.endedIso === s.startedIso) return a
  return `${a}–${fmtClock(s.endedIso)}`
}

/** Status presentation in one place: the list pill, the card, and the empty
 *  state all have to agree about what a status means and looks like. */
const STATUS_META: Record<
  ChainSessionStatusBlock,
  { label: string; tone: string; icon: typeof AlertTriangle | null }
> = {
  ok: { label: '', tone: '', icon: null },
  empty: {
    label: 'empty',
    tone: 'border-border text-muted-foreground',
    icon: FileText,
  },
  reconstructed: {
    label: 'prompts only',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: History,
  },
  unavailable: {
    label: 'unavailable',
    tone: 'border-destructive/40 bg-destructive/10 text-destructive',
    icon: AlertTriangle,
  },
}

function StatusPill({ status }: { status: ChainSessionStatusBlock }) {
  const meta = STATUS_META[status]
  if (!meta.icon) return null
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        meta.tone,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

/** One session's body: its transcript, or an account of why there isn't one.
 *  The unreadable case is deliberately a full card with the path on it — that
 *  is the difference between "this is missing" and a line you scroll past. */
function SessionBody({ part }: { part: ChainSessionTranscriptBlock }) {
  if (part.status === 'ok') {
    return (
      <article className="prose prose-sm dark:prose-invert max-w-none" style={{ overflowWrap: 'anywhere' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.markdown}</ReactMarkdown>
      </article>
    )
  }
  const meta = STATUS_META[part.status]
  const Icon = meta.icon ?? AlertTriangle
  return (
    <div className={cn('rounded-lg border p-4 text-sm', meta.tone)}>
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4" />
        {part.status === 'reconstructed' ? 'No transcript for this session' : 'Transcript unavailable'}
      </div>
      <p className="mb-2 opacity-90">{part.note}</p>
      <code className="block break-all rounded bg-background/50 px-2 py-1 text-[11px] opacity-80">
        {part.session.path}
      </code>
    </div>
  )
}

export default function ChainTranscriptSlideOverBlock({ chain, onClose }: ChainTranscriptSlideOverBlockProps) {
  const [parts, setParts] = useState<ChainSessionTranscriptBlock[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** `'all'` or a 1-based session index. Resets with the chain. */
  const [selected, setSelected] = useState<'all' | number>('all')

  useEffect(() => {
    if (!chain) {
      setParts(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setParts(null)
    setSelected('all')
    getChainSessionTranscriptsBlock(chain)
      .then(next => { if (!cancelled) setParts(next) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chain])

  useEffect(() => {
    if (!chain) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chain, onClose])

  const readable = parts ? countReadableSessionsBlock(parts) : 0
  const missing = parts ? parts.length - readable : 0
  const shown = useMemo(
    () => (!parts ? [] : selected === 'all' ? parts : parts.filter(p => p.index === selected)),
    [parts, selected],
  )

  if (!chain) return null

  // Portal to <body>: this block mounts inside the home-canvas anchor panel,
  // whose transformed ancestors turn `position: fixed` into local positioning
  // (and overflow:hidden would clip the panel).
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <style>{`
        @keyframes ltm-transcript-slideover-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      {/* Transparent click-catcher: closes on outside click but leaves the
          page visible so the day table can be read alongside the transcript. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-[min(760px,92vw)] flex-col overflow-hidden border-l border-border/40 bg-background shadow-2xl"
        style={{
          animation: 'ltm-transcript-slideover-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
              <span className="truncate">
                {chain.project} · {chain.sessions.length} session{chain.sessions.length === 1 ? '' : 's'}
              </span>
              {/* The count that would have made a deleted session obvious on
                  the day it happened, rather than ten days later. */}
              {missing > 0 && (
                <span className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                  {missing} unreadable
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {chain.topic || '(no topic)'}
            </div>
            <div className="truncate text-[11px] text-muted-foreground/80">
              {fmtChainWhen(chain.startedIso, chain.endedIso)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Session picker. Hidden for single-session chains, where it would be
            chrome around one thing.
            A table rather than a row of chips: a chip can only hold a clock
            time, so choosing which session to read meant opening them until you
            found the one you meant. The columns are the ones you actually pick
            on — how long it ran, how much was said, which model, and whether
            there is anything to read at all. */}
        {parts && parts.length > 1 && (
          <div className="max-h-52 shrink-0 overflow-auto border-b border-border/40 bg-muted/20">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                <tr className="text-left uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="w-8 px-3 py-1.5 font-medium">#</th>
                  <th className="w-32 px-2 py-1.5 font-medium">When</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Msgs</th>
                  <th className="px-2 py-1.5 font-medium">Topic</th>
                  <th className="w-24 px-3 py-1.5 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => setSelected('all')}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] transition-colors',
                        selected === 'all'
                          ? 'border-foreground/50 bg-foreground/10 text-foreground'
                          : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground',
                      )}
                      title="Read every session in this chain, in order"
                    >
                      All {parts.length}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {parts.map(part => {
                  const isSelected = selected === part.index
                  return (
                    <tr
                      key={part.session.path}
                      // Clicking the selected row again goes back to all —
                      // otherwise the only way out of one session is the header
                      // button, which is nowhere near the row you just clicked.
                      onClick={() => setSelected(isSelected ? 'all' : part.index)}
                      className={cn(
                        'cursor-pointer border-t border-border/30 transition-colors',
                        isSelected ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]',
                      )}
                      title={part.session.topic || '(no topic)'}
                    >
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{part.index}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground/80">
                        {fmtSessionWhen(part.session)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground/70">
                        {part.session.userMsgCount}
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground/70">
                        {part.session.topic || (
                          <span className="text-muted-foreground/60">(no topic)</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {part.status === 'ok' ? (
                          <span className="whitespace-nowrap text-[10px] text-muted-foreground/70">
                            {part.session.model ?? ''}
                          </span>
                        ) : (
                          <StatusPill status={part.status} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading transcript…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {parts && !loading && shown.map(part => (
            <section key={part.session.path} className="mb-8 last:mb-0">
              <header className="mb-3 border-b border-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    Session {part.index}
                  </span>
                  <StatusPill status={part.status} />
                </div>
                <div className="mt-0.5 text-sm font-medium text-foreground">
                  {part.session.topic || '(no topic)'}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {fmtSessionWhen(part.session)}
                  {' · '}
                  {part.session.userMsgCount} msg{part.session.userMsgCount === 1 ? '' : 's'}
                  {part.session.model ? ` · ${part.session.model}` : ''}
                </div>
              </header>
              <SessionBody part={part} />
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
