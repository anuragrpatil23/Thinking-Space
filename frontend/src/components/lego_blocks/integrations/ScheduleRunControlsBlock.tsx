// Run controls + live log + transcript history for the active schedule.
// Layout (top to bottom):
//   - Status bar (pill, pid, enable toggle, Fire/Delete)
//   - Live log pane (visible while firing; collapses on idle to show last
//     fire's feedback line)
//   - Transcript history list (newest first, click to expand inline)

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { cn } from '@/lib/utils'
import {
  deleteAndUnloadScheduleOrch,
  fireScheduleNowOrch,
  listScheduleTranscriptsOrch,
  readScheduleTranscriptOrch,
  saveAndSyncScheduleOrch,
} from '@/services/orchestrators/schedulesOrch'
import {
  getLaunchctlStatusBlock,
  getTelegramConvStatusBlock,
  type ScheduleRunChunkBlock,
  type ScheduleSpecBlock,
  type ScheduleStatusBlock,
  type TelegramConvStatusBlock,
  type TranscriptEntryBlock,
} from '@/services/lego_blocks/integrations/schedulesBlock'

interface Props {
  spec: ScheduleSpecBlock
  /** Called when something changes that the parent should re-fetch (toggle, fire result, etc.). */
  onChanged?: () => void
}

interface RunFeedback {
  state: 'idle' | 'running' | 'error' | 'success'
  message?: string
}

const MAX_LIVE_LINES = 2000

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return iso
  }
}

const EMPTY_CONV_STATUS: TelegramConvStatusBlock = {
  hasConversation: false, conv: null, isActive: false, lastInboundAt: null, inboundCount: 0,
}

// Poll cadence while a telegram conversation is active. Conv state changes
// come from two slow sources — user replies via the bot (seconds to minutes)
// and the wrap-up `close_conversation` capability call (only on session end).
// 3s is fast enough to feel live without thrashing fs reads.
const ACTIVE_POLL_INTERVAL_MS = 3000

