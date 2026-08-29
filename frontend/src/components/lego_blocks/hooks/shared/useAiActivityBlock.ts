import { useCallback, useEffect, useMemo, useState } from 'react'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  getCachedSnapshot,
  loadAiActivity,
  subscribeAiActivitySnapshotBlock,
} from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import {
  buildChains,
  inheritUnknownSessions,
  isReadingSource,
  type ActivityChain,
  type ActivitySource,
  type ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  resolveCanonicalProjectBlock,
  subscribeAiActivityMappingBlock,
} from '@/services/lego_blocks/units/aiActivityMappingBlock'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import { mergedDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { registerProjectColors } from '@/components/lego_blocks/units/aiActivityColorsBlock'
// Local preset list — the shared DashboardRangePreset is tuned for the file
// dashboard above and doesn't include the 6m midpoint that's useful for
// month-over-month evolution watching.
export type AiActivityPreset = '7d' | '30d' | '90d' | '180d' | '365d' | 'all'

export const AI_ACTIVITY_PRESETS: ReadonlyArray<{
  id: AiActivityPreset
  label: string
  /** Days back from today. `null` = no cap (everything cached). */
  days: number | null
}> = [
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: '180d', label: '6m', days: 180 },
  { id: '365d', label: '1y', days: 365 },
  { id: 'all', label: 'all', days: null },
]

export interface ActivityDay {
  date: string
  totalMsgs: number
  totalChains: number
  /** Per-project msg counts on this day. */
  byProject: Record<string, number>
  /** Per-project chain message counts on this day, used by chain-based drill views. */
  byChainProject: Record<string, number>
  /** Per-project chain wall-clock duration (ms) on this day. Drives the heatmap
   *  tint so a day is colored by the project you spent the most *time* on, not
   *  the one with the most messages. */
  byChainProjectDurationMs: Record<string, number>
}

export interface ActivityProject {
  name: string
  totalMsgs: number
  /** Merged active wall-clock time across the range (overlaps collapsed). */
  totalMs: number
  totalChains: number
  totalSessions: number
  /** Msgs per day across the visible range, in chronological order. */
  sparkline: number[]
  /** Whether this is a noise bucket like [auto-commit] / [telegram]. */
  isNoise: boolean
  /** Whether this is the <unknown> bucket. */
  isUnknown: boolean
}

export type AiSourceFilter = 'all' | 'claude-code' | 'codex' | 'chatgpt' | 'grok' | 'reading'

/** Sub-source filter shown only when the "Reading" source pill is active. Acts
 *  as a second filter dimension within reading — the way the project chips
 *  filter AI sessions. 'all' shows every reading-family source. */
export type ReadingSourceFilter =
  | 'all'
  | 'memorized'
  | 'reading-md'
  | 'reading-draw'

/** Per-reading-source counts for the sub-source pill labels. */
export interface ReadingCounts {
  all: number
  memorized: number
  readingMd: number
  readingDraw: number
}

/** A named calendar range used as a whole-panel data filter. */
export interface CustomRange {
  /** Stable id for active-state matching (e.g. 'week', 'lastweek', 'month'). */
  id: string
  /** Short label for the active-range chip (e.g. 'This week'). */
  label: string
  startIso: string
  endIso: string
}

