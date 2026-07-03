import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, ExternalLink, Fingerprint, RefreshCw, ShieldCheck, TerminalSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
// Code-split boundary: keeps recharts out of the startup bundle.
const CodexUsageMetricChartBlock = lazy(() => import('@/components/lego_blocks/integrations/CodexUsageMetricChartBlock'))
import CodexUsageProbeBlock from '@/components/lego_blocks/integrations/CodexUsageProbeBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import {
  buildCodexTerminalRouteBlock,
  formatCodexProfileStateLabelBlock,
  type CodexProfileRuntimeStatusBlock,
} from '@/services/lego_blocks/units/codexProfileBlock'
import {
  extractCodexUsageMetricsBlock,
  extractCodexUsageResetTextBlock,
  type CodexUsageProbeResultBlock,
} from '@/services/lego_blocks/units/codexUsageProbeBlock'
import {
  getInMemoryProbeCache,
  isProbeResultFreshBlock,
  loadProbeResultsFromVaultBlock,
  seedInMemoryProbeCache,
  updateInMemoryProbeCache,
} from '@/services/lego_blocks/units/codexUsageCacheBlock'
import {
  activateCodexProfileOrch,
  listCodexProfileDashboardDataOrch,
  saveCodexProfileDashboardPreferencesOrch,
  type CodexProfileDashboardDataOrch,
} from '@/services/orchestrators/codexProfileOrch'
import { isEmbeddedTerminalSupported } from '@/services/orchestrators/runtimeOrch'
import { cn } from '@/lib/utils'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useWindowActivityBlock } from '@/components/lego_blocks/hooks/shared/useWindowActivityBlock'

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatHostname(value: string): string {
  try { return new URL(value).hostname } catch { return value }
}

function sessionBadgeClassName(result: CodexUsageProbeResultBlock | null | undefined): string {
  if (!result || result.sessionState === 'loading' || result.sessionState === 'unknown') return ''
  if (result.sessionState === 'ready') return 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
  if (result.sessionState === 'needs_login') return 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
  if (result.sessionState === 'error') return 'bg-destructive/10 text-destructive'
  return ''
}

function cliBadgeClassName(status: CodexProfileRuntimeStatusBlock | null): string {
  if (!status) return ''
  if (status.active && status.hasAuthFile) return 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
  if (status.hasAuthFile) return 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
  if (status.exists) return 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
  return ''
}

function headlineToneClass(tone: 'healthy' | 'warning' | 'critical' | null): string {
  if (tone === 'critical') return 'text-rose-500 dark:text-rose-400'
  if (tone === 'warning') return 'text-amber-500 dark:text-amber-400'
  return 'text-foreground dark:text-white'
}

