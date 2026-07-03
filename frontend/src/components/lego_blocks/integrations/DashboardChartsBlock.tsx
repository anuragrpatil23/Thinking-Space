import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Files, Lightbulb, Brain } from 'lucide-react'
import type { DashboardDay, DashboardSeries } from '@/services/lego_blocks/integrations/dashboardActivityBlock'
import {
  DASHBOARD_RANGE_PRESETS,
  type DashboardRangePreset,
} from '@/components/lego_blocks/hooks/shared/useDashboardActivityBlock'
import { cn } from '@/lib/utils'

type AccentKey = 'sky' | 'amber' | 'violet'

interface ChartCardSpec {
  key: 'files_modified' | 'insights_logged' | 'memorized_sessions'
  label: string
  description: string
  accent: AccentKey
  icon: typeof Files
}

const CARDS: ChartCardSpec[] = [
  {
    key: 'files_modified',
    label: 'Files changed',
    description: 'Notes modified per day',
    accent: 'sky',
    icon: Files,
  },
  {
    key: 'insights_logged',
    label: 'Insights',
    description: 'Daily insight notes captured',
    accent: 'amber',
    icon: Lightbulb,
  },
  {
    key: 'memorized_sessions',
    label: 'Memorized',
    description: 'Memorization sessions logged',
    accent: 'violet',
    icon: Brain,
  },
]

const ACCENTS: Record<AccentKey, { stroke: string; gradFrom: string; gradTo: string; chip: string; chipActive: string }> = {
  sky: {
    stroke: 'rgb(56,189,248)',
    gradFrom: 'rgba(56,189,248,0.55)',
    gradTo: 'rgba(56,189,248,0)',
    chip: 'text-sky-300',
    chipActive: 'bg-sky-500/15 dark:bg-sky-500/25 text-sky-200 ring-sky-400/30',
  },
  amber: {
    stroke: 'rgb(251,191,36)',
    gradFrom: 'rgba(251,191,36,0.55)',
    gradTo: 'rgba(251,191,36,0)',
    chip: 'text-amber-300',
    chipActive: 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-200 ring-amber-400/30',
  },
  violet: {
    stroke: 'rgb(167,139,250)',
    gradFrom: 'rgba(167,139,250,0.55)',
    gradTo: 'rgba(167,139,250,0)',
    chip: 'text-violet-300',
    chipActive: 'bg-violet-500/15 dark:bg-violet-500/25 text-violet-200 ring-violet-400/30',
  },
}

function formatTickDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTooltipDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

interface DashboardChartsBlockProps {
  series: DashboardSeries | null
  loading: boolean
  error: string | null
  preset: DashboardRangePreset
  onPresetChange: (preset: DashboardRangePreset) => void
  /** Show the Insights + Memorized cards. Off by default — those depend on a
   *  vault-specific note structure most users don't have. */
  showDailyHighlights?: boolean
}

export default function DashboardChartsBlock({
  series,
  loading,
  error,
  preset,
  onPresetChange,
  showDailyHighlights = false,
}: DashboardChartsBlockProps) {
  const days = series?.days ?? []
  const visibleCards = showDailyHighlights
    ? CARDS
    : CARDS.filter(c => c.key === 'files_modified')
  const gridCols = visibleCards.length >= 3
    ? 'md:grid-cols-3'
    : visibleCards.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Activity</h3>
          <p className="text-xs text-muted-foreground">
            Files changed, insights captured, and memorization sessions over time.
          </p>
        </div>
        <RangePills preset={preset} onChange={onPresetChange} />
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div className={cn('grid grid-cols-1 gap-3', gridCols)}>
          {visibleCards.map((card) => (
            <ChartCard
              key={card.key}
              spec={card}
              days={days}
              total={series?.totals[card.key] ?? 0}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RangePills({
  preset,
  onChange,
}: {
  preset: DashboardRangePreset
  onChange: (p: DashboardRangePreset) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Range"
      className="flex shrink-0 items-center gap-1 rounded-full border border-border/40 bg-muted/30 p-1"
    >
      {DASHBOARD_RANGE_PRESETS.map((opt) => {
        const active = opt.id === preset
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium tabular-nums transition-all',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

interface ChartCardProps {
  spec: ChartCardSpec
  days: DashboardDay[]
  total: number
  loading: boolean
}

function ChartCard({ spec, days, total, loading }: ChartCardProps) {
  const accent = ACCENTS[spec.accent]
  const Icon = spec.icon
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const [chartHostReady, setChartHostReady] = useState(false)
  const gradId = useMemo(() => `dash-grad-${spec.key}-${Math.random().toString(36).slice(2, 8)}`, [spec.key])

  const data = days.map((d) => ({
    date: d.date,
    value: d[spec.key],
  }))

  const maxValue = data.reduce((m, d) => (d.value > m ? d.value : m), 0)
  const yMax = Math.max(1, Math.ceil(maxValue * 1.15))

  useEffect(() => {
    const node = chartHostRef.current
    if (!node) return

    const updateChartHostReady = () => {
      setChartHostReady(node.clientWidth > 0 && node.clientHeight > 0)
    }

    updateChartHostReady()
    const observer = new ResizeObserver(() => updateChartHostReady())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/40 bg-card/40 p-4 shadow-sm backdrop-blur transition-colors hover:border-border/70">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn('rounded-lg p-1.5 ring-1', accent.chipActive)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {spec.label}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/80">{spec.description}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-foreground">
            {loading ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-muted/40" /> : total.toLocaleString()}
          </div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">total</div>
        </div>
      </div>

      <div ref={chartHostRef} className="mt-3 h-32 min-w-0">
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-muted/20" />
        ) : chartHostReady ? (
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={1}
            minHeight={1}
            initialDimension={{ width: 1, height: 1 }}
          >
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent.gradFrom} />
                  <stop offset="100%" stopColor={accent.gradTo} />
                </linearGradient>
              </defs>
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
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ stroke: accent.stroke, strokeOpacity: 0.25, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null
                  const point = payload[0].payload as { date: string; value: number }
                  return (
                    <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                      <div className="text-foreground/70">{formatTooltipDate(point.date)}</div>
                      <div className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="text-base font-semibold tabular-nums" style={{ color: accent.stroke }}>
                          {point.value}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {spec.label}
                        </span>
                      </div>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={accent.stroke}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                isAnimationActive
                animationDuration={650}
                animationEasing="ease-out"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: accent.stroke }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  )
}