export default function ScheduleRunControlsBlock({ spec, onChanged }: Props) {
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(spec.enabled)
  const [status, setStatus] = useState<ScheduleStatusBlock>({ loaded: false, pid: null, lastExitCode: null })
  const [convStatus, setConvStatus] = useState<TelegramConvStatusBlock>(EMPTY_CONV_STATUS)
  const [feedback, setFeedback] = useState<RunFeedback>({ state: 'idle' })
  const [liveLog, setLiveLog] = useState<ScheduleRunChunkBlock[]>([])
  const [transcripts, setTranscripts] = useState<TranscriptEntryBlock[]>([])
  const [openTranscript, setOpenTranscript] = useState<string | null>(null)
  const [openTranscriptBody, setOpenTranscriptBody] = useState<string>('')
  const [transcriptsLoading, setTranscriptsLoading] = useState(false)
  const liveLogRef = useRef<HTMLPreElement | null>(null)

  const isTelegramConvSpec =
    spec.execution.kind === 'claude-code' && spec.execution.telegramConversation === true

  useEffect(() => { setEnabled(spec.enabled) }, [spec.enabled])

  useEffect(() => {
    let cancelled = false
    getLaunchctlStatusBlock(spec.label).then((s) => { if (!cancelled) setStatus(s) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [spec.label])

  const refreshTranscripts = useCallback(async () => {
    setTranscriptsLoading(true)
    try {
      const next = await listScheduleTranscriptsOrch(spec.key)
      setTranscripts(next)
    } catch {
      // ignore — transcripts dir may simply not exist yet
    } finally {
      setTranscriptsLoading(false)
    }
  }, [spec.key])

  useEffect(() => {
    refreshTranscripts()
    setOpenTranscript(null)
    setOpenTranscriptBody('')
    setLiveLog([])
    setFeedback({ state: 'idle' })
    setConvStatus(EMPTY_CONV_STATUS)
  }, [spec.key, refreshTranscripts])

  // Poll the telegram conversation state for this schedule. Cheap (a single
  // directory scan + JSON read) but only run for schedules that actually
  // opt in to the conversation pattern, and only re-poll on the active
  // cadence while the conv is open. Once closed we stop the timer until the
  // next fire.
  useEffect(() => {
    if (!isTelegramConvSpec) {
      setConvStatus(EMPTY_CONV_STATUS)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const next = await getTelegramConvStatusBlock(spec.key)
        if (cancelled) return
        setConvStatus(next)
        // Also refresh transcripts so resume turns written by the poller
        // show up without a manual reload.
        if (next.isActive) refreshTranscripts()
        const delay = next.isActive ? ACTIVE_POLL_INTERVAL_MS : 15_000
        timer = setTimeout(tick, delay)
      } catch {
        if (cancelled) return
        timer = setTimeout(tick, 15_000)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [spec.key, isTelegramConvSpec, refreshTranscripts])

  // Auto-scroll live log to bottom on new chunks.
  useEffect(() => {
    if (feedback.state === 'running' && liveLogRef.current) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight
    }
  }, [liveLog, feedback.state])

  const handleChunk = useCallback((chunk: ScheduleRunChunkBlock) => {
    setLiveLog((prev) => {
      const next = [...prev, chunk]
      return next.length > MAX_LIVE_LINES ? next.slice(-MAX_LIVE_LINES) : next
    })
  }, [])

  const handleFire = useCallback(async () => {
    setLiveLog([])
    setFeedback({ state: 'running' })
    try {
      const result = await fireScheduleNowOrch(spec, { onChunk: handleChunk })
      const ok = result.exitCode === 0
      const successMessage = isTelegramConvSpec
        ? `First turn sent in ${result.durationMs}ms · awaiting Telegram reply`
        : `Exit 0 · ${result.durationMs}ms`
      setFeedback({
        state: ok ? 'success' : 'error',
        message: ok ? successMessage : `Exit ${result.exitCode ?? 'null'} · see transcript`,
      })
      refreshTranscripts()
      // Kick conv status to refresh immediately so the pill flips to
      // "Awaiting reply" without waiting for the next poll tick.
      if (isTelegramConvSpec && ok) {
        getTelegramConvStatusBlock(spec.key).then(setConvStatus).catch(() => undefined)
      }
    } catch (err) {
      setFeedback({ state: 'error', message: err instanceof Error ? err.message : 'Fire failed' })
    } finally {
      onChanged?.()
    }
  }, [spec, handleChunk, refreshTranscripts, onChanged])

  const handleToggle = useCallback(async (next: boolean) => {
    setEnabled(next)
    setFeedback({ state: 'running' })
    try {
      await saveAndSyncScheduleOrch({ ...spec, enabled: next, updatedAt: new Date().toISOString() })
      const refreshed = await getLaunchctlStatusBlock(spec.label).catch(() => null)
      if (refreshed) setStatus(refreshed)
      setFeedback({ state: 'idle' })
    } catch (err) {
      setEnabled(!next)
      setFeedback({ state: 'error', message: err instanceof Error ? err.message : 'Toggle failed' })
    } finally {
      onChanged?.()
    }
  }, [spec, onChanged])

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete schedule "${spec.title}"? This removes the launchd plist.`)) return
    setFeedback({ state: 'running' })
    try {
      await deleteAndUnloadScheduleOrch(spec.key)
      navigate('/ai/schedules')
      onChanged?.()
    } catch (err) {
      setFeedback({ state: 'error', message: err instanceof Error ? err.message : 'Delete failed' })
    }
  }, [spec.key, spec.title, navigate, onChanged])

  const handleOpenTranscript = useCallback(async (filename: string) => {
    if (openTranscript === filename) {
      setOpenTranscript(null)
      setOpenTranscriptBody('')
      return
    }
    setOpenTranscript(filename)
    setOpenTranscriptBody('Loading…')
    try {
      const body = await readScheduleTranscriptOrch(spec.key, filename)
      setOpenTranscriptBody(body)
    } catch (err) {
      setOpenTranscriptBody(err instanceof Error ? `Failed to read: ${err.message}` : 'Failed to read transcript')
    }
  }, [spec.key, openTranscript])

  // Telegram-conversation schedules have a second axis of "doneness" that
  // overrides the launchd loaded/not-loaded pill: even when the launchd job
  // is loaded and the runner has long since exited 0, the conversation may
  // still be open and awaiting a user reply. Surface that explicitly so
  // exit-0 doesn't read as "done."
  const pill = !enabled
    ? { text: 'Disabled', tone: 'muted' as const }
    : convStatus.isActive
      ? { text: 'Awaiting reply', tone: 'info' as const }
      : isTelegramConvSpec && convStatus.hasConversation && convStatus.conv?.status === 'closed'
        ? {
            text: convStatus.conv?.closeReason
              ? `Closed (${convStatus.conv.closeReason})`
              : 'Closed',
            tone: 'good' as const,
          }
        : status.loaded
          ? { text: 'Loaded', tone: 'good' as const }
          : { text: 'Not loaded', tone: 'warn' as const }

  const showLiveLog = feedback.state === 'running' || liveLog.length > 0

  return (
    <div className="space-y-3">
      {/* Status + actions */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                pill.tone === 'good' && 'bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300',
                pill.tone === 'warn' && 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300',
                pill.tone === 'info' && 'bg-sky-500/15 dark:bg-sky-500/25 text-sky-700 dark:text-sky-300',
                pill.tone === 'muted' && 'bg-muted text-muted-foreground',
              )}
            >
              {pill.text}
            </span>
            {status.pid && <span className="text-xs text-muted-foreground">pid {status.pid}</span>}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <Switch checked={enabled} onCheckedChange={handleToggle} disabled={feedback.state === 'running'} />
              Enabled
            </label>
            <Button size="sm" onClick={handleFire} disabled={!enabled || feedback.state === 'running'}>
              {feedback.state === 'running'
                ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                : <Play className="mr-1 h-4 w-4" />}
              Fire now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={feedback.state === 'running'}
              className="text-destructive"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {feedback.message && (
          <div className={cn('mt-2 flex items-center gap-1 text-xs', feedback.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {feedback.state === 'error' && <AlertCircle className="h-3 w-3" />}
            {feedback.message}
          </div>
        )}
        {isTelegramConvSpec && convStatus.hasConversation && (
          <div className="mt-2 text-xs text-muted-foreground">
            <span className="font-mono">{convStatus.conv?.convId}</span>
            {' · '}
            {convStatus.inboundCount} repl{convStatus.inboundCount === 1 ? 'y' : 'ies'}
            {convStatus.lastInboundAt && (
              <> · last {formatTimestamp(convStatus.lastInboundAt)}</>
            )}
          </div>
        )}
      </section>

      {/* Live log */}
      {showLiveLog && (
        <section className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {feedback.state === 'running' ? 'Live output' : 'Last run output'}
            </div>
            {feedback.state === 'running' && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                streaming
              </span>
            )}
          </div>
          <pre
            ref={liveLogRef}
            className="max-h-72 overflow-y-auto bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-snug text-zinc-100"
          >
            {liveLog.length === 0
              ? <span className="text-zinc-500">(no output yet)</span>
              : liveLog.map((chunk, i) => {
                  const hhmmss = chunk.timestamp.slice(11, 19)
                  return (
                    <div key={i} className="whitespace-pre-wrap break-words">
                      <span className="select-none pr-2 text-zinc-500">{hhmmss}</span>
                      <span className={chunk.channel === 'stderr' ? 'text-red-400' : 'text-zinc-100'}>
                        {chunk.line || ' '}
                      </span>
                    </div>
                  )
                })}
          </pre>
        </section>
      )}

      {/* Transcript history */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Run history
          </div>
          <span className="text-[10px] text-muted-foreground">
            {transcriptsLoading ? 'loading…' : `${transcripts.length} run${transcripts.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {transcripts.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No runs yet. Click <strong>Fire now</strong> to test, or wait for the next scheduled time.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {transcripts.map((t) => {
              const isOpen = openTranscript === t.filename
              return (
                <li key={t.filename}>
                  <button
                    type="button"
                    onClick={() => handleOpenTranscript(t.filename)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/40"
                  >
                    {isOpen
                      ? <ChevronDown className="h-3 w-3 shrink-0" />
                      : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="flex-1 font-mono">{formatTimestamp(t.startedAt)}</span>
                    <span className="text-[10px] text-muted-foreground">{formatBytes(t.sizeBytes)}</span>
                  </button>
                  {isOpen && (
                    <pre className="max-h-72 overflow-y-auto bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words text-zinc-100">
                      {openTranscriptBody}
                    </pre>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
