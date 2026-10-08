import { useEffect, useState } from 'react'
import { loadSessionLimitSharesOrch } from '@/services/orchestrators/aiLimitShareOrch'
import type { SessionLimitShareBlock } from '@/services/lego_blocks/units/aiLimitShareBlock'

/**
 * Each sitting's share of the plan's session and weekly limits, keyed by
 * session id.
 *
 * Empty until the first read lands, and empty for good on a device with no
 * usage capture — callers render nothing for a session that is not in the map,
 * which is the honest reading of "never measured".
 *
 * No timer. It reads on mount and whenever `refreshKey` changes; pass the thing
 * whose change means new activity arrived (the chain list).
 */
export function useSessionLimitSharesBlock(
  refreshKey: unknown,
): ReadonlyMap<string, SessionLimitShareBlock> {
  const [shares, setShares] = useState<ReadonlyMap<string, SessionLimitShareBlock>>(
    () => new Map(),
  )

  useEffect(() => {
    let alive = true
    void loadSessionLimitSharesOrch()
      .then(next => {
        if (alive) setShares(next)
      })
      .catch(() => {
        // Keep the last good map; a failed read must not blank the rows.
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  return shares
}
