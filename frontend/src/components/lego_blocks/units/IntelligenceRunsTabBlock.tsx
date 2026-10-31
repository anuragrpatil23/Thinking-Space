// Live view of the intelligence subsystem: what is waiting, what is running,
// and what every finished run actually sent and got back.
//
// The pieces existed and nothing showed them. Queue depth was computable but
// uncalled, so a slow digest looked like a hung app rather than third in line.
// The prompt was never recorded at all, and the reasoning trace — the part that
// spends the tokens and shapes the answer while never appearing in the output —
// was parsed by both providers and dropped on the floor. This tab is where the
// run stops being a black box with a latency number on it.
//
// In-memory only, deliberately: a prompt carries vault text, and a debug view
// is not a reason to write your notes to a second place on disk.

import { useEffect, useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import { useAiEngineStatusBlock } from '@/components/lego_blocks/hooks/shared/useAiEngineStatusBlock'
import {
  describeEngineSpeedBlock,
  describeEngineStateBlock,
  ENGINE_DOT_CLASS,
  formatSecondsBlock,
  type EngineStateBlock,
  type EngineToneBlock,
} from '@/services/lego_blocks/units/intelligence/engineStatusBlock'
import { cn } from '@/lib/utils'
import {
  clearTelemetryBlock,
  readTelemetryBlock,
  subscribeTelemetryBlock,
  type TelemetryEntry,
} from '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'
import {
  cancelQueuedIntelligenceJobBlock,
  listQueuedIntelligenceJobsBlock,
  subscribeIntelligenceQueueBlock,
  type QueuedJobBlock,
} from '@/services/lego_blocks/integrations/intelligence/jobQueueBlock'
import {
  cancelRunningJobBlock,
  listRunningJobsBlock,
  subscribeRunningJobsBlock,
  type RunningJob,
} from '@/services/lego_blocks/units/intelligence/runningJobsBlock'

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return formatSecondsBlock(ms / 1000)
}

/** End-to-end output tokens per second ("e2e/s"): output over the whole run's
 *  wall time, which includes reading the prompt and sharing the engine with
 *  other jobs — so it reads well under the engine's own decode speed, which the
 *  status line shows when the engine reports it. A job-latency figure, not a
 *  measure of the model. */
function tokensPerSecondBlock(entry: TelemetryEntry): number | null {
  const out = entry.usage?.completionTokens ?? 0
  if (entry.status !== 'ok' || out <= 0 || entry.latencyMs <= 0) return null
  return out / (entry.latencyMs / 1000)
}

function fmtAgo(since: number, now: number): string {
  return fmtMs(Math.max(0, now - since))
}

/** Short day label for a job's subject date, e.g. "Aug 16". Bare when the value
 *  is not a parseable date — some contract inputs carry a range label rather
 *  than a timestamp, and showing it as-is beats showing nothing. */
