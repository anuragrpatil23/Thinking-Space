import { useEffect, useState } from 'react'
import { loadPlanUsageMovesOrch } from '@/services/orchestrators/aiLimitShareOrch'
import type { PlanUsageMoveBlock } from '@/services/lego_blocks/units/aiPlanUsageHistoryBlock'

/**
 * Every movement of the weekly plan limits on record, for the plan-usage graph.
 *
 * Empty until the first read lands, and empty for good on a device with no
 * usage capture — the graph then has nothing to draw and its section hides.
 *
 * No timer. It reads on mount and whenever `refreshKey` changes; pass the thing
 * whose change means new activity arrived (the chain list).
 */
export function usePlanUsageMovesBlock(refreshKey: unknown): readonly PlanUsageMoveBlock[] {
  const [moves, setMoves] = useState<readonly PlanUsageMoveBlock[]>([])

  useEffect(() => {
    let alive = true
    void loadPlanUsageMovesOrch()
      .then(next => {
        if (alive) setMoves(next)
      })
      .catch(() => {
        // Keep the last good list; a failed read must not blank the graph.
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  return moves
}
