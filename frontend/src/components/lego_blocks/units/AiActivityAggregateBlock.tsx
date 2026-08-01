import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  aggregateChainsByPeriodBlock,
  aggregateProjectMetricsByPeriodBlock,
  fmtDurationMsBlock,
  mergedDurationMsBlock,
  periodKeyOfBlock,
  projectDigestBlock,
  type AggregateGranularity,
  type ProjectPeriodMetrics,
} from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { formatTokens, formatUsd } from '@/services/lego_blocks/units/aiPriceTableBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import {
  AI_ACTIVITY_SET_MODE_EVENT,
  getAiActivitySetMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

interface AiActivityAggregateBlockProps {
  /** Chains to aggregate — caller pre-filters by project / source / range. */
  chains: ActivityChain[]
  /** Active project filter, used only to tint the relative-volume bars. */
  filterProject?: string | null
  /** Row click → drill into that period (clamped by the drill filter itself). */
  onSelectRange?: (range: { startIso: string; endIso: string } | null) => void
}

const GRANULARITIES_WEEK: ReadonlyArray<{ id: AggregateGranularity; label: string }> = [
  { id: 'week', label: 'week' },
  { id: 'month', label: 'month' },
  { id: 'year', label: 'year' },
]

const GRANULARITIES_SET: ReadonlyArray<{ id: AggregateGranularity; label: string }> = [
  { id: 'set', label: 'set' },
  { id: 'month', label: 'month' },
  { id: 'year', label: 'year' },
]

const GRANULARITY_STORAGE_KEY = 'thinkspc.aiActivity.aggGranularity.v1'
const DISPLAY_STORAGE_KEY = 'thinkspc.aiActivity.aggDisplay.v1'

type AggregateDisplay = 'table' | 'graph'
type GraphMetric = 'time' | 'chains' | 'msgs' | 'cost'

const METRIC_STORAGE_KEY = 'thinkspc.aiActivity.aggGraphMetric.v1'
const GRAPH_METRICS: ReadonlyArray<{ id: GraphMetric; label: string }> = [
  { id: 'time', label: 'time' },
  { id: 'chains', label: 'chains' },
  { id: 'msgs', label: 'msgs' },
  { id: 'cost', label: 'cost' },
]

/** Max named project segments per stacked bar — the rest roll into "other". */
const MAX_GRAPH_SERIES = 6
/** Stack key for the rolled-up remainder — parens keep it from colliding with a real project. */
const OTHER_KEY = '(other)'
const OTHER_COLOR = 'rgba(148,163,184,0.45)'

function metricValueOf(metric: GraphMetric, m: ProjectPeriodMetrics): number {
  if (metric === 'time') return m.durationMs / 3_600_000
  if (metric === 'chains') return m.chains
  if (metric === 'msgs') return m.msgs
  return m.costUsd
}

function fmtMetricValue(metric: GraphMetric, v: number): string {
  if (metric === 'time') return fmtDurationMsBlock(v * 3_600_000)
  if (metric === 'cost') return `~${formatUsd(v)}`
  return Math.round(v).toLocaleString()
}

function readStoredMetric(): GraphMetric | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(METRIC_STORAGE_KEY)
    if (raw === 'time' || raw === 'chains' || raw === 'msgs' || raw === 'cost') return raw
  } catch {
    /* localStorage unavailable */
  }
  return null
}

function readStoredGranularity(): AggregateGranularity | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(GRANULARITY_STORAGE_KEY)
    if (raw === 'week' || raw === 'set' || raw === 'month' || raw === 'year') return raw
  } catch {
    /* localStorage unavailable */
  }
  return null
}

function readStoredDisplay(): AggregateDisplay | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY)
    if (raw === 'table' || raw === 'graph') return raw
  } catch {
    /* localStorage unavailable */
  }
  return null
}

