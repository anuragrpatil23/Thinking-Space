import { useCallback, useEffect, useState } from 'react'
import type { AiLimitsProviderBlock } from '@/services/lego_blocks/units/aiLimitsModelBlock'

interface AiPlanUsageStateBlock {
  providers: AiLimitsProviderBlock[]
  /** Frozen clock captured with the reading, so countdowns match the data. */
  nowMs: number
  refresh: () => void
}

/**
 * Plan usage for the AI tools installed on this machine.
 *
 * Reads through Electron IPC; on web/iOS there is no local Codex app-server or
 * status-line file to read, so the hook returns nothing and the card hides
 * itself rather than showing an error for a platform where the feature can't
 * exist.
 *
 * No polling timer. A reading is taken on mount and whenever the window regains
 * focus — coming back to the app is exactly when a stale figure matters, and it
 * keeps this off a periodic wake (ENERGY.md).
 */
export function useAiPlanUsageBlock(): AiPlanUsageStateBlock {
  const [providers, setProviders] = useState<AiLimitsProviderBlock[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())

  const refresh = useCallback(() => {
    const read = window.electronAPI?.aiPlanUsageRead
    if (!read) return
    void read()
      .then((next) => {
        setProviders(next)
        setNowMs(Date.now())
      })
      .catch(() => {
        // Main-process read failed. Keep the last good reading rather than
        // blanking the card — a stale figure beats a flicker to empty.
      })
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = (): void => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return { providers, nowMs, refresh }
}