export interface UseAiActivityResult {
  /** All chains within the visible range, newest first. */
  chains: ActivityChain[]
  /** Today's chains, newest first — used by the auto-post-it. */
  todayChains: ActivityChain[]
  /** Per-day aggregates for the visible range. */
  days: ActivityDay[]
  /** Per-project aggregates for the visible range. */
  projects: ActivityProject[]
  /** Raw parsed sessions (post-filter), for callers that want their own view. */
  sessions: ParsedSession[]
  loading: boolean
  error: string | null
  preset: AiActivityPreset
  setPreset: (preset: AiActivityPreset) => void
  /** A calendar-relative range (this week / last week / this month) that
   *  overrides the preset and narrows ALL data, not just the heatmap drill.
   *  Null when a preset is the active range. */
  customRange: CustomRange | null
  setCustomRange: (range: CustomRange | null) => void
  /** Which AI tool's sessions to include. Project buckets stay folder-rooted; this
   *  just narrows which sessions feed every downstream aggregation. */
  sourceFilter: AiSourceFilter
  setSourceFilter: (filter: AiSourceFilter) => void
  /** Sub-source filter within the "Reading" pill (Memorize /
   *  Markdown / Drawing). Only meaningful while sourceFilter === 'reading'. */
  readingSource: ReadingSourceFilter
  setReadingSource: (filter: ReadingSourceFilter) => void
  /** How many sessions exist per source across the visible range — used to label
   *  the source pills and disable empty ones. `reading` is the sum of the whole
   *  reading family. */
  sourceCounts: { claudeCode: number; codex: number; chatgpt: number; grok: number; reading: number }
  /** Per-reading-source counts for the reading sub-source pills. */
  readingCounts: ReadingCounts
  startIso: string
  endIso: string
  refresh: () => void
}

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rangeFromPreset(
  preset: AiActivityPreset,
  earliestSessionIso: string | null,
): { startIso: string; endIso: string } {
  const cfg = AI_ACTIVITY_PRESETS.find(p => p.id === preset) ?? AI_ACTIVITY_PRESETS[2]
  const end = new Date()
  const endIso = isoDayLocal(end)
  if (cfg.days == null) {
    return {
      startIso: earliestSessionIso ?? isoDayLocal(new Date(end.getTime() - 365 * 86_400_000)),
      endIso,
    }
  }
  const start = new Date()
  start.setDate(end.getDate() - (cfg.days - 1))
  return { startIso: isoDayLocal(start), endIso }
}

function isoDaysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const cur = new Date(startIso + 'T00:00:00')
  const end = new Date(endIso + 'T00:00:00')
  while (cur <= end) {
    out.push(isoDayLocal(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function isNoiseProject(name: string): boolean {
  return name.startsWith('[') && name.endsWith(']')
}

const PRESET_STORAGE_KEY = 'thinkspc.aiActivity.preset.v1'
const SOURCE_FILTER_STORAGE_KEY = 'thinkspc.aiActivity.sourceFilter.v1'
const READING_SOURCE_STORAGE_KEY = 'thinkspc.aiActivity.readingSource.v1'
const VALID_PRESET_IDS = new Set(AI_ACTIVITY_PRESETS.map(p => p.id))
const VALID_SOURCE_FILTERS: ReadonlySet<AiSourceFilter> = new Set([
  'all',
  'claude-code',
  'codex',
  'chatgpt',
  'grok',
  'reading',
])
const VALID_READING_SOURCES: ReadonlySet<ReadingSourceFilter> = new Set([
  'all',
  'memorized',
  'reading-md',
  'reading-draw',
])

function readStoredSourceFilter(): AiSourceFilter | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SOURCE_FILTER_STORAGE_KEY)
    // Migrate the pre-umbrella 'goodnotes' pill onto the unified 'reading' pill.
    if (raw === 'goodnotes') return 'reading'
    if (raw && VALID_SOURCE_FILTERS.has(raw as AiSourceFilter)) {
      return raw as AiSourceFilter
    }
  } catch {
    /* localStorage unavailable */
  }
  return null
}

function writeStoredSourceFilter(value: AiSourceFilter): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, value)
  } catch {
    /* localStorage unavailable */
  }
}

function readStoredReadingSource(): ReadingSourceFilter | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(READING_SOURCE_STORAGE_KEY)
    if (raw && VALID_READING_SOURCES.has(raw as ReadingSourceFilter)) {
      return raw as ReadingSourceFilter
    }
  } catch {
    /* localStorage unavailable */
  }
  return null
}

function writeStoredReadingSource(value: ReadingSourceFilter): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(READING_SOURCE_STORAGE_KEY, value)
  } catch {
    /* localStorage unavailable */
  }
}

function readStoredPreset(): AiActivityPreset | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY)
    if (raw && VALID_PRESET_IDS.has(raw as AiActivityPreset)) {
      return raw as AiActivityPreset
    }
  } catch {
    /* localStorage unavailable */
  }
  return null
}

function writeStoredPreset(preset: AiActivityPreset): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, preset)
  } catch {
    /* localStorage unavailable */
  }
}