function fmtSubjectDate(dateIso?: string): string | null {
  if (!dateIso) return null
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return dateIso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Subject first: "Thinking-Space · Oct 30" or "Reuters · Fed holds rates" is
 *  what you are waiting for. An item's headline beats its date; jobs with no
 *  subject at all fall back to their type. */
function subjectBlock(run: { taskId: string; project?: string; dateIso?: string; title?: string }): string {
  const parts = run.title ? [run.project, run.title] : [run.project, fmtSubjectDate(run.dateIso)]
  return parts.filter(Boolean).join(' · ') || taskLabelBlock(run.taskId)
}

/** "range-summary-label" → "range label", "session-digest" → "session digest". */
function taskLabelBlock(taskId: string): string {
  return taskId.replace(/^range-summary-(?=.)/, 'range ').replace(/-/g, ' ')
}

/** "mlx-community/Qwen3.8-27B-4bit" → "Qwen3.8-27B · 4-bit". */
function shortModelBlock(model: string): string {
  return model.split('/').pop()!.replace(/-(\d+)bit$/i, ' · $1-bit')
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function fmtTps(tps: number): string {
  return tps < 10 ? tps.toFixed(1) : String(Math.round(tps))
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Section heading — the same quiet small caps as the rest of the app. */
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-2 px-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</span>
      {right}
    </div>
  )
}

/** Column templates, one per table. Each section is its own table with only
 *  the columns that mean something for it; within a table every row shares the
 *  template, so the columns line up. Marker first, cancel slot last. */
const RUNNING_GRID = 'grid grid-cols-[0.75rem_minmax(0,1fr)_6rem_4rem_3.5rem_1rem] items-center gap-x-2'
const QUEUE_GRID = 'grid grid-cols-[0.75rem_minmax(0,1fr)_6rem_4rem_1rem] items-center gap-x-2'
const FINISHED_GRID = 'grid grid-cols-[0.75rem_minmax(0,1fr)_6rem_2.5rem_2.5rem_3.5rem_3.5rem] items-center gap-x-2'

/** A table: section title, then a header row of column labels. Labels after
 *  the second column are numbers, so they right-align over their values. */
function RunTableBlock({
  title,
  grid,
  head,
  right,
  children,
}: {
  title: string
  grid: string
  head: string[]
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <SectionLabel right={right}>{title}</SectionLabel>
      <div className={cn(grid, 'border-b border-border/50 px-1 pb-1 text-[10px] text-muted-foreground/80')}>
        {head.map((label, i) => (
          <span key={i} className={cn('truncate', i >= 3 && 'text-right')}>{label}</span>
        ))}
      </div>
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  )
}

/** One table row. The row toggles its detail view; cancel, when given, is its
 *  own button in the last cell, quiet until the row is hovered. */
function RunRowBlock({
  grid,
  cells,
  onToggle,
  onCancel,
  cancelTitle,
}: {
  grid: string
  cells: React.ReactNode[]
  onToggle: () => void
  onCancel?: () => void
  cancelTitle?: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      className={cn(grid, 'group cursor-pointer px-1 py-1.5 tabular-nums hover:bg-muted/30')}
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className={cn(
            'min-w-0 truncate',
            i === 0 && 'flex justify-center',
            i === 2 && 'text-[10px] text-muted-foreground',
            i >= 3 && 'text-right text-muted-foreground',
          )}
        >
          {cell}
        </span>
      ))}
      {onCancel && (
        <span className="flex justify-center">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onCancel() }}
            title={cancelTitle}
            aria-label={cancelTitle}
            className="rounded p-0.5 text-muted-foreground opacity-40 transition hover:bg-muted/60 hover:text-foreground group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  )
}

/** How many waiting jobs get a full row before the rest fold into one line. */
const QUEUE_VISIBLE = 3

const BANNER_TONE: Record<EngineToneBlock, string> = {
  ok: '',
  unknown: 'border-border/50 bg-muted/30 text-muted-foreground',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  paused: 'border-border/60 bg-muted/40 text-muted-foreground',
  down: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
}

/** Shown only while the engine is not taking work, so its presence alone says
 *  something is wrong. Says why, when it comes back, and that nothing waiting
 *  was lost — jobs pause while the engine is away, they do not fail. */
