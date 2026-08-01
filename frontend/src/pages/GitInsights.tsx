import { useEffect, useMemo, useState } from 'react'
import { Activity, GitCommit, Users, Waves, Flame, Calendar, Eye, CheckSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/lego_blocks/units/ui/card'
import { Button } from '@/components/lego_blocks/units/ui/button'
import FileActivityOrch from '@/components/orchestrators/FileActivityOrch'
import MetricBlock from '@/components/lego_blocks/units/MetricBlock'
import ThoughtsCalendarOrch from '@/components/orchestrators/ThoughtsCalendarOrch'
import TodoCalendarOrch from '@/components/orchestrators/TodoCalendarOrch'
import { getGitInsights } from '@/services/orchestrators/gitInsightsOrch'
import type { GitInsightsData, HeatmapDay } from '@/services/lego_blocks/units/typesBlock'

// 'notes'/'todos' moved here from the New Note tab (2026-07-31): New Note is
// now a single full-bleed writing surface with no mode nav, and browsing what
// you already wrote is an insights activity, not a composing one.
type Tab = 'git' | 'file' | 'notes' | 'todos'

function fmt(n: number): string {
  return n.toLocaleString()
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-40 animate-pulse rounded-lg bg-muted/60" />
        <div className="h-4 w-64 animate-pulse rounded-lg bg-muted/40 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-muted/40 p-4">
              <div className="h-3 w-16 animate-pulse rounded bg-muted/60 mb-2" />
              <div className="h-6 w-12 animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function GitActivityTab() {
  const [data, setData] = useState<GitInsightsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(365)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getGitInsights(days)
      .then(data => setData(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [days])

  const maxCommitCount = useMemo(() => {
    if (!data) return 0
    return Math.max(1, ...data.weekly_commits.map(w => w.count))
  }, [data])

  const maxCodeDelta = useMemo(() => {
    if (!data) return 0
    const maxAdd = Math.max(1, ...data.code_frequency.map(w => w.additions))
    const maxDel = Math.max(1, ...data.code_frequency.map(w => w.deletions))
    return Math.max(maxAdd, maxDel)
  }, [data])

  const heatmapWeeks = useMemo(() => {
    if (!data) return []
    const daily = data.heatmap.daily
    const weeks: HeatmapDay[][] = []
    let week: HeatmapDay[] = []
    daily.forEach((day, index) => {
      week.push(day)
      if ((index + 1) % 7 === 0) {
        weeks.push(week)
        week = []
      }
    })
    if (week.length) weeks.push(week)
    return weeks
  }, [data])

  const heatmapMax = useMemo(() => {
    if (!data) return 0
    return Math.max(1, ...data.heatmap.daily.map(d => d.count))
  }, [data])

  const maxDayCount = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.time_distribution.by_day)
  }, [data])

  const maxHourCount = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.time_distribution.by_hour)
  }, [data])

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {[90, 180, 365].map(value => (
          <Button
            key={value}
            variant={days === value ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setDays(value)}
          >
            {value}d
          </Button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-destructive mb-6">{error}</div>
      )}

      {loading && (
        <div className="grid gap-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {data && !loading && (
        <div className="grid gap-6">
          {/* Activity Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Summary</CardTitle>
              <CardDescription>Key metrics for the last {days} days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                <MetricBlock label="Total commits" value={fmt(data.summary.total_commits)} />
                <MetricBlock label="Unique files" value={fmt(data.summary.unique_files)} />
                <MetricBlock label="Lines added" value={`+${fmt(data.summary.additions)}`} className="text-emerald-600 dark:text-emerald-400" />
                <MetricBlock label="Lines removed" value={`-${fmt(data.summary.deletions)}`} className="text-rose-600 dark:text-rose-400" />
                <MetricBlock
                  label="Net change"
                  value={`${data.summary.net_change >= 0 ? '+' : ''}${fmt(data.summary.net_change)}`}
                  className={data.summary.net_change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
                />
              </div>
            </CardContent>
          </Card>

          {/* Pulse */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Waves className="h-4 w-4" />
                Pulse
                <span className="text-sm font-normal text-muted-foreground">last {data.pulse.days}d</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
                <MetricBlock label="Commits" value={fmt(data.pulse.commits)} />
                <MetricBlock label="Authors" value={fmt(data.pulse.authors)} />
                <MetricBlock label="Files changed" value={fmt(data.pulse.files_changed)} />
                <MetricBlock label="Additions" value={`+${fmt(data.pulse.additions)}`} className="text-emerald-600 dark:text-emerald-400" />
                <MetricBlock label="Deletions" value={`-${fmt(data.pulse.deletions)}`} className="text-rose-600 dark:text-rose-400" />
              </div>
            </CardContent>
          </Card>

          {/* Commits over time + Contributors */}
          <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitCommit className="h-4 w-4" />
                  Commits over time
                </CardTitle>
                <CardDescription>Weekly commit volume</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-40 sm:h-48 w-full rounded-2xl border border-border/60 bg-muted/30 p-3 sm:p-4">
                  <svg viewBox="0 0 600 160" className="h-full w-full" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="commitFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {data.weekly_commits.length > 1 && (
                      <polygon
                        fill="url(#commitFill)"
                        className="text-primary"
                        points={`0,160 ${data.weekly_commits
                          .map((w, i) => {
                            const x = (i / (data.weekly_commits.length - 1)) * 600
                            const y = 150 - (w.count / maxCommitCount) * 130
                            return `${x},${y}`
                          })
                          .join(' ')} 600,160`}
                      />
                    )}
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      className="text-primary"
                      points={data.weekly_commits
                        .map((w, i) => {
                          const x = (i / Math.max(1, data.weekly_commits.length - 1)) * 600
                          const y = 150 - (w.count / maxCommitCount) * 130
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                  </svg>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Contributors
                </CardTitle>
                <CardDescription>Top committers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.contributors.slice(0, 8).map((contributor) => {
                    const maxContribCommits = Math.max(1, data.contributors[0]?.commits ?? 1)
                    const pct = (contributor.commits / maxContribCommits) * 100
                    return (
                      <div key={contributor.name}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium truncate mr-2">{contributor.name}</span>
                          <span className="text-muted-foreground tabular-nums shrink-0">
                            {fmt(contributor.commits)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Event Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Event Breakdown</CardTitle>
              <CardDescription>File change types</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <MetricBlock label="Created" value={fmt(data.event_breakdown.A)} />
                <MetricBlock label="Modified" value={fmt(data.event_breakdown.M)} />
                <MetricBlock label="Deleted" value={fmt(data.event_breakdown.D)} />
                <MetricBlock label="Renamed" value={fmt(data.event_breakdown.R)} />
              </div>
            </CardContent>
          </Card>

          {/* Top Files */}
          <Card>
            <CardHeader>
              <CardTitle>Top Files</CardTitle>
              <CardDescription>Most edited files in the selected range</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {data.top_files.map(file => (
                  <div
                    key={file.file}
                    className="border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="font-medium truncate text-foreground/90 mb-1" title={file.file}>
                      {file.file}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{file.edits} edits</span>
                      <span className="text-emerald-600 dark:text-emerald-400">+{fmt(file.additions)}</span>
                      <span className="text-rose-600 dark:text-rose-400">-{fmt(file.deletions)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Time Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Time Distribution</CardTitle>
              <CardDescription>
                Most active: {dayLabels[data.time_distribution.most_active_day]}s at {data.time_distribution.most_active_hour}:00
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 lg:grid-cols-[1fr,1.5fr]">
                {/* By day - bar chart */}
                <div className="space-y-2 text-sm">
                  {data.time_distribution.by_day.map((count, index) => {
                    const pct = (count / maxDayCount) * 100
                    return (
                      <div key={index} className="flex items-center gap-3">
                        <span className="w-8 shrink-0 text-muted-foreground">{dayLabels[index]}</span>
                        <div className="flex-1 h-5 rounded bg-muted/30 overflow-hidden">
                          <div
                            className="h-full rounded bg-primary/50 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 text-right tabular-nums text-muted-foreground">{count}</span>
                      </div>
                    )
                  })}
                </div>
                {/* By hour - grid */}
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5 text-xs">
                  {data.time_distribution.by_hour.map((count, hour) => {
                    const intensity = count / maxHourCount
                    return (
                      <div
                        key={hour}
                        className="rounded-lg p-2 text-center transition-colors"
                        style={{
                          background: intensity === 0
                            ? 'hsl(var(--muted) / 0.4)'
                            : `rgba(16, 185, 129, ${0.1 + intensity * 0.35})`,
                        }}
                      >
                        <div className="text-[10px] text-muted-foreground">{hour}:00</div>
                        <div className="font-semibold text-foreground tabular-nums">{count}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Code frequency */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCommit className="h-4 w-4" />
                Code frequency
              </CardTitle>
              <CardDescription>Weekly additions and deletions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                <div className="relative h-48 sm:h-56 rounded-2xl border border-border/60 bg-muted/30 p-4" style={{ minWidth: `${Math.max(300, data.code_frequency.length * 8)}px` }}>
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-border/80" />
                  <div className="flex h-full items-center gap-[2px]">
                    {data.code_frequency.map((week, index) => {
                      const addHeight = (week.additions / maxCodeDelta) * 45
                      const delHeight = (week.deletions / maxCodeDelta) * 45
                      return (
                        <div
                          key={index}
                          className="flex flex-1 flex-col items-center justify-center"
                          title={`${week.week_start}: +${fmt(week.additions)} / -${fmt(week.deletions)}`}
                        >
                          <div
                            className="w-full max-w-[6px] rounded-t bg-emerald-500/70"
                            style={{ height: `${addHeight}%` }}
                          />
                          <div
                            className="w-full max-w-[6px] rounded-b bg-rose-500/70"
                            style={{ height: `${delHeight}%` }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/70" />
                  Additions
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/70" />
                  Deletions
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Activity Heatmap */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-4 w-4" />
                Activity heatmap
              </CardTitle>
              <CardDescription>Daily commits over the selected range</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
                <div className="inline-flex gap-[3px]">
                  {heatmapWeeks.map((week, index) => (
                    <div key={index} className="flex flex-col gap-[3px]">
                      {week.map(day => {
                        const intensity = day.count / heatmapMax
                        const bg = intensity === 0
                          ? 'hsl(var(--muted))'
                          : `rgba(16, 185, 129, ${0.2 + intensity * 0.8})`
                        return (
                          <div
                            key={day.date}
                            title={`${day.date}: ${day.count} commits`}
                            className="h-[11px] w-[11px] sm:h-3 sm:w-3 rounded-sm border border-border/40"
                            style={{ background: bg }}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                <span>Less</span>
                {[0, 0.25, 0.5, 0.75, 1].map(level => (
                  <div
                    key={level}
                    className="h-[11px] w-[11px] sm:h-3 sm:w-3 rounded-sm border border-border/40"
                    style={{
                      background: level === 0
                        ? 'hsl(var(--muted))'
                        : `rgba(16, 185, 129, ${0.2 + level * 0.8})`,
                    }}
                  />
                ))}
                <span>More</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

export default function GitInsights() {
  const [tab, setTab] = useState<Tab>('file')

  return (
    <div className="ltm-page">
      <div className="ltm-page-shell ltm-shell-wide">
        <header className="mb-6 sm:mb-8">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Insights</h1>
              <p className="text-sm text-muted-foreground">
                Activity dashboard powered by your repo history and file system.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant={tab === 'git' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setTab('git')}
            >
              <GitCommit className="h-3.5 w-3.5 mr-1.5" />
              Git Activity
            </Button>
            <Button
              variant={tab === 'file' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setTab('file')}
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              File Activity
            </Button>
            <Button
              variant={tab === 'notes' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setTab('notes')}
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Notes
            </Button>
            <Button
              variant={tab === 'todos' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setTab('todos')}
            >
              <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
              To Dos
            </Button>
          </div>
        </header>

        {tab === 'git' && <GitActivityTab />}
        {tab === 'file' && <FileActivityOrch />}
        {tab === 'notes' && <ThoughtsCalendarOrch />}
        {tab === 'todos' && <TodoCalendarOrch />}
      </div>
    </div>
  )
}