export function useAiActivityBlock(
  initialPreset: AiActivityPreset = '90d',
): UseAiActivityResult {
  // Persisted choice wins over the caller's initialPreset so the user's range
  // stays put across reloads (and across HMR-preserved component state).
  const [preset, setPresetState] = useState<AiActivityPreset>(
    () => readStoredPreset() ?? initialPreset,
  )
  // A calendar-relative override (this week / last week / this month). When
  // set it replaces the preset-derived range for ALL aggregations. Picking a
  // preset pill clears it so the two range controls never silently conflict.
  const [customRange, setCustomRangeState] = useState<CustomRange | null>(null)
  const setPreset = useCallback((next: AiActivityPreset) => {
    writeStoredPreset(next)
    setPresetState(next)
    setCustomRangeState(null)
  }, [])
  const setCustomRange = useCallback((range: CustomRange | null) => {
    setCustomRangeState(range)
  }, [])
  const [sourceFilter, setSourceFilterState] = useState<AiSourceFilter>(
    () => readStoredSourceFilter() ?? 'all',
  )
  const setSourceFilter = useCallback((next: AiSourceFilter) => {
    writeStoredSourceFilter(next)
    setSourceFilterState(next)
  }, [])
  const [readingSource, setReadingSourceState] = useState<ReadingSourceFilter>(
    () => readStoredReadingSource() ?? 'all',
  )
  const setReadingSource = useCallback((next: ReadingSourceFilter) => {
    writeStoredReadingSource(next)
    setReadingSourceState(next)
  }, [])
  // Seed from the module-level snapshot so a remount (or a second consumer
  // mounting after the first) gets instant paint instead of a loading flash.
  const initialSnapshot = getCachedSnapshot()
  const [allSessions, setAllSessions] = useState<ParsedSession[]>(
    initialSnapshot?.sessions ?? [],
  )
  const [loading, setLoading] = useState(initialSnapshot == null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Bumped whenever the user edits the project mapping so every derived view
  // (chains, chips, heatmap, table) regroups/recolors without a reparse.
  const [mappingVersion, setMappingVersion] = useState(0)
  useEffect(
    () => subscribeAiActivityMappingBlock(() => setMappingVersion(v => v + 1)),
    [],
  )
  // On a cold launch the load effect below may resolve with the device-persisted
  // seed while the real vault load keeps running in the background — adopt the
  // fresh result silently when it lands (same array reference on no-op, so this
  // never causes churn).
  useEffect(
    () =>
      subscribeAiActivitySnapshotBlock(() => {
        const snap = getCachedSnapshot()
        if (snap) {
          setAllSessions(snap.sessions)
          setLoading(false)
        }
      }),
    [],
  )

  const earliestSessionIso = useMemo<string | null>(() => {
    if (allSessions.length === 0) return null
    let minMs = Infinity
    for (const s of allSessions) {
      const t = Date.parse(s.startedIso)
      if (t < minMs) minMs = t
    }
    if (!Number.isFinite(minMs)) return null
    return isoDayLocal(new Date(minMs))
  }, [allSessions])

  useEffect(() => {
    let cancelled = false
    // Don't flip back to loading=true if we already painted from the snapshot —
    // background refreshes should feel seamless. refreshKey > 0 means the user
    // hit refresh; we show the spinner so they get feedback.
    if (refreshKey > 0 || allSessions.length === 0) setLoading(true)
    setError(null)
    const fs = getVaultFS()
    // Warm the project registry before sessions land, so the canonical-project
    // memo downstream reads a populated cache and folder variants collapse.
    Promise.all([loadProjectRegistryBlock(), loadAiActivity(fs, { force: refreshKey > 0 })])
      .then(([, result]) => {
        if (cancelled) return
        setAllSessions(result.sessions)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load Claude activity.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const { startIso, endIso } = useMemo(
    () =>
      customRange
        ? { startIso: customRange.startIso, endIso: customRange.endIso }
        : rangeFromPreset(preset, earliestSessionIso),
    [customRange, preset, earliestSessionIso],
  )

  // Apply temporal-inheritance once at the all-sessions layer so every
  // downstream view (range-filtered chains, today's chains, per-day, per-project)
  // sees the same enriched project assignments. Anchors from outside the
  // visible range can still rescue an unknown inside it.
  const enrichedSessions = useMemo(
    () => inheritUnknownSessions(allSessions),
    [allSessions],
  )

  // Apply the user's project mapping (rename / merge) on top of the auto-inferred
  // names. Done here — after inheritance, before every aggregation — so chains,
  // chips, heatmap, and the day table all group by the canonical name. Sessions
  // whose name is unchanged keep their identity (no needless object churn).
  const mappedSessions = useMemo(() => {
    void mappingVersion // re-run when the mapping changes
    let changed = false
    const next = enrichedSessions.map(s => {
      const canonical = resolveCanonicalProjectBlock(s.project, s.path, s.cwd)
      if (canonical === s.project) return s
      changed = true
      return { ...s, project: canonical }
    })
    return changed ? next : enrichedSessions
  }, [enrichedSessions, mappingVersion])

  // Apply the AI-source filter before the range overlap step so 'codex'/'claude
  // only' views drive every downstream aggregation (heatmap, area chart,
  // project chips, day timeline, today's chains) consistently.
  const sourceFilteredSessions = useMemo(() => {
    if (sourceFilter === 'all') return mappedSessions
    if (sourceFilter === 'reading') {
      // Umbrella: every reading-family source, optionally narrowed to one
      // sub-source by the reading sub-pills.
      return mappedSessions.filter(s => {
        if (!isReadingSource(s.source)) return false
        return readingSource === 'all' || s.source === readingSource
      })
    }
    return mappedSessions.filter(s => s.source === sourceFilter)
  }, [mappedSessions, sourceFilter, readingSource])

  // Sessions whose activity window OVERLAPS the visible range. A long-running
  // session (e.g. an 8-day Claude chat started a week ago but still active
  // yesterday) should appear in 7d view because there's recent activity, not
  // disappear because the *start* is older than the range.
  const sessions = useMemo(() => {
    const startMs = Date.parse(startIso + 'T00:00:00')
    const endMs = Date.parse(endIso + 'T23:59:59')
    return sourceFilteredSessions.filter(s => {
      const sStart = Date.parse(s.startedIso)
      const sEnd = Date.parse(s.endedIso ?? s.startedIso)
      // Overlap: [sStart, sEnd] intersects [startMs, endMs]
      return sEnd >= startMs && sStart <= endMs
    })
  }, [sourceFilteredSessions, startIso, endIso])

  // Counts for the pill labels — computed on the range-filtered superset (ignoring
  // the source filter) so each pill shows how many sessions it would surface.
  const { sourceCounts, readingCounts } = useMemo(() => {
    const startMs = Date.parse(startIso + 'T00:00:00')
    const endMs = Date.parse(endIso + 'T23:59:59')
    let claudeCode = 0
    let codex = 0
    let chatgpt = 0
    let grok = 0
    let memorized = 0
    let readingMd = 0
    let readingDraw = 0
    for (const s of enrichedSessions) {
      const sStart = Date.parse(s.startedIso)
      const sEnd = Date.parse(s.endedIso ?? s.startedIso)
      if (sEnd < startMs || sStart > endMs) continue
      const src: ActivitySource = s.source
      if (src === 'codex') codex += 1
      else if (src === 'chatgpt') chatgpt += 1
      else if (src === 'grok') grok += 1
      else if (src === 'memorized') memorized += 1
      else if (src === 'reading-md') readingMd += 1
      else if (src === 'reading-draw') readingDraw += 1
      else if (src === 'claude-code') claudeCode += 1
    }
    const reading = memorized + readingMd + readingDraw
    return {
      sourceCounts: { claudeCode, codex, chatgpt, grok, reading },
      readingCounts: { all: reading, memorized, readingMd, readingDraw },
    }
  }, [enrichedSessions, startIso, endIso])

  const chains = useMemo(() => buildChains(sessions), [sessions])

  const todayIso = useMemo(() => isoDayLocal(new Date()), [])
  const todayChains = useMemo(() => {
    // Today's chains are most useful when computed across ALL sessions (not just
    // the visible range), so a 7d-preset doesn't trim mid-chain sessions away.
    // Source filter still applies — a "Codex only" view's auto-post-it should
    // reflect Codex activity, not the merged today list.
    const todaySessions = sourceFilteredSessions.filter(
      s => isoDayLocal(new Date(s.startedIso)) === todayIso,
    )
    return buildChains(todaySessions)
  }, [sourceFilteredSessions, todayIso])

  const days = useMemo<ActivityDay[]>(() => {
    const dayList = isoDaysBetween(startIso, endIso)
    const map = new Map<string, ActivityDay>()
    for (const date of dayList) {
      map.set(date, {
        date,
        totalMsgs: 0,
        totalChains: 0,
        byProject: {},
        byChainProject: {},
        byChainProjectDurationMs: {},
      })
    }
    // Day-bucketing uses LOCAL calendar day, not UTC. The drill-down filter
    // (AiActivityPanelBlock) computes day boundaries via `Date.parse(selectedDate
    // + 'T00:00:00')` which is local midnight; if we slice startedIso (UTC) here
    // a late-night chain in CT lands in tomorrow UTC, the heatmap tints the
    // wrong cell, and clicking it shows zero matching chains.
    for (const s of sessions) {
      const date = isoDayLocal(new Date(s.startedIso))
      const day = map.get(date)
      if (!day) continue
      day.totalMsgs += s.userMsgCount
      day.byProject[s.project] = (day.byProject[s.project] ?? 0) + s.userMsgCount
    }
    // Chain counts per day (a chain belongs to its start day).
    for (const c of chains) {
      const date = isoDayLocal(new Date(c.startedIso))
      const day = map.get(date)
      if (day) {
        day.totalChains += 1
        day.byChainProject[c.project] =
          (day.byChainProject[c.project] ?? 0) + c.msgCount
        const durMs = Date.parse(c.endedIso) - Date.parse(c.startedIso)
        if (Number.isFinite(durMs) && durMs > 0) {
          day.byChainProjectDurationMs[c.project] =
            (day.byChainProjectDurationMs[c.project] ?? 0) + durMs
        }
      }
    }
    return dayList.map(d => map.get(d)!)
  }, [sessions, chains, startIso, endIso])

  const projects = useMemo<ActivityProject[]>(() => {
    const dayList = isoDaysBetween(startIso, endIso)
    const dayIndex = new Map(dayList.map((d, i) => [d, i]))
    const accum = new Map<string, ActivityProject>()

    const ensureProject = (key: string): ActivityProject => {
      const existing = accum.get(key)
      if (existing) return existing
      const next: ActivityProject = {
        name: key,
        totalMsgs: 0,
        totalMs: 0,
        totalChains: 0,
        totalSessions: 0,
        sparkline: new Array(dayList.length).fill(0),
        isNoise: isNoiseProject(key),
        isUnknown: key === '<unknown>',
      }
      accum.set(key, next)
      return next
    }

    // Session count remains session-based, but visible project ranking/counts
    // are chain-based so chips, heatmap tint, and drilldown table agree.
    for (const s of sessions) {
      const p = ensureProject(s.project)
      p.totalSessions += 1
    }
    const chainsByProject = new Map<string, ActivityChain[]>()
    for (const c of chains) {
      const p = ensureProject(c.project)
      p.totalMsgs += c.msgCount
      p.totalChains += 1
      const idx = dayIndex.get(isoDayLocal(new Date(c.startedIso)))
      if (idx != null) p.sparkline[idx] += c.msgCount
      const list = chainsByProject.get(c.project)
      if (list) list.push(c)
      else chainsByProject.set(c.project, [c])
    }
    // Merged active time per project (overlaps collapsed) — the same semantics
    // the drill totals use, so the chip time and the drill totals agree.
    for (const [project, projectChains] of chainsByProject) {
      ensureProject(project).totalMs = mergedDurationMsBlock(projectChains)
    }
    // Rank by time spent — that's the number the chips now surface.
    const sorted = [...accum.values()].sort((a, b) => b.totalMs - a.totalMs)
    // Register the visible set (busiest first) so every project gets a distinct
    // color and, on a hash collision, the busier project keeps its preferred
    // color. Done during the hook's render, before children paint, so charts
    // read the final colors on first paint instead of flashing.
    registerProjectColors(sorted.map(p => p.name))
    return sorted
  }, [sessions, chains, startIso, endIso])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // The top-chrome "Refresh" button is the single refresh affordance — when it
  // fires, force-reload AI activity from the vault too (no panel-local button).
  useEffect(() => addGlobalSyncRefreshListenerBlock(() => setRefreshKey(k => k + 1)), [])

  return {
    chains,
    todayChains,
    days,
    projects,
    sessions,
    loading,
    error,
    preset,
    setPreset,
    customRange,
    setCustomRange,
    sourceFilter,
    setSourceFilter,
    readingSource,
    setReadingSource,
    sourceCounts,
    readingCounts,
    startIso,
    endIso,
    refresh,
  }
}
