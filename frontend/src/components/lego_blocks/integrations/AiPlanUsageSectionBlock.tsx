import { Suspense, lazy, useMemo } from 'react'
import { cn } from '@/lib/utils'
import AiLimitsStripBlock from '@/components/lego_blocks/integrations/AiLimitsStripBlock'
import type { useAiPlanUsageBlock } from '@/components/lego_blocks/hooks/shared/useAiPlanUsageBlock'
import {
  formatUpdatedAgoBlock,
  visibleProvidersBlock,
  type AiLimitsProviderIdBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'
import {
  buildPlanUsageDaysBlock,
  formatPlanUsagePctBlock,
  providersWithPlanUsageHistoryBlock,
  type PlanUsageMoveBlock,
} from '@/services/lego_blocks/units/aiPlanUsageHistoryBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'

// Lazy for the same reason as the Trend chart: recharts must not be statically
// reachable from the entry (STARTUP-PERFORMANCE.md).
const AiPlanUsageChartBlock = lazy(() => import('@/components/lego_blocks/units/AiPlanUsageChartBlock'))

const PROVIDER_LABEL_BLOCK: Record<AiLimitsProviderIdBlock, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

// The Totals section's segmented control, restated here rather than imported:
// those constants live in a lazy chart chunk, and a static import of it would
// pull recharts into this block.
const TOGGLE_ROW_CLASS =
  'inline-grid w-fit auto-cols-fr grid-flow-col rounded-lg bg-foreground/[0.06] p-0.5'
const TOGGLE_CLASS =
  'rounded-md px-3 py-1 text-center text-[11px] font-medium leading-none transition-colors ' +
  'outline-none focus-visible:ring-1 focus-visible:ring-foreground/40'
const TOGGLE_ACTIVE_CLASS =
  'bg-card text-foreground shadow-sm ring-1 ring-black/[0.04] dark:bg-foreground/15 dark:ring-0'
const TOGGLE_IDLE_CLASS = 'text-muted-foreground hover:text-foreground'

/**
 * The section's one control, for the heading row: which provider the meters
 * and the graph are about. Renders nothing when there is only one to choose.
 */
export function AiPlanUsageProviderToggleBlock({
  ids,
  value,
  onChange,
}: {
  ids: readonly AiLimitsProviderIdBlock[]
  value: AiLimitsProviderIdBlock
  onChange: (next: AiLimitsProviderIdBlock) => void
}) {
  if (ids.length < 2) return null
  return (
    <div className={TOGGLE_ROW_CLASS}>
      {ids.map(id => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={id === value}
          className={cn(TOGGLE_CLASS, id === value ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS)}
        >
          {PROVIDER_LABEL_BLOCK[id]}
        </button>
      ))}
    </div>
  )
}

interface AiPlanUsageSectionBlockProps {
  /** The provider the whole section is about, picked by the heading's toggle. */
  provider: AiLimitsProviderIdBlock
  /** Where the limits stand now — the meters. */
  planUsage: ReturnType<typeof useAiPlanUsageBlock>
  /** Every weekly-limit movement on record — the graph. */
  moves: readonly PlanUsageMoveBlock[]
  /** Base session id → project, across every session, not just the visible ones. */
  projectByBaseSid: ReadonlyMap<string, string>
  /** The card's visible range, one entry per day, oldest first. */
  dates: readonly string[]
  /** The card's project filter; narrows the graph to that project's share. */
  filterProject?: string | null
}

/**
 * The body of the AI activity card's "Plan usage" section: where one
 * provider's limits stand now, then how its weekly one was used across the
 * visible days.
 *
 * One provider at a time, for both halves. Each provider meters its own
 * account, so their percentages do not add and their bars cannot share a
 * chart; and showing both providers' meters above a one-provider chart named
 * every provider twice.
 */
export default function AiPlanUsageSectionBlock({
  provider,
  planUsage,
  moves,
  projectByBaseSid,
  dates,
  filterProject = null,
}: AiPlanUsageSectionBlockProps) {
  const live = useMemo(
    () => visibleProvidersBlock(planUsage.providers).find(p => p.id === provider) ?? null,
    [planUsage.providers, provider],
  )
  const hasHistory = useMemo(
    () => providersWithPlanUsageHistoryBlock(moves).includes(provider),
    [moves, provider],
  )

  const days = useMemo(
    () => buildPlanUsageDaysBlock(moves, projectByBaseSid, dates, provider),
    [moves, projectByBaseSid, dates, provider],
  )
  const hasBars = useMemo(
    () =>
      days.some(day =>
        filterProject
          ? (day.byProject[filterProject] ?? 0) > 0
          : day.unattributed > 0 || Object.keys(day.byProject).length > 0,
      ),
    [days, filterProject],
  )
  // What the selected project used across the days on screen — the sum of its
  // bars, so the figure and the chart under it are the same number.
  const projectTotalPct = useMemo(
    () =>
      filterProject
        ? days.reduce((sum, day) => sum + (day.byProject[filterProject] ?? 0), 0)
        : 0,
    [days, filterProject],
  )

  // The meters read on open and on window focus, never on a poll, so a figure
  // can be minutes old with nothing else admitting it. Doubles as the manual
  // refresh — the thing you reach for the moment you notice the number is stale.
  const refreshLine = live && (
    <button
      type="button"
      onClick={planUsage.refresh}
      title="Take a new reading"
      className="shrink-0 rounded text-[10.5px] text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
    >
      Updated {formatUpdatedAgoBlock(planUsage.readAtMs, planUsage.nowMs)} · refresh
    </button>
  )

  return (
    <div className="flex flex-col gap-9">
      {/* px-3: the section heading is set 12px in from the card's edge, and
          text directly under it has to start on that same line. The chart runs
          to the card's own margin, as Trend's does. */}
      {live && (
        <div className="px-3">
          <AiLimitsStripBlock
            provider={live}
            nowMs={planUsage.nowMs}
            statusLineScriptPath={planUsage.statusLineScriptPath}
            statusLineMode={planUsage.statusLineMode}
          />
        </div>
      )}

      {/* No history yet (the day a provider is first connected): the line still
          needs somewhere to live. */}
      {!hasHistory && refreshLine && <div className="px-3">{refreshLine}</div>}

      {hasHistory && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 px-3">
            <p className="text-xs text-muted-foreground">
              Weekly limit used each day
              {filterProject ? ` · ${projectLabelBlock(filterProject)}` : ''}
              {filterProject && hasBars && (
                <span className="ml-1.5 font-medium tabular-nums text-foreground">
                  {formatPlanUsagePctBlock(projectTotalPct)} total
                </span>
              )}
            </p>
            {refreshLine}
          </div>
          {hasBars ? (
            <Suspense fallback={<div className="h-44" />}>
              <AiPlanUsageChartBlock days={days} filterProject={filterProject} />
            </Suspense>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No {PROVIDER_LABEL_BLOCK[provider]} weekly usage recorded
              {filterProject ? ` for ${projectLabelBlock(filterProject)}` : ''} in this range
            </p>
          )}
        </div>
      )}
    </div>
  )
}
