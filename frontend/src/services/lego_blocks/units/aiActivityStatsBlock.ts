// Aggregation math for AI activity: merged wall-clock durations and
// week/month/year period rollups over chains. Pure functions over
// already-parsed data — no IO, cheap enough to run in render memos.

import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { estimateSessionCostUsd } from '@/services/lego_blocks/units/aiPriceTableBlock'

/**
 * Wall-clock time across chains: merge overlapping [start, end] windows before
 * summing so two chains running in the same minute aren't double-counted.
 * Single-instant chains (end==start) contribute 0.
 */
export function mergedDurationMsBlock(chains: ReadonlyArray<ActivityChain>): number {
  const intervals: Array<[number, number]> = []
  for (const c of chains) {
    const start = Date.parse(c.startedIso)
    const end = Date.parse(c.endedIso ?? c.startedIso)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    intervals.push([start, end])
  }
  if (intervals.length === 0) return 0
  intervals.sort((a, b) => a[0] - b[0])
  let totalMs = 0
  let [curStart, curEnd] = intervals[0]
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i]
    if (s > curEnd) {
      totalMs += curEnd - curStart
      curStart = s
      curEnd = e
    } else if (e > curEnd) {
      curEnd = e
    }
  }
  totalMs += curEnd - curStart
  return totalMs
}

/** `12h 4m`, `3h`, `45m`, `<1m`, or `—` for zero. */
export function fmtDurationMsBlock(ms: number): string {
  if (ms <= 0) return '—'
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 1) return '<1m'
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export type AggregateGranularity = 'week' | 'set' | 'month' | 'year'