export default function CodexUsageDashboardOrch() {
  const navigate = useNavigate()
  const terminalSupported = isEmbeddedTerminalSupported()
  const routeActive = useRouteActivityBlock()
  const windowActive = useWindowActivityBlock()
  const [data, setData] = useState<CodexProfileDashboardDataOrch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySiteId, setBusySiteId] = useState<string | null>(null)
  const [activationNote, setActivationNote] = useState<string | null>(null)
  const [probeRefreshToken, setProbeRefreshToken] = useState(0)
  const [probeResults, setProbeResults] = useState<Record<string, CodexUsageProbeResultBlock>>(
    () => getInMemoryProbeCache(),
  )
  const vaultLoadedRef = useRef(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextData = await listCodexProfileDashboardDataOrch()
      setData(nextData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Codex profile dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (vaultLoadedRef.current) return
    vaultLoadedRef.current = true
    void loadProbeResultsFromVaultBlock().then((vaultData) => {
      if (Object.keys(vaultData).length === 0) return
      seedInMemoryProbeCache(vaultData)
      setProbeResults((prev) => {
        const merged = { ...vaultData }
        for (const [id, r] of Object.entries(prev)) merged[id] = r
        return merged
      })
    })
  }, [])

  useEffect(() => {
    if (!data) return
    const allowed = new Set(data.rows.map((r) => r.site.id))
    setProbeResults((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => allowed.has(id))),
    )
  }, [data])

  const handleProbeResult = useCallback((result: CodexUsageProbeResultBlock) => {
    updateInMemoryProbeCache(result)
    setProbeResults((prev) => {
      const ex = prev[result.siteId]
      if (ex && ex.sessionState === result.sessionState && ex.usageLabel === result.usageLabel && ex.detectedAt === result.detectedAt) return prev
      return { ...prev, [result.siteId]: result }
    })
  }, [])

  const freshResultSiteIds = useMemo(() => new Set(
    Object.values(probeResults)
      .filter((r) => isProbeResultFreshBlock(r) && r.sessionState !== 'loading')
      .map((r) => r.siteId),
  ), [probeResults])

  const handleGroupChange = useCallback(async (groupId: string) => {
    if (!data) return
    setBusySiteId('__group__')
    setActivationNote(null)
    try {
      await saveCodexProfileDashboardPreferencesOrch({ sourceGroupId: groupId })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dashboard source group.')
    } finally { setBusySiteId(null) }
  }, [data, reload])

  const handleUseInTerminal = useCallback(async (siteId: string, siteName: string) => {
    setBusySiteId(siteId)
    setActivationNote(null)
    setError(null)
    try {
      const result = await activateCodexProfileOrch(siteId)
      const needsLogin = !result.profile.hasAuthFile
      setActivationNote(
        needsLogin
          ? `Activated ${siteName} — terminal will run \`codex login\` inside ${result.profile.homePath}.`
          : result.warning
            ? `Activated ${siteName}. macOS launchd update failed: ${result.warning}`
            : `Activated ${siteName}. New terminals will use ${result.profile.homePath}.`,
      )
      await reload()
      navigate(buildCodexTerminalRouteBlock(siteId, siteName, {
        homePath: result.profile.homePath,
        initialCommand: needsLogin ? 'codex login' : null,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate Codex profile.')
    } finally { setBusySiteId(null) }
  }, [navigate, reload])

  const handleRefresh = useCallback(() => {
    setProbeRefreshToken((v) => v + 1)
    void reload()
  }, [reload])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Usage Dashboard</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Live session state from your web group</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {data && (
        <>
          {/* Source selector — inline, no card */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium text-muted-foreground">Source</span>
            <Select
              value={data.sourceGroupId ?? ''}
              onValueChange={handleGroupChange}
              disabled={busySiteId === '__group__' || data.groups.length === 0}
            >
              <SelectTrigger className="h-7 w-48 text-xs">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {data.groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} ({group.bookmarkCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data.activeHomePath && (
              <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                {data.activeHomePath}
              </span>
            )}
          </div>

          {activationNote && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              {activationNote}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </div>
          )}

          {data.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
              No bookmarks found in the selected group.
            </div>
          ) : (
            <div className="grid gap-3">
              {data.rows.map(({ site, runtime }) => {
                const busy = busySiteId === site.id
                const probe = probeResults[site.id] ?? null
                const probeDetectedAt = formatTimestamp(probe?.detectedAt)
                const lastRefresh = formatTimestamp(runtime?.lastRefresh)
                const authUpdated = formatTimestamp(runtime?.authFileUpdatedAt)
                const usageMetrics = extractCodexUsageMetricsBlock(probe)
                const resetText = extractCodexUsageResetTextBlock(probe)
                const headlineMetric = usageMetrics
                  .slice().sort((a, b) => a.remainingPercent - b.remainingPercent)[0] ?? null
                const sessionBadge = sessionBadgeClassName(probe)
                const cliBadge = cliBadgeClassName(runtime)
                const isChecking = !probe || probe.sessionState === 'loading'

                return (
                  <div
                    key={site.id}
                    className="overflow-hidden rounded-2xl border border-border bg-white dark:bg-[#0a0f1c]"
                  >
                    {/* ── Header ── */}
                    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
                      <div className="min-w-0 flex-1">
                        {/* Name */}
                        <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground dark:text-white">
                          {site.name}
                        </h3>
                        {/* Badge row */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {/* Session state */}
                          {sessionBadge ? (
                            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', sessionBadge)}>
                              {probe?.sessionLabel}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {isChecking ? 'Checking…' : probe?.sessionLabel}
                            </span>
                          )}
                          {/* CLI state */}
                          {cliBadge ? (
                            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', cliBadge)}>
                              CLI {formatCodexProfileStateLabelBlock(runtime)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/60">
                              CLI {formatCodexProfileStateLabelBlock(runtime)}
                            </span>
                          )}
                          {runtime?.launchctlMatches && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              launchd
                            </span>
                          )}
                          {/* Hostname + probe time */}
                          <span className="text-[11px] text-muted-foreground/50">
                            {formatHostname(site.url)}
                            {probeDetectedAt && <> · {probeDetectedAt}</>}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        {terminalSupported && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleUseInTerminal(site.id, site.name)}
                            disabled={busy}
                            className="h-7 gap-1 border-0 bg-foreground px-3 text-[11px] font-medium text-background hover:bg-foreground/90 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
                          >
                            <TerminalSquare className="h-3 w-3" />
                            {runtime?.hasAuthFile ? 'Terminal' : 'Login'}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/web?site=${encodeURIComponent(site.id)}`)}
                          disabled={busy}
                          className="h-7 gap-1 px-3 text-[11px] font-medium"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </Button>
                      </div>
                    </div>

                    {/* ── Body ── */}
                    <div className="px-5 pb-4">
                      {isChecking ? (
                        /* Loading skeleton */
                        <div className="animate-pulse space-y-2.5">
                          <div className="flex items-baseline gap-3">
                            <div className="h-7 w-16 rounded-md bg-muted" />
                            <div className="h-3.5 w-32 rounded bg-muted" />
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted" />
                          <div className="h-2 w-4/5 rounded-full bg-muted" />
                          <div className="h-2 w-3/5 rounded-full bg-muted" />
                        </div>
                      ) : usageMetrics.length > 0 ? (
                        <>
                          {/* Headline stat */}
                          <div className="mb-3 flex items-baseline gap-2">
                            <span className={cn('text-3xl font-bold tabular-nums leading-none', headlineToneClass(headlineMetric?.tone ?? null))}>
                              {headlineMetric?.remainingPercent ?? 0}%
                            </span>
                            <span className="max-w-[220px] truncate text-sm text-muted-foreground">
                              {headlineMetric?.label
                                ? `${headlineMetric.label.length > 24 ? headlineMetric.label.slice(0, 22) + '…' : headlineMetric.label} remaining`
                                : 'remaining'}
                            </span>
                            {resetText && (
                              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">{resetText}</span>
                            )}
                          </div>
                          {/* Chart */}
                          <Suspense fallback={null}>
                            <CodexUsageMetricChartBlock metrics={usageMetrics} />
                          </Suspense>
                        </>
                      ) : (
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                          {probe?.summary ?? 'No usage data detected.'}
                        </p>
                      )}
                    </div>

                    {/* ── Footer meta bar ── */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-5 py-2.5">
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <Fingerprint className="h-3 w-3 shrink-0" />
                        {isChecking
                          ? <span className="h-2.5 w-20 animate-pulse rounded bg-muted" />
                          : <span className="truncate max-w-[180px]">{probe?.accountLabel ?? runtime?.accountId ?? '—'}</span>
                        }
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                        {formatCodexProfileStateLabelBlock(runtime)}
                        {runtime?.homePath && (
                          <span className="hidden truncate max-w-[120px] text-muted-foreground/40 xl:inline">{runtime.homePath}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <Clock3 className="h-3 w-3 shrink-0" />
                        {probeDetectedAt ?? lastRefresh ?? '—'}
                      </span>
                      {/* Errors surfaced inline — subtle */}
                      {(runtime?.error || probe?.error) && (
                        <span className="ml-auto text-[11px] text-rose-500 dark:text-rose-400">
                          {runtime?.error ?? probe?.error}
                        </span>
                      )}
                    </div>

                    {/* Debug strip — only auth details, collapsed by default */}
                    {(runtime?.authMode || authUpdated) && (
                      <div className="border-t border-border/40 px-5 py-1.5 text-[10px] text-muted-foreground/40">
                        {runtime?.authMode && <span className="mr-3">Auth: {runtime.authMode}</span>}
                        {authUpdated && <span>Updated: {authUpdated}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {data && routeActive && windowActive && (
        <CodexUsageProbeBlock
          sites={data.rows.map((r) => r.site)}
          refreshToken={probeRefreshToken}
          freshResultSiteIds={freshResultSiteIds}
          onResult={handleProbeResult}
        />
      )}
    </div>
  )
}