export default function AiActivityAggregateBlock({
  chains,
  filterProject = null,
  onSelectRange,
}: AiActivityAggregateBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [setMode, setSetMode] = useState<boolean>(() => getAiActivitySetMode())
  useEffect(() => {
    const onChange = () => setSetMode(getAiActivitySetMode())
    window.addEventListener(AI_ACTIVITY_SET_MODE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(AI_ACTIVITY_SET_MODE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const [granularity, setGranularityState] = useState<AggregateGranularity>(
    () => readStoredGranularity() ?? 'week',
  )
  // When set-mode is on, `week` and `set` are the same slot in the picker —
  // fold either stored value onto the currently-visible one so the row
  // aggregation and the highlighted chip stay in sync.
  const effectiveGranularity: AggregateGranularity =
    setMode && granularity === 'week'
      ? 'set'
      : !setMode && granularity === 'set'
        ? 'week'
        : granularity
  const GRANULARITIES = setMode ? GRANULARITIES_SET : GRANULARITIES_WEEK
  const setGranularity = (g: AggregateGranularity) => {
    try {
      window.localStorage.setItem(GRANULARITY_STORAGE_KEY, g)
    } catch {
      /* localStorage unavailable */
    }
    setGranularityState(g)
  }

  const [display, setDisplayState] = useState<AggregateDisplay>(
    () => readStoredDisplay() ?? 'table',
  )
  const setDisplay = (d: AggregateDisplay) => {
    try {
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, d)
    } catch {
      /* localStorage unavailable */
    }
    setDisplayState(d)
  }

  const [metric, setMetricState] = useState<GraphMetric>(() => readStoredMetric() ?? 'time')
  const setMetric = (m: GraphMetric) => {
    try {
      window.localStorage.setItem(METRIC_STORAGE_KEY, m)
    } catch {
      /* localStorage unavailable */
    }
    setMetricState(m)
  }

  // Bucket key of the current period under the effective granularity — used
  // to highlight "you are here" in both the table and the bar chart. Only
  // matters when set-mode is on (set), but it's cheap to compute unconditionally.
  const currentPeriodKey = useMemo(
    () => periodKeyOfBlock(new Date().toISOString(), effectiveGranularity),
    [effectiveGranularity],
  )

  const rows = useMemo(
    () => aggregateChainsByPeriodBlock(chains, effectiveGranularity),
    [chains, effectiveGranularity],
  )

  // Inline period summary: clicking a table row expands a per-project digest
  // ("what was worked on") instead of drilling immediately — the drill action
  // moves into the expanded panel, mirroring the day table's expand pattern.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const chainsByPeriodKey = useMemo(() => {
    const m = new Map<string, ActivityChain[]>()
    for (const c of chains) {
      const key = periodKeyOfBlock(c.startedIso, effectiveGranularity)
      const arr = m.get(key)
      if (arr) arr.push(c)
      else m.set(key, [c])
    }
    return m
  }, [chains, effectiveGranularity])
  const expandedDigest = useMemo(
    () => (expandedKey ? projectDigestBlock(chainsByPeriodKey.get(expandedKey) ?? []) : null),
    [expandedKey, chainsByPeriodKey],
  )

  const maxDurationMs = useMemo(
    () => rows.reduce((m, r) => (r.durationMs > m ? r.durationMs : m), 0),
    [rows],
  )

  // Grand totals across every period. Duration is interval-merged over ALL
  // chains (not a sum of per-period durations) so overlapping chains that
  // straddle a period boundary aren't double-counted.
  const totals = useMemo(() => {
    let chainCount = 0
    let sessions = 0
    let msgs = 0
    let inputTokens = 0
    let outputTokens = 0
    let costUsd = 0
    let hasTokens = false
    for (const r of rows) {
      chainCount += r.chains
      sessions += r.sessions
      msgs += r.msgs
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      costUsd += r.costUsd
      if (r.hasTokens) hasTokens = true
    }
    return {
      chains: chainCount,
      sessions,
      msgs,
      durationMs: mergedDurationMsBlock(chains),
      inputTokens,
      outputTokens,
      costUsd,
      hasTokens,
    }
  }, [rows, chains])

  const anyTokens = rows.some(r => r.hasTokens)
  const anyPartial = rows.some(r => r.chainsWithDuration < r.chains)
  const barColor = filterProject
    ? getProjectColor(filterProject, isDark).stroke
    : 'rgba(148,163,184,0.9)'

  // Stacked bar graph: one bar per period, stacked by project, showing the
  // selected metric (time/chains/msgs/cost). Top N projects by that metric get
  // named segments; the rest roll up into a gray "other" segment so stack
  // heights still equal the period total. Rows carry the period bounds so a
  // click can drill into that period, same as the graph always did.
  const graph = useMemo(() => {
    if (display !== 'graph') return null
    const { periods, series } = aggregateProjectMetricsByPeriodBlock(chains, effectiveGranularity)
    const ranked = series
      .map(s => ({ ...s, total: metricValueOf(metric, s.totals) }))
      .filter(s => s.total > 0)
      .sort((a, b) => b.total - a.total)
    const top = ranked.slice(0, MAX_GRAPH_SERIES)
    const rest = ranked.slice(MAX_GRAPH_SERIES)
    const round = (v: number) => Math.round(v * 100) / 100
    const points = periods.map((p, i) => {
      const row: Record<string, number | string> = {
        label: p.label,
        startIso: p.startIso,
        endIso: p.endIso,
      }
      for (const s of top) row[s.project] = round(metricValueOf(metric, s.perPeriod[i]))
      if (rest.length > 0) {
        row[OTHER_KEY] = round(
          rest.reduce((a, s) => a + metricValueOf(metric, s.perPeriod[i]), 0),
        )
      }
      return row
    })
    return { points, top, hiddenCount: rest.length }
  }, [display, chains, effectiveGranularity, metric])

  // Same zero-size mount guard as the trend chart — recharts'
  // ResponsiveContainer warns and renders nothing if measured at width 0.
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const [chartReady, setChartReady] = useState(false)
  useEffect(() => {
    if (display !== 'graph') return
    const node = chartHostRef.current
    if (!node) return
    const tick = () => setChartReady(node.clientWidth > 0 && node.clientHeight > 0)
    tick()
    const obs = new ResizeObserver(tick)
    obs.observe(node)
    return () => obs.disconnect()
  }, [display])

  return (
    <div ref={hostRef} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 p-0.5 w-fit">
          {GRANULARITIES.map(g => {
            const active = effectiveGranularity === g.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGranularity(g.id)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-all',
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {g.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 p-0.5 w-fit">
          {(['table', 'graph'] as const).map(d => {
            const active = display === d
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDisplay(d)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-all',
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-4 text-xs text-muted-foreground/70">
          No activity in this range.
        </div>
      ) : display === 'graph' && graph ? (
        <div className="rounded-lg border border-border/40 bg-card/40 px-2 pb-1 pt-2">
          <div className="flex items-center justify-end pb-1.5 pr-1">
            <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 p-0.5 w-fit">
              {GRAPH_METRICS.filter(m => m.id !== 'cost' || anyTokens).map(m => {
                const active = metric === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMetric(m.id)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-all',
                      active
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div ref={chartHostRef} className="h-52 min-w-0">
            {chartReady && (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={1}
              minHeight={1}
              initialDimension={{ width: 1, height: 1 }}
            >
              <BarChart
                data={graph.points}
                margin={{ top: 6, right: 10, bottom: 0, left: -18 }}
                onClick={evt => {
                  if (!onSelectRange) return
                  const payload = evt as {
                    activePayload?: Array<{ payload?: { startIso?: string; endIso?: string } }>
                  } | null
                  const row = payload?.activePayload?.[0]?.payload
                  if (row?.startIso && row?.endIso) {
                    onSelectRange({ startIso: row.startIso, endIso: row.endIso })
                  }
                }}
                style={{ cursor: onSelectRange ? 'pointer' : 'default' }}
              >
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                {(() => {
                  const currentPoint = graph.points.find(
                    p => p.startIso === currentPeriodKey,
                  )
                  if (!currentPoint) return null
                  const label = String(currentPoint.label)
                  return (
                    <ReferenceArea
                      x1={label}
                      x2={label}
                      fill="rgba(148,163,184,0.18)"
                      fillOpacity={1}
                      stroke="rgba(148,163,184,0.5)"
                      strokeOpacity={0.6}
                      ifOverflow="hidden"
                    />
                  )
                })()}
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                  tickFormatter={(v: number) =>
                    metric === 'time' ? `${v}h` : metric === 'cost' ? `$${v}` : String(v)
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const entries = payload
                      .filter(p => typeof p.value === 'number' && (p.value as number) > 0)
                      .sort((a, b) => (b.value as number) - (a.value as number))
                    if (entries.length === 0) return null
                    const total = entries.reduce((a, e) => a + (e.value as number), 0)
                    return (
                      <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                        <div className="flex items-baseline gap-3 text-foreground/70">
                          {String(label)}
                          <span className="ml-auto tabular-nums text-foreground/85">
                            {fmtMetricValue(metric, total)}
                          </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {entries.map(e => {
                            const key = String(e.dataKey)
                            const stroke =
                              key === OTHER_KEY ? OTHER_COLOR : getProjectColor(key, isDark).stroke
                            return (
                              <div key={key} className="flex items-baseline gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: stroke }}
                                />
                                <span className="text-foreground/80">
                                  {key === OTHER_KEY ? key : projectLabelBlock(key)}
                                </span>
                                <span
                                  className="ml-auto pl-3 tabular-nums"
                                  style={{ color: stroke }}
                                >
                                  {fmtMetricValue(metric, e.value as number)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  }}
                />
                {graph.top.map(s => (
                  <Bar
                    key={s.project}
                    dataKey={s.project}
                    stackId="period"
                    // Soft palette tint (matches the heatmap cells + trend bars)
                    // instead of full-saturation stroke — calmer, less busy.
                    fill={getProjectColor(s.project, isDark).fill}
                    fillOpacity={1}
                    isAnimationActive
                    animationDuration={450}
                    animationEasing="ease-out"
                  />
                ))}
                {graph.hiddenCount > 0 && (
                  <Bar
                    dataKey={OTHER_KEY}
                    stackId="period"
                    fill={OTHER_COLOR}
                    isAnimationActive
                    animationDuration={450}
                    animationEasing="ease-out"
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1 pt-1.5">
            {graph.top.map(s => {
              const color = getProjectColor(s.project, isDark)
              return (
                <span
                  key={s.project}
                  className="inline-flex items-center gap-1.5 text-[10px] text-foreground/70"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color.stroke }} />
                  {projectLabelBlock(s.project)}
                  <span className="tabular-nums text-muted-foreground/70">
                    {fmtMetricValue(metric, s.total)}
                  </span>
                </span>
              )
            })}
            {graph.hiddenCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: OTHER_COLOR }} />
                other · {graph.hiddenCount} more project{graph.hiddenCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/40 bg-card/40">
          {/* min-width keeps the fixed columns from collapsing/clipping in a
              narrow container (e.g. the docked graph panel) — it scrolls
              horizontally instead; at full width w-full just fills. */}
          <table className="w-full min-w-[440px] text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '130px' }} />
              <col />
              <col style={{ width: '70px' }} />
              <col style={{ width: '76px' }} />
              <col style={{ width: '64px' }} />
              <col style={{ width: '80px' }} />
              {anyTokens && <col style={{ width: '72px' }} />}
              {anyTokens && <col style={{ width: '72px' }} />}
              {anyTokens && <col style={{ width: '70px' }} />}
            </colgroup>
            <thead>
              <tr className="border-b border-border/30 text-left text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Period</th>
                <th className="px-2 py-1.5 font-medium" aria-label="Relative volume" />
                <th className="px-2 py-1.5 text-right font-medium">Chains</th>
                <th className="px-2 py-1.5 text-right font-medium">Sessions</th>
                <th className="px-2 py-1.5 text-right font-medium">Msgs</th>
                <th className="px-2 py-1.5 text-right font-medium">Time</th>
                {anyTokens && (
                  <th
                    className="px-2 py-1.5 text-right font-medium"
                    title="Fresh input tokens — cache reads/writes excluded"
                  >
                    Tok in
                  </th>
                )}
                {anyTokens && (
                  <th className="px-2 py-1.5 text-right font-medium" title="Output tokens">
                    Tok out
                  </th>
                )}
                {anyTokens && <th className="px-3 py-1.5 text-right font-medium">~Cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.key}>
                <tr
                  className={cn(
                    'cursor-pointer border-b border-border/20 transition-colors last:border-0',
                    'hover:bg-foreground/[0.04]',
                    expandedKey === r.key && 'bg-foreground/[0.04]',
                    r.key === currentPeriodKey && 'bg-foreground/[0.06] ring-1 ring-inset ring-foreground/25',
                  )}
                  onClick={() => setExpandedKey(prev => (prev === r.key ? null : r.key))}
                  title={r.key === currentPeriodKey ? 'Current period' : 'Click for a summary of this period'}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-foreground/85">
                    {r.label}
                    {r.key === currentPeriodKey && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-[0.1em] text-foreground/60">now</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="h-[6px] w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${maxDurationMs > 0 ? Math.max(2, (r.durationMs / maxDurationMs) * 100) : 0}%`,
                          background: barColor,
                          opacity: 0.55,
                        }}
                      />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/70">
                    {r.chains}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/70">
                    {r.sessions}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/80">
                    {r.msgs.toLocaleString()}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/80"
                    title={
                      r.chainsWithDuration < r.chains
                        ? `Only ${r.chainsWithDuration} of ${r.chains} chains have time data — the rest exist only as vault markdown (no timestamps or tokens), so this period undercounts.`
                        : undefined
                    }
                  >
                    {fmtDurationMsBlock(r.durationMs)}
                    {r.chainsWithDuration < r.chains && (
                      <span className="ml-0.5 text-amber-500/80">*</span>
                    )}
                  </td>
                  {anyTokens && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/70">
                      {r.hasTokens ? formatTokens(r.inputTokens) : '—'}
                    </td>
                  )}
                  {anyTokens && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/70">
                      {r.hasTokens ? formatTokens(r.outputTokens) : '—'}
                    </td>
                  )}
                  {anyTokens && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground/70">
                      {r.hasTokens ? `~${formatUsd(r.costUsd)}` : '—'}
                    </td>
                  )}
                </tr>
                {expandedKey === r.key && expandedDigest && (
                  <tr className="border-b border-border/20 bg-foreground/[0.02]">
                    <td
                      colSpan={anyTokens ? 9 : 6}
                      className="px-3 py-2"
                      style={{ width: 0, maxWidth: 0 }}
                    >
                      {expandedDigest.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground/70">
                          No project activity in this period.
                        </span>
                      ) : (
                        <div className="space-y-2">
                          {expandedDigest.map(d => {
                            const color = getProjectColor(d.project, isDark)
                            return (
                              <div key={d.project} className="space-y-0.5">
                                <div className="flex items-baseline gap-2 text-[11px]">
                                  <span
                                    className="inline-flex items-center gap-1.5 font-medium"
                                    style={{ color: color.stroke }}
                                  >
                                    <span
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={{ background: color.stroke }}
                                    />
                                    {projectLabelBlock(d.project)}
                                  </span>
                                  <span className="tabular-nums text-foreground/70">
                                    {fmtDurationMsBlock(d.durationMs)}
                                  </span>
                                  <span className="tabular-nums text-muted-foreground/60">
                                    {d.chains} chain{d.chains === 1 ? '' : 's'} ·{' '}
                                    {d.msgs.toLocaleString()} msgs
                                  </span>
                                </div>
                                {d.topics.length > 0 && (
                                  <ul className="space-y-0.5 pl-3.5 text-[11px] text-muted-foreground">
                                    {d.topics.map((t, i) => (
                                      <li key={i} className="truncate" title={t}>
                                        · {t}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )
                          })}
                          {onSelectRange && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                onSelectRange({ startIso: r.startIso, endIso: r.endIso })
                              }}
                              className="rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-border/80 hover:bg-card/80 hover:text-foreground"
                            >
                              Drill into this period →
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/40 bg-muted/20 font-medium">
                <td className="whitespace-nowrap px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Total
                </td>
                <td className="px-2 py-1.5" />
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85">
                  {totals.chains}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85">
                  {totals.sessions}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85">
                  {totals.msgs.toLocaleString()}
                </td>
                <td
                  className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85"
                  title="Interval-merged across all chains — overlaps not double-counted"
                >
                  {fmtDurationMsBlock(totals.durationMs)}
                </td>
                {anyTokens && (
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85">
                    {totals.hasTokens ? formatTokens(totals.inputTokens) : '—'}
                  </td>
                )}
                {anyTokens && (
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-foreground/85">
                    {totals.hasTokens ? formatTokens(totals.outputTokens) : '—'}
                  </td>
                )}
                {anyTokens && (
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground/85">
                    {totals.hasTokens ? `~${formatUsd(totals.costUsd)}` : '—'}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60">
        {display === 'graph'
          ? `Bars stack ${metric === 'time' ? 'time' : metric === 'cost' ? '~cost' : metric} per period by project · click a bar to drill in`
          : 'Bars show relative time per period · click a row for a summary of what was worked on'}
        {display === 'table' && anyPartial && (
          <>
            {' '}· <span className="text-amber-500/80">*</span> partial data — some chains
            in that period exist only as vault markdown (no time/token data), so
            Time, Tok and ~Cost undercount
          </>
        )}
      </p>
    </div>
  )
}
