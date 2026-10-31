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
import { Loader2, RotateCw, X } from 'lucide-react'
import { useAiEngineStatusBlock } from '@/components/lego_blocks/hooks/shared/useAiEngineStatusBlock'
import {
  describeEngineStateBlock,
  formatSecondsBlock,
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

/** Output tokens per second over the whole run. Includes prompt processing, so
 *  it reads a little under the model's pure decode speed. */
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

/** Subject first, job type second: "Thinking-Space · Oct 30" is what you are
 *  waiting for; "session-digest" is how it gets made. Jobs with no subject keep
 *  their type as the title. */
function RunTitle({ taskId, project, dateIso, muted }: { taskId: string; project?: string; dateIso?: string; muted?: boolean }) {
  const date = fmtSubjectDate(dateIso)
  const subject = [project, date].filter(Boolean).join(' · ')
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={cn('truncate font-medium', muted ? 'text-foreground/70' : 'text-foreground/90')}>
        {subject || taskId}
      </span>
      {subject && <span className="shrink-0 text-[10px] text-muted-foreground/80">{taskId}</span>}
    </span>
  )
}

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
function EngineBannerBlock({ now, waiting }: { now: number; waiting: number }) {
  const { engine } = useAiEngineStatusBlock(true)
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

/** The model most runs used, named once in the header instead of on every row. */
function mainModelBlock(models: Array<string | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const m of models) if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
  let best: string | null = null
  for (const [m, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = m
  return best
}

const STATUS_TONE: Record<TelemetryEntry['status'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'cache-hit': 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
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
  const otherModel = (m?: string) => (m && m !== mainModel ? m : null)
  const finishedRows = groupFinishedBlock(entries)

  return (
    <div className="space-y-4 p-3 text-xs">
      <EngineBannerBlock now={now} waiting={queued.length + running.filter(j => j.waitingForEngine).length} />
      {mainModel && (
        <div className="truncate text-[10px] text-muted-foreground/80">{mainModel}</div>
      )}
      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            In flight
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {running.length} running · {queued.length} queued
          </span>
        </div>
        {!busy ? (
          <div className="rounded-md border border-dashed border-border/50 px-3 py-2 text-[11px] text-muted-foreground/70">
            Nothing running. Two run at a time; the rest wait here.
          </div>
        ) : (
          <div className="space-y-1">
            {running.map(job => {
              const open = expandedKey === `run-${job.id}`
              return (
                <div
                  key={`run-${job.id}`}
                  className="rounded-md border border-border/40 bg-card/40"
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => setExpandedKey(open ? null : `run-${job.id}`)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {job.waitingForEngine
                        ? <RotateCw className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500" />
                        : <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
                      <RunTitle taskId={job.taskId} project={job.project} dateIso={job.dateIso} />
                      {otherModel(job.model) && <span className="truncate text-muted-foreground/70">{job.model}</span>}
                      {job.attempt != null && (
                        <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-500">
                          retry {job.attempt}/2{job.waitingForEngine ? ' · waiting for engine' : ''}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                        {fmtAgo(job.startedAt, now)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelRunningJobBlock(job.id)}
                      title="Cancel this run"
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-2 px-2.5 pb-2.5">
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
            {queued.map((job, i) => {
              const open = expandedKey === job.key
              return (
                <div
                  key={`q-${job.key}`}
                  className="rounded-md border border-dashed border-border/40 text-muted-foreground"
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => setExpandedKey(open ? null : job.key)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="w-3 shrink-0 text-center tabular-nums opacity-60">{i + 1}</span>
                      <RunTitle taskId={job.taskId} project={job.project} dateIso={job.dateIso} muted />
                      {job.priority === 'interactive' && (
                        <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                          next
                        </span>
                      )}
                      {otherModel(job.model) && <span className="truncate opacity-70">{job.model}</span>}
                      <span className="ml-auto shrink-0 tabular-nums">
                        waiting {fmtAgo(job.queuedAt, now)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelQueuedIntelligenceJobBlock(job.key)}
                      title="Drop this job from the queue"
                      className="shrink-0 rounded p-0.5 transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-2 px-2.5 pb-2.5">
                      <div className="text-[10px] text-muted-foreground/70">
                        {job.providerId ?? 'provider unknown'} · queued{' '}
                        {new Date(job.queuedAt).toLocaleTimeString()}
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
          </div>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Finished
          </span>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => { clearTelemetryBlock(); setEntries([]) }}
              className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/50 px-3 py-2 text-[11px] text-muted-foreground/70">
            No runs yet. Session digests, titles and summaries land here as they run.
          </div>
        ) : (
          <div className="space-y-1">
            {finishedRows.map(row => {
              if (row.kind === 'cache') {
                const first = row.entries[0]
                const groupOpen = expandedCache === first.id
                return (
                  <div key={`cache-${first.id}`} className="rounded-md border border-border/40">
                    <button
                      type="button"
                      onClick={() => setExpandedCache(groupOpen ? null : first.id)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                    >
                      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', STATUS_TONE['cache-hit'])}>
                        {row.entries.length === 1 ? 'cache-hit' : `${row.entries.length} cache hits`}
                      </span>
                      <span className="truncate font-medium text-foreground/90">{row.taskId}</span>
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {new Date(first.ts).toLocaleTimeString()}
                      </span>
                    </button>
                    {groupOpen && (
                      <div className="space-y-0.5 px-2.5 pb-2 text-[10px] text-muted-foreground">
                        {row.entries.map(e => (
                          <div key={e.id} className="flex gap-2">
                            <RunTitle taskId={e.taskId} project={e.project} dateIso={e.dateIso} muted />
                            <span className="ml-auto shrink-0 tabular-nums">{new Date(e.ts).toLocaleTimeString()}</span>
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
              return (
                <div key={entry.id} className="rounded-md border border-border/40">
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : entry.id)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', STATUS_TONE[entry.status])}>
                      {entry.status}
                    </span>
                    <RunTitle taskId={entry.taskId} project={entry.project} dateIso={entry.dateIso} />
                    {otherModel(entry.model) && <span className="truncate text-muted-foreground/70">{entry.model}</span>}
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
                      {entry.reasoning === 'on' && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-500">
                          thinking
                        </span>
                      )}
                      {entry.usage && (
                        <span>{entry.usage.promptTokens}→{entry.usage.completionTokens}</span>
                      )}
                      {tps != null && <span>{tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s</span>}
                      {entry.latencyMs > 0 && <span>{fmtMs(entry.latencyMs)}</span>}
                      <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-2 px-2.5 pb-2.5">
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
            })}
          </div>
        )}
      </section>
    </div>
  )
}
