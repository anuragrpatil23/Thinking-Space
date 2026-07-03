import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Lightbulb, Brain } from 'lucide-react'
import ClickablePath from '@/components/lego_blocks/units/ClickablePathBlock'
import { getDayActivity } from '@/services/orchestrators/fileActivityOrch'
import type { DayDetail } from '@/services/lego_blocks/units/typesBlock'
import type { DashboardHighlights } from '@/services/lego_blocks/integrations/dashboardActivityBlock'
import { getVaultFS, getPlatformName } from '@/services/lego_blocks/integrations/fsBlock'
import { loadHomeSnapshot } from '@/services/lego_blocks/integrations/homeSnapshotBlock'
import { readVaultUiPreferencesOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'

interface TodayFileActivityOrchProps {
  highlights?: DashboardHighlights | null
  highlightsLoading?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function formatLongDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function todayDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatRelativeDay(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today'
  const d = new Date(dateStr + 'T12:00:00')
  const t = new Date(today + 'T12:00:00')
  const diff = Math.round((t.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TodayFileActivityOrch({
  highlights,
  highlightsLoading,
}: TodayFileActivityOrchProps = {}) {
  const [data, setData] = useState<DayDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Insights + memorized cards depend on a specific note structure (daily
  // insight files / memorization sessions). Off by default; user opts in via
  // Settings → Display → "Show daily insight & memorization tiles".
  const [showDailyHighlights, setShowDailyHighlights] = useState(false)

  const today = todayDateStr()

  useEffect(() => {
    let cancelled = false
    readVaultUiPreferencesOrch()
      .then(prefs => {
        if (cancelled) return
        setShowDailyHighlights(prefs.showDailyHighlights)
      })
      .catch(() => {
        /* leave default off */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const platform = getPlatformName()
    const preferSnapshot = platform !== 'electron'

    const live = () =>
      getDayActivity(today)
        .then((d) => {
          if (cancelled) return
          setData(d)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err.message || 'Failed to load activity')
        })
        .finally(() => {
          if (cancelled) return
          setLoading(false)
        })

    if (preferSnapshot) {
      // iPhone/iPad/web: avoid the cross-iCloud vault walk when the desktop
      // snapshot has propagated. Fall back to live compute on miss/stale.
      loadHomeSnapshot(getVaultFS())
        .then((snapshot) => {
          if (cancelled) return
          if (snapshot && snapshot.today.date === today) {
            setData(snapshot.today)
            setLoading(false)
            return
          }
          void live()
        })
        .catch(() => {
          if (cancelled) return
          void live()
        })
    } else {
      void live()
    }

    return () => {
      cancelled = true
    }
  }, [today])

  const total = (data?.created_count ?? 0) + (data?.modified_count ?? 0)

  const sections = useMemo(() => {
    if (!data) return []
    return Object.entries(data.sections)
      .map(([name, payload]) => ({
        name,
        created: payload.created,
        modified: payload.modified,
        total: payload.created.length + payload.modified.length,
      }))
      .sort((a, b) => b.total - a.total)
  }, [data])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden">
      {/* Header row mirrors the AI Activity panel: title + description on the
          beige outer surface, no wrapping Card. Sections below are flat too. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">What you did today</h3>
          <p className="text-xs text-muted-foreground">
            {formatLongDate(today)} · file activity in your vault.
          </p>
        </div>
      </div>

      {/* Metric strip — flat label/number pairs on the beige surface, no inner
          card boxes. Mirrors the AI Activity totals strip styling. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <FlatMetric label="Total files" value={total} />
        <FlatMetric label="Created" value={data?.created_count ?? 0} valueClassName="text-emerald-600 dark:text-emerald-400" />
        <FlatMetric label="Modified" value={data?.modified_count ?? 0} valueClassName="text-blue-600 dark:text-blue-400" />
        <FlatMetric label="Active sections" value={sections.length} />
        {showDailyHighlights && (
          <>
            <FlatMetric
              label="Insights today"
              value={highlights?.todayInsightsCount ?? 0}
              valueClassName="text-amber-600 dark:text-amber-400"
            />
            <FlatMetric
              label="Memorized today"
              value={highlights?.todayMemorizedCount ?? 0}
              valueClassName="text-violet-600 dark:text-violet-400"
            />
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 text-sm text-destructive">{error}</div>
      )}

      {showDailyHighlights &&
        (highlights?.mostRecentInsight || highlights?.mostRecentMemorized || highlightsLoading) && (
          <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            <HighlightRow
              icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
              label="Most recent insight"
              loading={!!highlightsLoading && !highlights}
              primary={highlights?.mostRecentInsight?.text}
              secondary={
                highlights?.mostRecentInsight
                  ? formatRelativeDay(highlights.mostRecentInsight.date, today)
                  : undefined
              }
              href={highlights?.mostRecentInsight?.filePath}
              emptyText="No insights logged yet"
            />
            <HighlightRow
              icon={<Brain className="h-4 w-4 text-violet-500" />}
              label="Most recent memorized"
              loading={!!highlightsLoading && !highlights}
              primary={highlights?.mostRecentMemorized?.title}
              secondary={
                highlights?.mostRecentMemorized
                  ? formatRelativeDay(highlights.mostRecentMemorized.date, today)
                  : undefined
              }
              href={highlights?.mostRecentMemorized?.filePath}
              emptyText="No memorization sessions yet"
            />
          </div>
        )}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {loading && (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border/30 bg-card/30 p-3">
                <div className="h-5 w-28 animate-pulse rounded bg-muted/40" />
                <div className="h-4 w-full animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/30" />
              </div>
            ))}
          </div>
        )}

        {!loading && data && sections.length > 0 && (
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {sections.map(section => (
              <div key={section.name} className="min-w-0 space-y-2">
                <h4 className="text-sm font-semibold text-foreground/85">{section.name}</h4>
                <div className="space-y-3">
                  {section.created.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Created</div>
                      <div className="space-y-0.5 text-sm">
                        {section.created.map(f => (
                          <div key={`c:${f.path}`} className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <ClickablePath path={f.path} className="block min-w-0 flex-1 truncate text-foreground/80">
                                {fileName(f.path)}
                              </ClickablePath>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatBytes(f.size_bytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {section.modified.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Modified</div>
                      <div className="space-y-0.5 text-sm">
                        {section.modified.map(f => (
                          <div key={`m:${f.path}`} className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                              <ClickablePath path={f.path} className="block min-w-0 flex-1 truncate text-foreground/80">
                                {fileName(f.path)}
                              </ClickablePath>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatBytes(f.size_bytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && data && sections.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No file activity yet today.
          </div>
        )}
      </div>
    </div>
  )
}

function FlatMetric({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: number | string
  valueClassName?: string
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-base font-semibold tabular-nums text-foreground/85 ${valueClassName ?? ''}`}>
        {value}
      </span>
    </span>
  )
}

interface HighlightRowProps {
  icon: ReactNode
  label: string
  primary?: string
  secondary?: string
  href?: string
  loading?: boolean
  emptyText: string
}

function HighlightRow({ icon, label, primary, secondary, href, loading, emptyText }: HighlightRowProps) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md border border-border/40 bg-background/40 p-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {secondary && (
            <div className="text-xs text-muted-foreground shrink-0">{secondary}</div>
          )}
        </div>
        {loading ? (
          <div className="mt-1.5 h-4 w-3/4 animate-pulse rounded bg-muted/40" />
        ) : primary ? (
          href ? (
            <ClickablePath
              path={href}
              className="mt-1 block truncate text-sm text-foreground/90"
            >
              {primary}
            </ClickablePath>
          ) : (
            <div className="mt-1 truncate text-sm text-foreground/90">{primary}</div>
          )
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">{emptyText}</div>
        )}
      </div>
    </div>
  )
}
