import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Trash2, Copy, Check, ChevronDown, ChevronRight, AlertCircle, AlertTriangle, Info, Bug, Cpu } from 'lucide-react'
import type { DebugLogEntryBlock, DebugLogLevel } from '@/services/lego_blocks/units/debugLogBlock'
import { useVisibleIntervalBlock } from '../hooks/shared/useVisibleIntervalBlock'
import {
  beginFrameRecordingBlock,
  clearFrameRecordingsBlock,
  endFrameRecordingBlock,
  isFrameRecordingBlock,
  listFrameRecordingsBlock,
  type FrameRecordingBlock,
} from '@/services/lego_blocks/units/frameTimingBlock'

interface DebugPanelBlockProps {
  entries: DebugLogEntryBlock[]
  isOpen: boolean
  onClose: () => void
  onClear: () => void
}

type TabFilter = 'all' | 'error' | 'warn' | 'info' | 'debug' | 'performance'

interface DebugHostProcessMetricBlock {
  pid: number
  type: string
  name: string | null
  serviceName: string | null
  cpuPercent: number
  idleWakeupsPerSecond: number
  workingSetBytes: number
  peakWorkingSetBytes: number
  threads: number | null
}

interface DebugHostPerformanceSnapshotBlock {
  appCpuPercent: number
  appMemoryWorkingSetBytes: number
  appMemoryPeakWorkingSetBytes: number
  processCount: number
  threadCount: number | null
  browserProcessCount: number
  rendererProcessCount: number
  utilityProcessCount: number
  gpuProcessCount: number
  logicalCpuCount: number
  gpuProcessCpuPercent: number | null
  gpuProcessMemoryWorkingSetBytes: number | null
  gpuRenderer: string | null
  gpuModel: string | null
  gpuFeatureStatus: Record<string, string>
  topProcesses: DebugHostProcessMetricBlock[]
}

const LEVEL_CONFIG: Record<DebugLogLevel, {
  icon: typeof AlertCircle
  badge: string
  text: string
  rail: string
  bg: string
}> = {
  error: {
    icon: AlertCircle,
    badge: 'bg-red-500/15 dark:bg-red-500/25 text-red-600 dark:text-red-300 border-red-500/30',
    text: 'text-red-500 dark:text-red-400',
    rail: 'bg-red-500',
    bg: 'hover:bg-red-500/[0.04]',
  },
  warn: {
    icon: AlertTriangle,
    badge: 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
    rail: 'bg-amber-500',
    bg: 'hover:bg-amber-500/[0.04]',
  },
  info: {
    icon: Info,
    badge: 'bg-blue-500/15 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300 border-blue-500/30',
    text: 'text-blue-600 dark:text-blue-400',
    rail: 'bg-blue-500',
    bg: 'hover:bg-blue-500/[0.04]',
  },
  debug: {
    icon: Info,
    badge: 'bg-muted/60 text-muted-foreground border-border/40',
    text: 'text-muted-foreground',
    rail: 'bg-muted-foreground/40',
    bg: 'hover:bg-muted/30',
  },
}