function EngineBannerBlock({ engine, now, waiting }: { engine: EngineStateBlock; now: number; waiting: number }) {
  const [open, setOpen] = useState(false)
  const view = describeEngineStateBlock(engine, now)
  if (view.tone === 'ok' || engine.kind === 'unknown') return null
  const failure = engine.lastFailure
  return (
    <div className={cn('rounded-md border px-2.5 py-2', BANNER_TONE[view.tone])}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{view.label}</span>
        {view.detail && <span className="min-w-0 truncate opacity-90">{view.detail}</span>}
        {failure && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="ml-auto shrink-0 text-[10px] underline-offset-2 opacity-80 hover:underline"
          >
            {open ? 'hide' : 'why'}
          </button>
        )}
      </div>
      {waiting > 0 && (
        <div className="mt-0.5 text-[10px] opacity-80">
          {waiting} {waiting === 1 ? 'job' : 'jobs'} paused, none lost. They resume when the engine is back.
        </div>
      )}
      {open && failure && (
        <div className="mt-1.5 space-y-0.5 border-t border-current/20 pt-1.5 text-[10px] opacity-90">
          <div>
            Last failure{failure.at ? ` at ${new Date(failure.at).toLocaleTimeString()}` : ''}: {failure.reason ?? 'unknown'}
          </div>
          {failure.detail && <div className="break-words font-mono">{failure.detail}</div>}
          {failure.inFlight.length > 0 && (
            <div>Running at the time: {failure.inFlight.map(f => f.job ?? f.requestId.slice(0, 8)).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** Finished runs as displayed: errors pinned first (they are why you opened
 *  this), then everything in order, with runs of consecutive cache hits for the
 *  same task folded into one line — fourteen identical "cache-hit chain-stitch"
 *  rows say one thing fourteen times. */
type FinishedRowBlock =
  | { kind: 'run'; entry: TelemetryEntry }
  | { kind: 'cache'; taskId: string; entries: TelemetryEntry[] }

function groupFinishedBlock(entries: TelemetryEntry[]): FinishedRowBlock[] {
  const rows: FinishedRowBlock[] = entries.filter(e => e.status === 'error').map(entry => ({ kind: 'run', entry }))
  for (const entry of entries) {
    if (entry.status === 'error') continue
    const last = rows[rows.length - 1]
    if (entry.status === 'cache-hit') {
      if (last?.kind === 'cache' && last.taskId === entry.taskId) last.entries.push(entry)
      else rows.push({ kind: 'cache', taskId: entry.taskId, entries: [entry] })
    } else {
      rows.push({ kind: 'run', entry })
    }
  }
  return rows
}

/** Where a run came from — the part of the app that asked for it. Read off the
 *  contract id, which already names its family; anything new lands in Other
 *  until it is listed here. */
interface RunOriginBlock { id: string; label: string }
const RUN_ORIGINS: Array<RunOriginBlock & { match: (taskId: string) => boolean }> = [
  {
    id: 'ai-activity',
    label: 'AI activity',
    match: t => t === 'session-digest' || t === 'chain-stitch' || t.startsWith('range-summary'),
  },
  {
    id: 'feed',
    label: 'F9 feed',
    match: t => t.startsWith('article-') || t.startsWith('feed-') || t === 'story-card',
  },
  { id: 'reading', label: 'Reading', match: t => t.startsWith('reading-') },
  { id: 'settings', label: 'Settings', match: t => t.startsWith('settings-') },
]
const OTHER_ORIGIN: RunOriginBlock = { id: 'other', label: 'Other' }

function originOfBlock(taskId: string): RunOriginBlock {
  return RUN_ORIGINS.find(o => o.match(taskId)) ?? OTHER_ORIGIN
}

/** How many rows a source's table shows before folding the rest. */
const GROUP_VISIBLE = 6

/** Finished runs split by source, most recently active source first, each with
 *  a one-line summary: typical speed and time for its real (non-cache) runs. */
function groupByOriginBlock(entries: TelemetryEntry[]): Array<{
  origin: RunOriginBlock
  entries: TelemetryEntry[]
  failed: number
  summary: string | null
}> {
  const groups = new Map<string, { origin: RunOriginBlock; entries: TelemetryEntry[] }>()
  for (const entry of entries) {
    const origin = originOfBlock(entry.taskId)
    const group = groups.get(origin.id) ?? { origin, entries: [] }
    group.entries.push(entry)
    groups.set(origin.id, group)
  }
  return [...groups.values()].map(group => {
    const real = group.entries.filter(e => e.status === 'ok')
    const tps = real.map(tokensPerSecondBlock).filter((n): n is number => n != null)
    const took = real.map(e => e.latencyMs).filter(ms => ms > 0)
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const summary = [
      tps.length ? `${fmtTps(median(tps))} e2e/s` : null,
      took.length ? `~${fmtMs(median(took))} each` : null,
    ].filter(Boolean).join(' · ')
    return {
      ...group,
      failed: group.entries.filter(e => e.status === 'error').length,
      summary: summary || null,
    }
  })
}

/** The model most runs used, named once in the header instead of on every row. */
function mainModelBlock(models: Array<string | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const m of models) if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
  let best: string | null = null
  for (const [m, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = m
  return best
}

/** One labelled block of the exchange. Collapsed by default for everything but
 *  the output: the prompt is usually long and usually not why you opened this. */
function PayloadSection({
  label,
  text,
  defaultOpen = false,
}: {
  label: string
  text?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!text) return null
  return (
    <div className="border-t border-border/40 pt-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 text-left text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="tabular-nums opacity-60">{open ? '▾' : '▸'}</span>
        {label}
        <span className="ml-auto tabular-nums opacity-60">{text.length.toLocaleString()} ch</span>
      </button>
      {open && (
        <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px] leading-relaxed text-foreground/80">
          {text}
        </pre>
      )}
    </div>
  )
}

export default function IntelligenceRunsTabBlock() {
  const [queued, setQueued] = useState<QueuedJobBlock[]>(() => listQueuedIntelligenceJobsBlock())
  const [running, setRunning] = useState<RunningJob[]>(() => listRunningJobsBlock())
  const [entries, setEntries] = useState<TelemetryEntry[]>(() => readTelemetryBlock())
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [expandedCache, setExpandedCache] = useState<number | null>(null)
  // Origins whose Finished table shows every row rather than the latest few.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [queueOpen, setQueueOpen] = useState(false)
  const { engine, recentTokensPerSecond } = useAiEngineStatusBlock(true)
  // Drives the elapsed counters. Only ticks while something is in flight, so an
  // idle panel costs nothing — see the energy contract.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => subscribeIntelligenceQueueBlock(() => {
    setQueued(listQueuedIntelligenceJobsBlock())
  }), [])
  useEffect(() => subscribeRunningJobsBlock(() => setRunning(listRunningJobsBlock())), [])
  useEffect(() => subscribeTelemetryBlock(() => setEntries(readTelemetryBlock())), [])

  const busy = running.length > 0 || queued.length > 0
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  const mainModel = mainModelBlock([...running.map(j => j.model), ...queued.map(j => j.model), ...entries.map(e => e.model)])
  const finishedGroups = groupByOriginBlock(entries)
  const renderFinishedRow = (row: FinishedRowBlock) => {
              if (row.kind === 'cache') {
                const first = row.entries[0]
                const groupOpen = expandedCache === first.id
                return (
                  <div key={`cache-${first.id}`}>
                    <RunRowBlock
                      grid={FINISHED_GRID}
                      cells={[
                        <span className="text-muted-foreground">↺</span>,
                        <span className="text-muted-foreground">{taskLabelBlock(row.taskId)}</span>,
                        row.entries.length === 1 ? 'cache hit' : `${row.entries.length} cache hits`,
                        null,
                        null,
                        null,
                        <span className="text-[10px]">{fmtClock(first.ts)}</span>,
                      ]}
                      onToggle={() => setExpandedCache(groupOpen ? null : first.id)}
                    />
                    {groupOpen && (
                      <div className="space-y-0.5 px-1 pb-2 pl-7 pr-[5.75rem] text-[10px] text-muted-foreground">
                        {row.entries.map(e => (
                          <div key={e.id} className="flex gap-2">
                            <span className="min-w-0 truncate">{subjectBlock(e)}</span>
                            <span className="ml-auto shrink-0 tabular-nums">{fmtClock(e.ts)}</span>
                          </div>
                        ))}
                        <div className="opacity-70">Served from cache — no prompt was sent.</div>
                      </div>
                    )}
                  </div>
                )
              }
              const entry = row.entry
              const open = expandedId === entry.id
              const tps = tokensPerSecondBlock(entry)
              const failed = entry.status === 'error'
              return (
                <div key={entry.id}>
                  <RunRowBlock
                    grid={FINISHED_GRID}
                    cells={[
                      failed
                        ? <span className="text-red-500">✕</span>
                        : entry.reasoning === 'on' ? <span className="text-[10px] text-amber-600 dark:text-amber-500" title="Thinking on">✦</span> : null,
                      <span className={failed ? 'text-red-600 dark:text-red-400' : 'text-foreground/90'}>{subjectBlock(entry)}</span>,
                      failed
                        ? <span className="text-red-600/80 dark:text-red-400/80">{entry.error?.kind ?? 'error'}</span>
                        : taskLabelBlock(entry.taskId),
                      entry.usage?.completionTokens ? fmtTokens(entry.usage.completionTokens) : null,
                      tps != null ? fmtTps(tps) : null,
                      <span className="text-foreground/80">{entry.latencyMs > 0 ? fmtMs(entry.latencyMs) : ''}</span>,
                      <span className="text-[10px]">{fmtClock(entry.ts)}</span>,
                    ]}
                    onToggle={() => setExpandedId(open ? null : entry.id)}
                  />
                  {open && (
                    <div className="space-y-2 px-1 pb-2.5 pl-7">
                      {entry.error && (
                        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-red-600 dark:text-red-400">
                          <span className="font-mono uppercase">{entry.error.kind}</span>
                          <div className="mt-0.5 opacity-90">{entry.error.message}</div>
                          {entry.error.details && (
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] opacity-80">
                              {JSON.stringify(entry.error.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                      {entry.status === 'cache-hit' && (
                        <div className="text-[10px] text-muted-foreground/70">
                          Served from cache — no prompt was sent, so there is nothing to show.
                        </div>
                      )}
                      {entry.payload?.truncated && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-500">
                          Some fields were truncated for display.
                        </div>
                      )}
                      {/* Age-out is silent otherwise, and an empty detail view
                          reads as "nothing was recorded" rather than "this run
                          is old". */}
                      {!entry.payload && entry.status !== 'cache-hit' && (
                        <div className="text-[10px] text-muted-foreground/70">
                          Prompt and output aged out — only the most recent runs keep theirs.
                        </div>
                      )}
                      <PayloadSection label="System prompt" text={entry.payload?.system} />
                      <PayloadSection label="User prompt" text={entry.payload?.user} />
                      <PayloadSection label="Reasoning" text={entry.payload?.reasoning} />
                      <PayloadSection label="Output" text={entry.payload?.response} defaultOpen />
                      {entry.payload && (
                        <button
                          type="button"
                          onClick={() => {
                            const p = entry.payload!
                            void navigator.clipboard.writeText(
                              [
                                `task: ${entry.taskId}`,
                                `model: ${entry.model} (${entry.providerId})`,
                                `status: ${entry.status}${entry.finishReason ? ` · ${entry.finishReason}` : ''}`,
                                entry.usage
                                  ? `tokens: ${entry.usage.promptTokens} in / ${entry.usage.completionTokens} out`
                                  : '',
                                `latency: ${fmtMs(entry.latencyMs)}`,
                                p.system ? `\n--- system ---\n${p.system}` : '',
                                p.user ? `\n--- user ---\n${p.user}` : '',
                                p.reasoning ? `\n--- reasoning ---\n${p.reasoning}` : '',
                                p.response ? `\n--- output ---\n${p.response}` : '',
                              ].filter(Boolean).join('\n'),
                            )
                          }}
                          className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground"
                        >
                          Copy run
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
  }
  const engineView = describeEngineStateBlock(engine, now)
  const visibleQueue = queueOpen ? queued : queued.slice(0, QUEUE_VISIBLE)
  const foldedQueue = queueOpen ? [] : queued.slice(QUEUE_VISIBLE)

  return (
    <div className="space-y-5 p-3 text-xs">
      <EngineBannerBlock engine={engine} now={now} waiting={queued.length + running.filter(j => j.waitingForEngine).length} />

      {/* One quiet status line: which engine, how fast lately, how busy. */}
      <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ENGINE_DOT_CLASS[engineView.tone])} />
        <span className="min-w-0 truncate text-foreground/80">{mainModel ? shortModelBlock(mainModel) : 'No runs yet'}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {(() => {
            const speed = describeEngineSpeedBlock(engine.speed, recentTokensPerSecond)
            return speed ? <>{speed} · </> : null
          })()}
          {running.length} ▸ {queued.length}
        </span>
      </div>

      {!busy && (
        <div className="px-1 text-[11px] text-muted-foreground/70">
          Nothing running. Up to four small jobs run at once, two when a big one is involved; the rest wait in line.
        </div>
      )}

      {running.length > 0 && (
        <RunTableBlock title="Running" grid={RUNNING_GRID} head={['', 'Subject', 'Job', 'Running', 'Started']}>
            {running.map(job => {
              const open = expandedKey === `run-${job.id}`
              return (
                <div key={`run-${job.id}`}>
                  <RunRowBlock
                    grid={RUNNING_GRID}
                    cells={[
                      // The bar is the "it's alive" signal: it breathes while
                      // generating and holds still, amber, while the job waits
                      // for the engine to come back.
                      <span className={cn('h-3.5 w-0.5 rounded-full', job.waitingForEngine ? 'bg-amber-500/70' : 'animate-pulse bg-sky-500/80')} />,
                      <span className="font-medium text-foreground">{subjectBlock(job)}</span>,
                      job.attempt != null
                        ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">{job.waitingForEngine && <RotateCw className="h-2.5 w-2.5 shrink-0" />}retry {job.attempt}/2</span>
                        : taskLabelBlock(job.taskId),
                      <span className="text-foreground/80">{fmtAgo(job.startedAt, now)}</span>,
                      <span className="text-[10px]">{fmtClock(job.startedAt)}</span>,
                    ]}
                    onToggle={() => setExpandedKey(open ? null : `run-${job.id}`)}
                    onCancel={() => cancelRunningJobBlock(job.id)}
                    cancelTitle="Cancel this run"
                  />
                  {open && (
                    <div className="space-y-2 px-1 pb-2.5 pl-7">
                      {/* Empty only for the instant between the job registering
                          and its request being built — the row exists first so a
                          request that hangs during construction is still
                          cancellable. */}
                      {!job.request ? (
                        <div className="text-[10px] text-muted-foreground/70">
                          Building the prompt…
                        </div>
                      ) : (
                        <>
                          <PayloadSection label="System prompt" text={job.request.system} />
                          <PayloadSection label="User prompt" text={job.request.user} defaultOpen />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
        </RunTableBlock>
      )}

      {queued.length > 0 && (
        <RunTableBlock title="Up next" grid={QUEUE_GRID} head={['#', 'Subject', 'Job', 'Waiting']}>
            {visibleQueue.map((job, i) => {
              const open = expandedKey === job.key
              return (
                <div key={`q-${job.key}`}>
                  <RunRowBlock
                    grid={QUEUE_GRID}
                    cells={[
                      <span className="text-[10px] text-muted-foreground/60">{i + 1}</span>,
                      <span className="text-foreground/80">{subjectBlock(job)}</span>,
                      job.priority === 'interactive'
                        ? <span className="text-sky-600 dark:text-sky-400">runs next</span>
                        : taskLabelBlock(job.taskId),
                      fmtAgo(job.queuedAt, now),
                    ]}
                    onToggle={() => setExpandedKey(open ? null : job.key)}
                    onCancel={() => cancelQueuedIntelligenceJobBlock(job.key)}
                    cancelTitle="Drop this job from the queue"
                  />
                  {open && (
                    <div className="space-y-2 px-1 pb-2.5 pl-6">
                      <div className="text-[10px] text-muted-foreground/70">
                        {job.providerId ?? 'provider unknown'} · queued {fmtClock(job.queuedAt)}
                      </div>
                      <div className="break-all font-mono text-[10px] text-muted-foreground/60">
                        {job.key}
                      </div>
                      {/* Deliberately labelled input, not prompt: a queued job
                          has not built its request yet, and calling this "prompt"
                          would be a claim about text that does not exist. */}
                      <PayloadSection label="Input (prompt not built yet)" text={job.inputPreview} defaultOpen />
                    </div>
                  )}
                </div>
              )
            })}
            {foldedQueue.length > 0 && (
              <button
                type="button"
                onClick={() => setQueueOpen(true)}
                className="block w-full truncate px-1 py-1.5 pl-7 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                +{foldedQueue.length} more · {foldedQueue.map(j => subjectBlock(j)).join(' · ')}
              </button>
            )}
        </RunTableBlock>
      )}

      {entries.length === 0 ? (
        <section>
          <SectionLabel>Finished</SectionLabel>
          <div className="px-1 text-[11px] text-muted-foreground/70">
            No runs yet. Session digests, titles and summaries land here as they run.
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <SectionLabel
            right={
              <button
                type="button"
                onClick={() => { clearTelemetryBlock(); setEntries([]) }}
                className="ml-auto text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            }
          >
            Finished
          </SectionLabel>
          {finishedGroups.map(group => {
            const showAll = openGroups.has(group.origin.id)
            const rows = groupFinishedBlock(group.entries)
            const visible = showAll ? rows : rows.slice(0, GROUP_VISIBLE)
            return (
              <RunTableBlock
                key={group.origin.id}
                title={`${group.origin.label} · ${group.entries.length} ${group.entries.length === 1 ? 'run' : 'runs'}${group.failed ? ` · ${group.failed} failed` : ''}`}
                grid={FINISHED_GRID}
                head={['', 'Subject', 'Job', 'Out', 'e2e/s', 'Took', 'At']}
                right={group.summary && (
                  <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{group.summary}</span>
                )}
              >
                {visible.map(renderFinishedRow)}
                {rows.length > visible.length && (
                  <button
                    type="button"
                    onClick={() => setOpenGroups(prev => new Set(prev).add(group.origin.id))}
                    className="block w-full px-1 py-1.5 pl-7 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    +{rows.length - visible.length} more
                  </button>
                )}
              </RunTableBlock>
            )
          })}
        </section>
      )}
    </div>
  )
}
