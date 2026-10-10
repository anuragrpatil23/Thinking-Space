import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  formatPlanUsagePctBlock,
  type PlanUsageDayBlock,
} from '@/services/lego_blocks/units/aiPlanUsageHistoryBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'

interface AiPlanUsageChartBlockProps {
  /** One row per day on the x-axis, oldest first. */
  days: PlanUsageDayBlock[]
  /** When set, only that project's share is plotted. */
  filterProject?: string | null
}

/** Dataset key for usage no known session accounts for. Not a project name. */
const UNATTRIBUTED_KEY = '__unattributed'
const UNATTRIBUTED_COLOR = 'rgba(148,163,184,0.45)'

function formatTickDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTooltipDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * How much of the weekly plan limit each day used, stacked by project.
 *
 * Deliberately the Trend chart's twin — same axes, same palette, same height —
 * so the two read as one pair: Trend is the time spent, this is what that time
 * cost against the plan.
 */
export default function AiPlanUsageChartBlock({
  days,
  filterProject = null,
}: AiPlanUsageChartBlockProps) {
  // Largest total first, so the stack order is stable across days and the
  // project that used the most sits on the baseline.
  const projects = useMemo(() => {
    const totals = new Map<string, number>()
    for (const day of days) {
      for (const [name, pct] of Object.entries(day.byProject)) {
        totals.set(name, (totals.get(name) ?? 0) + pct)
      }
    }
    const names = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
    return filterProject ? names.filter(name => name === filterProject) : names
  }, [days, filterProject])

  // A project filter asks "what did this project use" — usage nobody can be
  // tied to is not an answer to that, so it leaves the chart with the others.
  const showUnattributed = !filterProject && days.some(day => day.unattributed > 0)

  const data = useMemo(
    () =>
      days.map(day => {
        const row: Record<string, number | string> = { date: day.date }
        for (const name of projects) row[name] = day.byProject[name] ?? 0
        if (showUnattributed) row[UNATTRIBUTED_KEY] = day.unattributed
        return row
      }),
    [days, projects, showUnattributed],
  )

  const yMax = useMemo(() => {
    let max = 0
    for (const row of data) {
      let sum = 0
      for (const [key, value] of Object.entries(row)) {
        if (key !== 'date') sum += value as number
      }
      if (sum > max) max = sum
    }
    return Math.max(4, Math.ceil(max * 1.15))
  }, [data])

  const { hostRef, isDark } = useDarkModeClassBlock()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const tick = () => setReady(node.clientWidth > 0 && node.clientHeight > 0)
    tick()
    const obs = new ResizeObserver(tick)
    obs.observe(node)
    return () => obs.disconnect()
  }, [hostRef])

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
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
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
              // Same width as the Trend chart's axis, so the two plots' bars
              // sit on the same dates down the card.
              width={32}
              allowDecimals={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null
                const rows = payload
                  .filter(p => typeof p.value === 'number' && (p.value as number) > 0)
                  .reverse()
                if (rows.length === 0) return null
                const total = rows.reduce((n, r) => n + (r.value as number), 0)
                return (
                  <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                    <div className="flex items-baseline gap-3 text-foreground/70">
                      <span>{formatTooltipDate(String(label))}</span>
                      <span className="ml-auto tabular-nums text-foreground/85">
                        {formatPlanUsagePctBlock(total)} of the week
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {rows.map(row => {
                        const key = String(row.dataKey)
                        const unattributed = key === UNATTRIBUTED_KEY
                        const stroke = unattributed
                          ? UNATTRIBUTED_COLOR
                          : getProjectColor(key, isDark).stroke
                        return (
                          <div key={key} className="flex items-baseline gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: stroke }} />
                            <span className="text-foreground/80">
                              {unattributed ? 'Not from a session here' : projectLabelBlock(key)}
                            </span>
                            <span
                              className="ml-auto tabular-nums"
                              style={unattributed ? undefined : { color: stroke }}
                            >
                              {formatPlanUsagePctBlock(row.value as number)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }}
            />
            {projects.map(name => (
              <Bar
                key={name}
                dataKey={name}
                stackId="1"
                fill={getProjectColor(name, isDark).fill}
                fillOpacity={1}
                isAnimationActive
                animationDuration={550}
                animationEasing="ease-out"
              />
            ))}
            {showUnattributed && (
              <Bar
                dataKey={UNATTRIBUTED_KEY}
                stackId="1"
                fill={UNATTRIBUTED_COLOR}
                isAnimationActive
                animationDuration={550}
                animationEasing="ease-out"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