function humanizeMessageBlock(message: string): string {
  if (!message) return message
  return message.replace(/file:\/\/[^\s'"]+/g, uri => {
    try {
      const decoded = decodeURI(uri).replace(/^file:\/\/+/, '')
      return decoded || uri
    } catch {
      return uri
    }
  })
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  const ms = d.getMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function LogEntry({ entry }: { entry: DebugLogEntryBlock }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const cfg = LEVEL_CONFIG[entry.level] ?? LEVEL_CONFIG.debug
  const Icon = cfg.icon
  const hasExtra = !!(entry.details || entry.stack)

  const handleCopy = async () => {
    const text = [
      `[${entry.level.toUpperCase()}] ${formatTime(entry.timestamp)}${entry.source ? ` (${entry.source})` : ''}`,
      entry.message,
      entry.details ? `Details: ${entry.details}` : '',
      entry.stack ? `Stack:\n${entry.stack}` : '',
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  const message = humanizeMessageBlock(entry.message)

  return (
    <div className={`group relative border-b border-border/40 py-2.5 pl-4 pr-3 transition-colors ${cfg.bg}`}>
      {/* Coloured rail aligned with the level */}
      <span className={`pointer-events-none absolute inset-y-2 left-1 w-0.5 rounded-full ${cfg.rail}`} aria-hidden />

      <div className="flex items-start gap-2.5">
        <Icon className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${cfg.text}`} />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${cfg.badge}`}>
              {entry.level}
            </span>
            {entry.source && (
              <span className="rounded-md bg-muted/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                {entry.source}
              </span>
            )}
            <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/60">
              {formatTime(entry.timestamp)}
            </span>
          </div>

          <p className="break-words text-[13px] leading-snug text-foreground/90">{message}</p>

          {hasExtra && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}

          {expanded && (
            <div className="mt-2 space-y-2">
              {entry.details && (
                <pre className="whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {humanizeMessageBlock(entry.details)}
                </pre>
              )}
              {entry.stack && (
                <pre className="whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-red-500/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-red-600/90 dark:text-red-300/80">
                  {entry.stack}
                </pre>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy entry"
          className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-muted/60 hover:text-foreground group-hover:opacity-100"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

const TABS: { id: TabFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'info', label: 'Info' },
  { id: 'debug', label: 'Debug' },
  { id: 'performance', label: 'Performance' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const perfMemory = (): { used: number; total: number; limit: number } | null => {
  const mem = (performance as any).memory
  if (!mem) return null
  return { used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit }
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function fmtGpuStatus(value: string | undefined): string {
  if (!value) return 'Unknown'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="font-mono text-xs text-foreground/90">{value}</span>
        {sub && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/60">{sub}</span>}
      </div>
    </div>
  )
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</p>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  )
}

function UsageBar({
  used,
  total,
  usedLabel,
  totalLabel,
}: {
  used: number
  total: number
  usedLabel: string
  totalLabel: string
}) {
  const safeTotal = total > 0 ? total : 1
  const usedPct = Math.round((used / safeTotal) * 100)
  const totalPct = Math.min(100, Math.round((total / safeTotal) * 100))
  const usedColor = usedPct > 80 ? 'bg-red-500' : usedPct > 60 ? 'bg-yellow-400' : 'bg-blue-400'
  return (
    <div className="mt-2 space-y-1">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/50">
        <div className={`absolute left-0 top-0 h-full rounded-full opacity-30 ${usedColor}`} style={{ width: `${totalPct}%` }} />
        <div className={`absolute left-0 top-0 h-full rounded-full ${usedColor}`} style={{ width: `${usedPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/60">
        <span>{usedLabel}</span>
        <span>{usedPct}% of {totalLabel}</span>
      </div>
    </div>
  )
}

function HeapBar({ used, limit }: { used: number; limit: number }) {
  return (
    <UsageBar
      used={used}
      total={limit}
      usedLabel={`${fmtBytes(used)} used`}
      totalLabel={fmtBytes(limit)}
    />
  )
}

/**
 * Frame recorder. Deliberately manual: the measurement that matters is a
 * pointer interaction (pan at min zoom, pan at max zoom, drag a card), and a
 * button that records a fixed window while a human drives is the only honest
 * way to capture that. Label it with what you did so two runs are comparable.
 */
function FrameRecorderSection() {
  const [recordings, setRecordings] = useState<FrameRecordingBlock[]>(() => listFrameRecordingsBlock())
  const [recording, setRecording] = useState(() => isFrameRecordingBlock())
  const [label, setLabel] = useState('pan')

  const start = () => {
    beginFrameRecordingBlock(label.trim() || 'unlabelled')
    setRecording(true)
  }
  const stop = () => {
    endFrameRecordingBlock()
    setRecording(false)
    setRecordings([...listFrameRecordingsBlock()])
  }

  return (
    <MetricSection title="Frame Timing">
      <div className="flex items-center gap-1.5 pb-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="what are you doing?"
          disabled={recording}
          className="min-w-0 flex-1 rounded border border-border/50 bg-background px-2 py-1 text-[11px] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={recording ? stop : start}
          className={`shrink-0 rounded px-2.5 py-1 text-[11px] font-medium ${
            recording
              ? 'bg-red-500/15 text-red-600 dark:text-red-300'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          {recording ? 'Stop' : 'Record'}
        </button>
        {recordings.length > 0 && (
          <button
            type="button"
            onClick={() => { clearFrameRecordingsBlock(); setRecordings([]) }}
            className="shrink-0 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/60"
          >
            Clear
          </button>
        )}
      </div>

      {recording && (
        <div className="pb-2 text-[11px] text-muted-foreground">
          Recording — pan or drag now, then press Stop.
        </div>
      )}

      {recordings.length === 0 && !recording && (
        <div className="pb-1 text-[11px] leading-relaxed text-muted-foreground">
          Records rAF deltas while you drive the canvas. Nothing runs until you
          press Record. Compare the same action at both zoom extremes.
        </div>
      )}

      {recordings.map((r, i) => (
        <div key={`${r.startedAt}-${i}`} className="border-b border-border/30 py-1.5 last:border-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-medium">{r.label}</span>
            <span className={`shrink-0 font-mono text-[11px] tabular-nums ${
              r.fps >= 55 ? 'text-emerald-600 dark:text-emerald-400'
                : r.fps >= 40 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
            }`}>
              {r.fps.toFixed(0)} fps
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            p50 {r.p50.toFixed(1)} · p95 {r.p95.toFixed(1)} · worst {r.worst.toFixed(0)}ms
          </div>
          <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {r.longFrames} dropped{r.hitches > 0 ? ` · ${r.hitches} hitches` : ''} of {r.frames}
          </div>
        </div>
      ))}
    </MetricSection>
  )
}

function PerformanceTab() {
  const [tick, setTick] = useState(0)
  const [hostMetrics, setHostMetrics] = useState<DebugHostPerformanceSnapshotBlock | null>(null)
  const [hostMetricsError, setHostMetricsError] = useState<string | null>(null)

  useVisibleIntervalBlock(() => setTick(t => t + 1), 1000)

  const hasHostSnapshot = Boolean(window.electronAPI?.debugPerformanceSnapshot)
  const disposedRef = useRef(false)
  const pollingRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    return () => { disposedRef.current = true }
  }, [])

  const loadHostMetrics = useCallback(async () => {
    if (pollingRef.current) return
    pollingRef.current = true
    try {
      const snapshot = await window.electronAPI?.debugPerformanceSnapshot?.()
      if (!disposedRef.current && snapshot) {
        setHostMetrics(snapshot)
        setHostMetricsError(null)
      }
    } catch (error) {
      if (!disposedRef.current) {
        setHostMetricsError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      pollingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!hasHostSnapshot) {
      setHostMetrics(null)
      setHostMetricsError(null)
      return
    }
    void loadHostMetrics()
  }, [hasHostSnapshot, loadHostMetrics])

  useVisibleIntervalBlock(
    () => { void loadHostMetrics() },
    hasHostSnapshot ? 1000 : null,
  )

  const mem = perfMemory()
  const uptime = performance.now()
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const resources = performance.getEntriesByType('resource')
  const transferTotal = resources.reduce((s, r) => s + ((r as PerformanceResourceTiming).transferSize ?? 0), 0)
  const gpuCompositingStatus = fmtGpuStatus(hostMetrics?.gpuFeatureStatus.gpu_compositing)
  const gpuWebglStatus = fmtGpuStatus(hostMetrics?.gpuFeatureStatus.webgl)

  return (
    <div className="space-y-3 p-3">
      <FrameRecorderSection />
      {hostMetrics && (
        <>
          <MetricSection title="App Health">
            <MetricRow label="App CPU" value={fmtPercent(hostMetrics.appCpuPercent)} sub={`${hostMetrics.logicalCpuCount} logical cores`} />
            <MetricRow label="App RAM Used" value={fmtBytes(hostMetrics.appMemoryWorkingSetBytes)} sub={`${hostMetrics.processCount} processes`} />
            <MetricRow label="App Peak RAM" value={fmtBytes(hostMetrics.appMemoryPeakWorkingSetBytes)} />
            <MetricRow label="Threads" value={hostMetrics.threadCount != null ? String(hostMetrics.threadCount) : 'Unavailable'} sub={`${hostMetrics.rendererProcessCount} renderer · ${hostMetrics.utilityProcessCount} utility`} />
          </MetricSection>

          <MetricSection title="App Memory">
            <MetricRow label="RAM Used" value={fmtBytes(hostMetrics.appMemoryWorkingSetBytes)} sub={`${hostMetrics.processCount} processes`} />
            <MetricRow label="Peak RAM" value={fmtBytes(hostMetrics.appMemoryPeakWorkingSetBytes)} />
            <div className="pb-1.5 pt-0.5">
              <UsageBar
                used={hostMetrics.appMemoryWorkingSetBytes}
                total={Math.max(hostMetrics.appMemoryPeakWorkingSetBytes, hostMetrics.appMemoryWorkingSetBytes, 1)}
                usedLabel={`${fmtBytes(hostMetrics.appMemoryWorkingSetBytes)} used`}
                totalLabel={`peak ${fmtBytes(Math.max(hostMetrics.appMemoryPeakWorkingSetBytes, hostMetrics.appMemoryWorkingSetBytes))}`}
              />
            </div>
          </MetricSection>

          <MetricSection title="GPU">
            <MetricRow label="GPU process CPU" value={hostMetrics.gpuProcessCpuPercent != null ? fmtPercent(hostMetrics.gpuProcessCpuPercent) : 'Unavailable'} />
            <MetricRow label="GPU process RAM" value={hostMetrics.gpuProcessMemoryWorkingSetBytes != null ? fmtBytes(hostMetrics.gpuProcessMemoryWorkingSetBytes) : 'Unavailable'} sub={`${hostMetrics.gpuProcessCount} processes`} />
            <MetricRow label="GPU compositing" value={gpuCompositingStatus} />
            <MetricRow label="WebGL" value={gpuWebglStatus} />
            {(hostMetrics.gpuModel || hostMetrics.gpuRenderer) && (
              <MetricRow
                label="Renderer"
                value={hostMetrics.gpuModel ?? hostMetrics.gpuRenderer ?? 'Unknown'}
                sub={hostMetrics.gpuModel && hostMetrics.gpuRenderer && hostMetrics.gpuRenderer !== hostMetrics.gpuModel ? hostMetrics.gpuRenderer : undefined}
              />
            )}
          </MetricSection>

          <MetricSection title="Top Processes">
            {hostMetrics.topProcesses.map((processMetric) => (
              <div key={`${processMetric.pid}-${processMetric.type}`} className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs text-foreground/90">
                    {processMetric.name || processMetric.serviceName || processMetric.type}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    pid {processMetric.pid} · {processMetric.type}
                    {processMetric.threads != null ? ` · ${processMetric.threads} threads` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-foreground/90">{fmtPercent(processMetric.cpuPercent)}</p>
                  <p className="font-mono text-[10px] text-muted-foreground/60">{fmtBytes(processMetric.workingSetBytes)}</p>
                </div>
              </div>
            ))}
          </MetricSection>
        </>
      )}

      {hostMetricsError && (
        <MetricSection title="Host Metrics">
          <div className="py-2 text-xs text-muted-foreground/50">{hostMetricsError}</div>
        </MetricSection>
      )}

      {/* Memory */}
      {mem ? (
        <MetricSection title="Memory">
          <MetricRow label="JS Heap Used" value={fmtBytes(mem.used)} sub={`/ ${fmtBytes(mem.total)} allocated`} />
          <MetricRow label="Heap Limit" value={fmtBytes(mem.limit)} />
          <div className="pb-1.5 pt-0.5">
            <HeapBar used={mem.used} limit={mem.limit} />
          </div>
        </MetricSection>
      ) : (
        <MetricSection title="Memory">
          <div className="py-2 text-xs text-muted-foreground/50">Not available in this environment</div>
        </MetricSection>
      )}

      {/* Runtime */}
        <MetricSection title="Runtime">
          <MetricRow label="Uptime" value={fmtUptime(uptime)} />
          <MetricRow label="Resources loaded" value={String(resources.length)} sub={transferTotal > 0 ? fmtBytes(transferTotal) + ' transferred' : undefined} />
          {hostMetrics && <MetricRow label="Browser process" value={String(hostMetrics.browserProcessCount)} sub={`${hostMetrics.processCount} total app processes`} />}
        </MetricSection>

      {/* Navigation timing */}
      {nav && (
        <MetricSection title="Navigation Timing">
          <MetricRow label="DNS lookup" value={`${Math.round(nav.domainLookupEnd - nav.domainLookupStart)} ms`} />
          <MetricRow label="TCP connect" value={`${Math.round(nav.connectEnd - nav.connectStart)} ms`} />
          <MetricRow label="TTFB" value={`${Math.round(nav.responseStart - nav.requestStart)} ms`} />
          <MetricRow label="DOM interactive" value={`${Math.round(nav.domInteractive)} ms`} />
          <MetricRow label="DOM complete" value={`${Math.round(nav.domComplete)} ms`} />
          <MetricRow label="Load event" value={`${Math.round(nav.loadEventEnd)} ms`} />
        </MetricSection>
      )}

      <p className="text-right text-[10px] text-muted-foreground/40">Refreshes every second · tick {tick}</p>
    </div>
  )
}

export default function DebugPanelBlock({ entries, isOpen, onClose, onClear }: DebugPanelBlockProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [copiedAll, setCopiedAll] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const isPerfTab = activeTab === 'performance'

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (!autoScroll || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [entries, autoScroll])

  const filtered = activeTab === 'all'
    ? entries
    : entries.filter(e => e.level === activeTab)

  const countFor = (tab: TabFilter) => {
    if (tab === 'performance') return 0
    return tab === 'all' ? entries.length : entries.filter(e => e.level === tab).length
  }

  const handleCopyAll = async () => {
    const text = filtered.map(e => [
      `[${e.level.toUpperCase()}] ${formatTime(e.timestamp)}${e.source ? ` (${e.source})` : ''}`,
      e.message,
      e.details ? `Details: ${e.details}` : '',
      e.stack ? `Stack:\n${e.stack}` : '',
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  const handleScroll = () => {
    if (!listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[88] bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden
        />
      )}

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Debug console"
        aria-hidden={!isOpen}
        className={`fixed right-0 top-0 z-[89] flex h-full w-[520px] max-w-[96vw] flex-col border-l border-border/60 bg-background/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-semibold text-foreground">Debug Console</span>
          {!isPerfTab && (
            <>
              <button
                type="button"
                onClick={handleCopyAll}
                disabled={filtered.length === 0}
                title="Copy visible entries"
                aria-label="Copy visible entries"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedAll ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={entries.length === 0}
                title="Clear all entries"
                aria-label="Clear all entries"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close debug panel"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="ltm-nav-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 pt-1">
          {TABS.map(tab => {
            const count = countFor(tab.id)
            const isActive = activeTab === tab.id
            const hasErrors = tab.id === 'error' && count > 0
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative shrink-0 whitespace-nowrap rounded-t px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-px after:bg-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.id === 'performance' && <Cpu className="h-3 w-3 shrink-0" />}
                {tab.label}
                {count > 0 && (
                  <span className={`rounded px-1 py-px text-[10px] tabular-nums font-semibold ${
                    hasErrors
                      ? 'bg-red-500/20 text-red-400'
                      : isActive
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-muted/50 text-muted-foreground'
                  }`}>
                    {count > 999 ? '999+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Content */}
        {isPerfTab ? (
          <div ref={listRef} className="ltm-nav-scroll min-h-0 flex-1 overflow-y-auto">
            <PerformanceTab />
          </div>
        ) : (
          <>
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="ltm-nav-scroll min-h-0 flex-1 overflow-y-auto"
            >
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <Bug className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground/60">No {activeTab === 'all' ? '' : activeTab + ' '}entries yet</p>
                </div>
              ) : (
                <div>
                  {filtered.map(entry => <LogEntry key={entry.id} entry={entry} />)}
                </div>
              )}
            </div>

            {/* Footer — auto-scroll toggle */}
            <div className="flex shrink-0 items-center justify-between border-t border-border/40 px-4 py-2">
              <span className="text-[11px] text-muted-foreground/60">
                {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAutoScroll(v => {
                    if (!v && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
                    return !v
                  })
                }}
                className={`text-[11px] transition-colors ${autoScroll ? 'text-blue-400 hover:text-blue-300' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
              >
                {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
