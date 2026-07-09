import { useMemo, useRef, useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  ActivityDay,
  ActivityProject,
} from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  fmtDurationMsBlock,
  mergedDurationMsBlock,
} from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import {
  AI_ACTIVITY_REST_DAYS_EVENT,
  AI_ACTIVITY_SET_MODE_EVENT,
  getAiActivityRestDays,
  getAiActivitySetMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

interface AiActivityTrendChartBlockProps {
  days: ActivityDay[]
  /** Chains in range — the duration source (days only carry msg counts). */
  chains: ActivityChain[]
  projects: ActivityProject[]
  /** When set, only that project's series is plotted (solo view). */
  filterProject?: string | null
  /** Hide noise buckets ([auto-commit], [telegram]). */
  hideNoise?: boolean
  /** Currently selected day — for visual selection state if we want it later. */
  selectedDate?: string | null
  /** Click on a data point selects/unselects that day. Mirrors the heatmap. */
  onSelectDate?: (date: string | null) => void
  /** Render the per-day total duration as a small pill above each peak. */
  showSessionCounts?: boolean
}

const HOUR_MS = 3_600_000

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTickDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTooltipDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function AiActivityTrendChartBlock({
  days,
  chains,
  projects,
  filterProject = null,
  hideNoise = true,
  selectedDate = null,
  onSelectDate,
}: AiActivityTrendChartBlockProps) {
  const [setMode, setSetMode] = useState<boolean>(() => getAiActivitySetMode())
  const [restDays, setRestDays] = useState<number[]>(() => getAiActivityRestDays())
  useEffect(() => {
    const onSetMode = () => setSetMode(getAiActivitySetMode())
    const onRestDays = () => setRestDays(getAiActivityRestDays())
    window.addEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
    window.addEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
    window.addEventListener('storage', onSetMode)
    window.addEventListener('storage', onRestDays)
    return () => {
      window.removeEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
      window.removeEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
      window.removeEventListener('storage', onSetMode)
      window.removeEventListener('storage', onRestDays)
    }
  }, [])

  // Rest-day ISO dates within the current calendar month. Historical months
  // are intentionally excluded — rest cadence is forward-looking, so past
  // days don't get recolored just because today's weekday preferences say so.
  const restDayIsos = useMemo(() => {
    if (restDays.length === 0) return [] as string[]
    const set = new Set(restDays)
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const monthLen = new Date(year, month + 1, 0).getDate()
    const out: string[] = []
    for (let d = 1; d <= monthLen; d++) {
      const date = new Date(year, month, d)
      if (set.has(date.getDay())) out.push(isoDayLocal(date))
    }
    return out
  }, [restDays])

  // Current set's [startIso, endIso] — shaded on the chart when set-mode is on
  // so today's 3-day window reads as a soft band across the day bars.
  const currentSetRange = useMemo(() => {
    const now = new Date()
    const day = now.getDate()
    const setNumber = Math.floor((day - 1) / 3) + 1
    const startDay = 3 * (setNumber - 1) + 1
    const monthLen = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const endDay = Math.min(3 * setNumber, monthLen)
    return {
      startIso: isoDayLocal(new Date(now.getFullYear(), now.getMonth(), startDay)),
      endIso: isoDayLocal(new Date(now.getFullYear(), now.getMonth(), endDay)),
    }
  }, [])

  const visibleProjects = useMemo(() => {
    let list = projects
    if (hideNoise) list = list.filter(p => !p.isNoise)
    if (filterProject) list = list.filter(p => p.name === filterProject)
    return list
  }, [projects, hideNoise, filterProject])

  // Per-day, per-project merged duration (ms). Days only carry msg counts, so
  // duration is computed here from the chains' [start, end] windows — bucketed
  // by the chain's local start day, consistent with the heatmap/drill views.
  const durMsByDateProject = useMemo(() => {
    const byDate = new Map<string, Map<string, ActivityChain[]>>()
    for (const c of chains) {
      const localDay = isoDayLocal(new Date(c.startedIso))
      let byProject = byDate.get(localDay)
      if (!byProject) {
        byProject = new Map()
        byDate.set(localDay, byProject)
      }
      const arr = byProject.get(c.project)
      if (arr) arr.push(c)
      else byProject.set(c.project, [c])
    }
    const out = new Map<string, Map<string, number>>()
    for (const [date, byProject] of byDate) {
      const durs = new Map<string, number>()
      for (const [project, list] of byProject) durs.set(project, mergedDurationMsBlock(list))
      out.set(date, durs)
    }
    return out
  }, [chains])

  const data = useMemo(() => {
    return days.map(d => {
      const durs = durMsByDateProject.get(d.date)
      const row: Record<string, number | string> = { date: d.date }
      for (const p of visibleProjects) {
        // Plot hours so the y-axis reads naturally; ms kept for label/tooltip
        // formatting via the `__durMs:<project>` sidecar keys.
        const ms = durs?.get(p.name) ?? 0
        row[p.name] = Math.round((ms / HOUR_MS) * 100) / 100
        row[`__durMs:${p.name}`] = ms
      }
      return row
    })
  }, [days, visibleProjects, durMsByDateProject])

  const yMax = useMemo(() => {
    let max = 0
    for (const row of data) {
      let sum = 0
      for (const p of visibleProjects) sum += (row[p.name] as number) ?? 0
      if (sum > max) max = sum
    }
    return Math.max(1, Math.ceil(max * 1.15))
  }, [data, visibleProjects])

  // Anchor each duration label just above that day's stacked peak — following
  // the curve so labels hover over the silhouette. The anchor is the stacked
  // hours for the day; `__dayDurMs` carries the same total in ms for the pill.
  const dataWithAnchor = useMemo(
    () =>
      data.map(row => {
        let stackHours = 0
        let stackMs = 0
        for (const p of visibleProjects) {
          stackHours += (row[p.name] as number) ?? 0
          stackMs += (row[`__durMs:${p.name}`] as number) ?? 0
        }
        return { ...row, __topAnchor: stackHours, __dayDurMs: stackMs }
      }),
    [data, visibleProjects],
  )

  const hostRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const tick = () => setReady(node.clientWidth > 0 && node.clientHeight > 0)
    tick()
    const obs = new ResizeObserver(tick)
    obs.observe(node)
    return () => obs.disconnect()
  }, [])

  // The duration pills are light SVG badges, so their text must darken in dark
  // mode to stay readable. The app toggles a `.dark` class on the canvas
  // wrapper (covering explicit dark + night phase), so detect from the host's
  // ancestry and re-check on class changes.
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const update = () => setIsDark(!!hostRef.current?.closest('.dark'))
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    })
    return () => obs.disconnect()
  }, [])
  const pillTextFill = isDark ? 'rgba(30,41,59,0.95)' : 'rgba(148,163,184,0.95)'

  return (
    <div ref={hostRef} className="h-44 min-w-0">
      {ready && (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={1}
          minHeight={1}
          initialDimension={{ width: 1, height: 1 }}
        >
          <ComposedChart
            data={dataWithAnchor}
            margin={{ top: 18, right: 4, bottom: 0, left: -22 }}
            onClick={evt => {
              if (!onSelectDate) return
              // Recharts passes the active payload's row in `activeLabel`. Toggle:
              // clicking the already-selected day clears it (matches heatmap UX).
              const payload = evt as { activeLabel?: string } | null
              const clicked = payload?.activeLabel
              if (!clicked) return
              onSelectDate(selectedDate === clicked ? null : clicked)
            }}
            style={{ cursor: onSelectDate ? 'pointer' : 'default' }}
          >
            <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tickFormatter={formatTickDate}
              minTickGap={24}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 10, fill: 'rgba(148,163,184,0.7)' }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v: number) => `${v}h`}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null
                // Only the project bars carry a numeric hours value; sidecar/
                // anchor keys are strings-or-hidden so they fall out here.
                const rows = payload
                  .filter(
                    p =>
                      typeof p.value === 'number' &&
                      (p.value as number) > 0 &&
                      !String(p.dataKey).startsWith('__'),
                  )
                  .reverse()
                const dateIso = String(label)
                const totalMs = rows.reduce((n, r) => n + (r.value as number) * HOUR_MS, 0)
                if (rows.length === 0) return null
                return (
                  <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                    <div className="flex items-baseline gap-2 text-foreground/70">
                      <span>{formatTooltipDate(dateIso)}</span>
                      <span className="ml-auto tabular-nums text-foreground/85">
                        {fmtDurationMsBlock(totalMs)}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {rows.map(row => {
                        const color = getProjectColor(String(row.dataKey))
                        return (
                          <div key={String(row.dataKey)} className="flex items-baseline gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: color.stroke }}
                            />
                            <span className="text-foreground/80">{String(row.dataKey)}</span>
                            <span
                              className="ml-auto tabular-nums"
                              style={{ color: color.stroke }}
                            >
                              {fmtDurationMsBlock((row.value as number) * HOUR_MS)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }}
            />
            {selectedDate && (
              <ReferenceLine
                x={selectedDate}
                stroke="rgba(148,163,184,0.9)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                ifOverflow="extendDomain"
              />
            )}
            {setMode && (
              <ReferenceArea
                x1={currentSetRange.startIso}
                x2={currentSetRange.endIso}
                fill="rgba(148,163,184,0.16)"
                fillOpacity={1}
                stroke="rgba(148,163,184,0.5)"
                strokeOpacity={0.6}
                ifOverflow="hidden"
              />
            )}
            {restDayIsos.map(iso => (
              <ReferenceArea
                key={`rest-${iso}`}
                x1={iso}
                x2={iso}
                fill="rgba(251,191,36,0.14)"
                fillOpacity={1}
                stroke="rgba(251,191,36,0.35)"
                strokeOpacity={0.5}
                ifOverflow="hidden"
              />
            ))}
            {visibleProjects.map(p => (
              <Bar
                key={p.name}
                dataKey={p.name}
                stackId="1"
                // Soft palette tint (same token the heatmap cells + filled areas
                // use) instead of the full-saturation stroke — reads as calm
                // pastels over the cream canvas rather than bold blocks.
                fill={getProjectColor(p.name).fill}
                fillOpacity={1}
                isAnimationActive
                animationDuration={550}
                animationEasing="ease-out"
              />
            ))}
            {/* Per-day total-duration labels — plotted as an invisible line
                that follows each day's stacked peak, with a LabelList rendering
                a small pill above each point. Days with 0 duration are
                suppressed. */}
            <Line
              type="monotone"
              dataKey="__topAnchor"
              stroke="transparent"
              dot={false}
              isAnimationActive={false}
              activeDot={false}
              legendType="none"
            >
              <LabelList
                dataKey="__dayDurMs"
                position="top"
                content={(props) => {
                  const { x, y, value } = props as {
                    x?: number
                    y?: number
                    value?: number | string
                  }
                  const ms = typeof value === 'number' ? value : 0
                  if (ms <= 0 || x == null || y == null) return null
                  // Pill badge: small rounded rect with the duration inside.
                  // Width grows with text length so '12h' and '45m' both look
                  // balanced.
                  const text = fmtDurationMsBlock(ms)
                  const charW = 5.5
                  const padX = 4
                  const w = Math.max(14, text.length * charW + padX * 2)
                  const h = 13
                  const cx = x
                  const top = y - h - 2
                  return (
                    <g>
                      <rect
                        x={cx - w / 2}
                        y={top}
                        width={w}
                        height={h}
                        rx={h / 2}
                        ry={h / 2}
                        fill="rgba(241,245,249,0.92)"
                        stroke="rgba(148,163,184,0.25)"
                        strokeWidth={0.5}
                      />
                      <text
                        x={cx}
                        y={top + h / 2 + 3}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={500}
                        fill={pillTextFill}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {text}
                      </text>
                    </g>
                  )
                }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