export interface AggregatePeriodRow {
  /** Sortable bucket key (e.g. `2026-06-01` for the week starting that Monday). */
  key: string
  /** Human label (e.g. `Jun 1 – Jun 7`, `Jun 2026`, `2026`). */
  label: string
  /** Local-calendar period bounds, inclusive — feed straight into range drill. */
  startIso: string
  endIso: string
  chains: number
  sessions: number
  msgs: number
  durationMs: number
  /** Fresh input tokens (cache reads/writes excluded — those are in `cachedTokens`). */
  inputTokens: number
  /** Output tokens. */
  outputTokens: number
  cachedTokens: number
  /** List-price equivalent of the priced sessions only. See `unpricedSessions`
   *  — when that is non-zero this figure is a floor, not a total. */
  costUsd: number
  /** Sessions whose model has no published rate. Their tokens are counted;
   *  their cost is not. Surfacing the count is what keeps `costUsd` from being
   *  a quietly incomplete number. */
  unpricedSessions: number
  hasTokens: boolean
  /** Chains with a real time window (end > start). Vault-markdown-only chains
   *  have no per-message timestamps, so they contribute 0 duration — when this
   *  is well below `chains`, the period's Time/token numbers undercount. */
  chainsWithDuration: number
  /** Chains where at least one session reported token usage. */
  chainsWithTokens: number
}

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMonthDay(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

function periodOf(
  startedIso: string,
  granularity: AggregateGranularity,
): { key: string; label: string; startIso: string; endIso: string } {
  const d = new Date(startedIso)
  if (granularity === 'week') {
    const start = mondayOf(d)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return {
      key: isoDayLocal(start),
      label: `${fmtMonthDay(start)} – ${fmtMonthDay(end)}`,
      startIso: isoDayLocal(start),
      endIso: isoDayLocal(end),
    }
  }
  if (granularity === 'set') {
    // Fixed 3-day sets anchored to the 1st of each month. Set N covers
    // day-of-month `3(N-1)+1 .. min(3N, monthLen)`. Last set of most months
    // is a 1- or 2-day stub since 30 and 31 aren't divisible by 3 — that's by
    // design; months stay containers, so "set 4 of Jul" is a real thing.
    const day = d.getDate()
    const setNum = Math.floor((day - 1) / 3) + 1
    const startDay = 3 * (setNum - 1) + 1
    const monthLen = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const endDay = Math.min(3 * setNum, monthLen)
    const start = new Date(d.getFullYear(), d.getMonth(), startDay)
    const end = new Date(d.getFullYear(), d.getMonth(), endDay)
    return {
      key: isoDayLocal(start),
      label: `${MONTH_SHORT[d.getMonth()]} set ${setNum}`,
      startIso: isoDayLocal(start),
      endIso: isoDayLocal(end),
    }
  }
  if (granularity === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return {
      key: isoDayLocal(start),
      label: `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`,
      startIso: isoDayLocal(start),
      endIso: isoDayLocal(end),
    }
  }
  const start = new Date(d.getFullYear(), 0, 1)
  const end = new Date(d.getFullYear(), 11, 31)
  return {
    key: isoDayLocal(start),
    label: String(d.getFullYear()),
    startIso: isoDayLocal(start),
    endIso: isoDayLocal(end),
  }
}

/** Stable bucket key for the period a chain's start falls in — lets callers
 *  group chains the same way `aggregateChainsByPeriodBlock` buckets rows. */
export function periodKeyOfBlock(startedIso: string, granularity: AggregateGranularity): string {
  return periodOf(startedIso, granularity).key
}

export interface ProjectDigest {
  project: string
  durationMs: number
  chains: number
  msgs: number
  /** Top chain topics, ranked by chain duration (then msgs), deduped, capped.
   *  Label-only topics (`[/clear]`, `[auto commit message]`) and empty
   *  placeholders are skipped — they say nothing about the work. */
  topics: string[]
}

/**
 * "What was worked on": per-project rollup of a set of chains (typically one
 * period's worth), sorted by time spent descending. Topics are the chains'
 * opening prompts — the most faithful zero-AI signal of what the work was.
 */
export function projectDigestBlock(
  chains: ReadonlyArray<ActivityChain>,
  maxTopics = 4,
): ProjectDigest[] {
  const byProject = new Map<string, ActivityChain[]>()
  for (const c of chains) {
    const arr = byProject.get(c.project)
    if (arr) arr.push(c)
    else byProject.set(c.project, [c])
  }
  const out: ProjectDigest[] = []
  for (const [project, list] of byProject) {
    const ranked = [...list].sort((a, b) => {
      const da = Date.parse(a.endedIso) - Date.parse(a.startedIso)
      const db = Date.parse(b.endedIso) - Date.parse(b.startedIso)
      if (db !== da) return db - da
      return b.msgCount - a.msgCount
    })
    const seen = new Set<string>()
    const topics: string[] = []
    for (const c of ranked) {
      const t = c.topic.trim()
      if (!t || t === '(no user message)') continue
      if (t.startsWith('[') && t.endsWith(']')) continue
      if (seen.has(t)) continue
      seen.add(t)
      topics.push(t)
      if (topics.length >= maxTopics) break
    }
    out.push({
      project,
      durationMs: mergedDurationMsBlock(list),
      chains: list.length,
      msgs: list.reduce((n, c) => n + c.msgCount, 0),
      topics,
    })
  }
  out.sort((a, b) => (b.durationMs !== a.durationMs ? b.durationMs - a.durationMs : b.msgs - a.msgs))
  return out
}

export interface AggregatePeriodInfo {
  key: string
  label: string
  startIso: string
  endIso: string
}

export interface ProjectPeriodMetrics {
  durationMs: number
  chains: number
  msgs: number
  /** List-price equivalent of the priced sessions only — a floor when
   *  `unpricedSessions` is non-zero. */
  costUsd: number
  /** Sessions with no published rate for their model. */
  unpricedSessions: number
}

export interface AggregateProjectMetricSeries {
  project: string
  /** Whole-range totals (duration interval-merged) — used for top-N ranking. */
  totals: ProjectPeriodMetrics
  /** Per-period metrics, aligned with the `periods` array (oldest first). */
  perPeriod: ProjectPeriodMetrics[]
}

/**
 * Per-project metric series across periods, for the stacked totals bar graph.
 * Periods come back oldest-first (chart x-axis order); series are unsorted —
 * callers rank by whichever metric they're displaying. Empty periods between
 * active ones are NOT synthesized — buckets exist only where chains do.
 */
export function aggregateProjectMetricsByPeriodBlock(
  chains: ReadonlyArray<ActivityChain>,
  granularity: AggregateGranularity,
): { periods: AggregatePeriodInfo[]; series: AggregateProjectMetricSeries[] } {
  const periodByKey = new Map<string, AggregatePeriodInfo>()
  const chainsByGroup = new Map<string, ActivityChain[]>() // `${periodKey} ${project}`
  const projects = new Set<string>()
  for (const c of chains) {
    const p = periodOf(c.startedIso, granularity)
    if (!periodByKey.has(p.key)) periodByKey.set(p.key, p)
    projects.add(c.project)
    const groupKey = `${p.key} ${c.project}`
    const arr = chainsByGroup.get(groupKey)
    if (arr) arr.push(c)
    else chainsByGroup.set(groupKey, [c])
  }
  const periods = [...periodByKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  const metricsOf = (list: ReadonlyArray<ActivityChain>): ProjectPeriodMetrics => {
    let msgs = 0
    let costUsd = 0
    let unpricedSessions = 0
    for (const c of list) {
      msgs += c.msgCount
      for (const s of c.sessions) {
        if (!s.tokens) continue
        const cost = estimateSessionCostUsd(s)
        if (cost === null) unpricedSessions += 1
        else {
          costUsd += cost.usd
          if (cost.unpricedModels.length > 0) unpricedSessions += 1
        }
      }
    }
    return {
      durationMs: mergedDurationMsBlock(list),
      chains: list.length,
      msgs,
      costUsd,
      unpricedSessions,
    }
  }

  const series: AggregateProjectMetricSeries[] = []
  for (const project of projects) {
    const groups = periods.map(p => chainsByGroup.get(`${p.key}\u0000${project}`) ?? [])
    const perPeriod = groups.map(metricsOf)
    series.push({
      project,
      totals: {
        durationMs: mergedDurationMsBlock(groups.flat()),
        chains: perPeriod.reduce((a, m) => a + m.chains, 0),
        msgs: perPeriod.reduce((a, m) => a + m.msgs, 0),
        costUsd: perPeriod.reduce((a, m) => a + m.costUsd, 0),
        unpricedSessions: perPeriod.reduce((a, m) => a + m.unpricedSessions, 0),
      },
      perPeriod,
    })
  }
  return { periods, series }
}

/**
 * Roll chains up into week/month/year buckets (a chain belongs to the period
 * its start falls in — consistent with the heatmap's day bucketing). Rows come
 * back newest-period-first.
 */
export function aggregateChainsByPeriodBlock(
  chains: ReadonlyArray<ActivityChain>,
  granularity: AggregateGranularity,
): AggregatePeriodRow[] {
  const map = new Map<string, AggregatePeriodRow>()
  for (const c of chains) {
    const p = periodOf(c.startedIso, granularity)
    let row = map.get(p.key)
    if (!row) {
      row = {
        key: p.key,
        label: p.label,
        startIso: p.startIso,
        endIso: p.endIso,
        chains: 0,
        sessions: 0,
        msgs: 0,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        unpricedSessions: 0,
        hasTokens: false,
        chainsWithDuration: 0,
        chainsWithTokens: 0,
      }
      map.set(p.key, row)
    }
    row.chains += 1
    row.sessions += c.sessions.length
    row.msgs += c.msgCount
    const cStart = Date.parse(c.startedIso)
    const cEnd = Date.parse(c.endedIso ?? c.startedIso)
    if (Number.isFinite(cStart) && Number.isFinite(cEnd) && cEnd > cStart) {
      row.chainsWithDuration += 1
    }
    let chainHasTokens = false
    for (const s of c.sessions) {
      const t = s.tokens
      if (!t) continue
      const total = t.input + t.output + t.cacheRead + t.cacheCreation
      if (total <= 0) continue
      row.hasTokens = true
      chainHasTokens = true
      row.inputTokens += t.input
      row.outputTokens += t.output
      row.cachedTokens += t.cacheRead + t.cacheCreation
      const cost = estimateSessionCostUsd(s)
      if (cost === null) row.unpricedSessions += 1
      else {
        row.costUsd += cost.usd
        if (cost.unpricedModels.length > 0) row.unpricedSessions += 1
      }
    }
    if (chainHasTokens) row.chainsWithTokens += 1
  }
  // Duration needs interval-merging per bucket, so do a second pass grouping
  // the chains themselves (cheap — same map keys).
  const chainsByKey = new Map<string, ActivityChain[]>()
  for (const c of chains) {
    const key = periodOf(c.startedIso, granularity).key
    const arr = chainsByKey.get(key)
    if (arr) arr.push(c)
    else chainsByKey.set(key, [c])
  }
  for (const [key, row] of map) {
    row.durationMs = mergedDurationMsBlock(chainsByKey.get(key) ?? [])
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1))
}
