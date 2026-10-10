import { Suspense, lazy, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import AiLimitsStripBlock from '@/components/lego_blocks/integrations/AiLimitsStripBlock'
import type { useAiPlanUsageBlock } from '@/components/lego_blocks/hooks/shared/useAiPlanUsageBlock'
import type { AiLimitsProviderIdBlock } from '@/services/lego_blocks/units/aiLimitsModelBlock'
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

interface AiPlanUsageSectionBlockProps {
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
 * The body of the AI activity card's "Plan usage" section: where the limits
 * stand now, then how the weekly one was used across the visible days.
 *
 * The graph is one provider at a time. Each provider meters its own account,
 * so their percentages do not add, and two half-width charts side by side would
 * stop lining up with the Trend chart's dates directly above.
 */
export default function AiPlanUsageSectionBlock({
  planUsage,
  moves,
  projectByBaseSid,
  dates,
  filterProject = null,
}: AiPlanUsageSectionBlockProps) {
  const historyProviders = useMemo(() => providersWithPlanUsageHistoryBlock(moves), [moves])
  const [chosen, setChosen] = useState<AiLimitsProviderIdBlock | null>(null)
  const provider =
    chosen && historyProviders.includes(chosen) ? chosen : (historyProviders[0] ?? null)

  const days = useMemo(
    () => (provider ? buildPlanUsageDaysBlock(moves, projectByBaseSid, dates, provider) : []),
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

  return (
    <div className="flex flex-col gap-6">
      {/* px-3 / pl-3: the section heading is set 12px in from the card's edge,
          and text directly under it has to start on that same line. The chart
          and the toggle run to the card's own margin, as Trend and Totals do. */}
      <div className="px-3 empty:hidden">
      <AiLimitsStripBlock
        providers={planUsage.providers}
        nowMs={planUsage.nowMs}
        statusLineScriptPath={planUsage.statusLineScriptPath}
        statusLineMode={planUsage.statusLineMode}
        readAtMs={planUsage.readAtMs}
        onRefresh={planUsage.refresh}
      />
      </div>

      {provider && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="pl-3 text-xs text-muted-foreground">
              Weekly limit used each day
              {filterProject ? ` · ${projectLabelBlock(filterProject)}` : ''}
              {filterProject && hasBars && (
                <span className="ml-1.5 font-medium tabular-nums text-foreground">
                  {formatPlanUsagePctBlock(projectTotalPct)} total
                </span>
              )}
            </p>
            {historyProviders.length > 1 && (
              <div className={TOGGLE_ROW_CLASS}>
                {historyProviders.map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChosen(id)}
                    className={cn(
                      TOGGLE_CLASS,
                      id === provider ? TOGGLE_ACTIVE_CLASS : TOGGLE_IDLE_CLASS,
                    )}
                  >
                    {PROVIDER_LABEL_BLOCK[id]}
                  </button>
                ))}
              </div>
            )}
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
