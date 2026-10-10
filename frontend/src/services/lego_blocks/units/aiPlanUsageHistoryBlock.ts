/**
 * The weekly plan limit over time: how many points of it each day used, and
 * which project used them.
 *
 * Built on the limit ledger (`aiLimitShareBlock`), so every bar is a measured
 * movement of the provider's own meter — not tokens converted at a guessed
 * rate. This block only does the last step: put each movement on a calendar
 * day and under a project.
 *
 * Pure apart from the local timezone, which decides what "a day" is the same
 * way the trend chart and heatmap decide it.
 */

import {
  visibleProvidersBlock,
  type AiLimitsProviderBlock,
  type AiLimitsProviderIdBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'

/** One movement of a provider's weekly meter. */
export interface PlanUsageMoveBlock {
  /** Epoch seconds of the reading that revealed the movement. */
  t: number
  provider: AiLimitsProviderIdBlock
  /** Base session id that spent it, or null when no local session did. */
  baseSid: string | null
  /** Percentage points of the weekly limit. */
  pct: number
}

export interface PlanUsageDayBlock {
  /** Local calendar day, YYYY-MM-DD. */
  date: string
  /** Points of the weekly limit, by project. */
  byProject: Record<string, number>
  /**
   * Points no known session accounts for: usage on claude.ai, on a machine
   * whose sessions never reached this vault, or a session with no project.
   * Kept as its own figure rather than spread over the projects that were
   * running — absence is not evidence (DERIVATION.md).
   */
  unattributed: number
}

function isoDayLocalBlock(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * One row per requested date, in the order given, for one provider.
 *
 * A row is all zeros both for a day nothing was used and for a day from before
 * the capture existed; `hasPlanUsageHistoryBlock` is how a caller tells an
 * empty chart from "nothing measured here".
 */
export function buildPlanUsageDaysBlock(
  moves: readonly PlanUsageMoveBlock[],
  projectByBaseSid: ReadonlyMap<string, string>,
  dates: readonly string[],
  provider: AiLimitsProviderIdBlock,
): PlanUsageDayBlock[] {
  const rows = new Map<string, PlanUsageDayBlock>()
  for (const date of dates) rows.set(date, { date, byProject: {}, unattributed: 0 })

  for (const move of moves) {
    if (move.provider !== provider || !(move.pct > 0)) continue
    const row = rows.get(isoDayLocalBlock(move.t))
    if (!row) continue
    const project = move.baseSid ? projectByBaseSid.get(move.baseSid) : undefined
    if (project) row.byProject[project] = (row.byProject[project] ?? 0) + move.pct
    else row.unattributed += move.pct
  }
  return dates.map((date) => rows.get(date) as PlanUsageDayBlock)
}

/** Which providers have any weekly movement on record at all. */
export function providersWithPlanUsageHistoryBlock(
  moves: readonly PlanUsageMoveBlock[],
): AiLimitsProviderIdBlock[] {
  const seen = new Set<AiLimitsProviderIdBlock>()
  for (const move of moves) if (move.pct > 0) seen.add(move.provider)
  return (['claude', 'codex'] as const).filter((id) => seen.has(id))
}

/**
 * Which providers the plan-usage section has anything to say about: a live
 * meter, a recorded history, or both. Empty means the section does not render.
 */
export function planUsageProviderIdsBlock(
  providers: AiLimitsProviderBlock[],
  moves: readonly PlanUsageMoveBlock[],
): AiLimitsProviderIdBlock[] {
  const ids = new Set<AiLimitsProviderIdBlock>(providersWithPlanUsageHistoryBlock(moves))
  for (const provider of visibleProvidersBlock(providers)) ids.add(provider.id)
  return (['claude', 'codex'] as const).filter((id) => ids.has(id))
}

/** Points for a chart axis or tooltip: "<1%" for a sliver, whole points otherwise. */
export function formatPlanUsagePctBlock(pct: number): string {
  if (!(pct > 0)) return '0%'
  if (pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}
