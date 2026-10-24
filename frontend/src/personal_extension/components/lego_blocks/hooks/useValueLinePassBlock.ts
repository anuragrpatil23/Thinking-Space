import { useEffect, useMemo } from 'react'
import {
  earningsCallPassDueOrch,
  earningsCallsAvailableOrch,
  runEarningsCallPassOrch,
} from '@/personal_extension/services/orchestrators/webullEarningsCallsOrch'
import {
  runValueLinePassOrch,
  setValueLinePassTargetOrch,
  valueLineAvailableOrch,
  valueLinePassDueOrch,
} from '@/personal_extension/services/orchestrators/webullValueLineOrch'

/**
 * Once a day, when the F9 page is open or comes back to the front, bring every
 * tracked company's Value Line report and earnings calls up to date (desktop
 * only; no timers). The two run side by side: different sources, own queues.
 */
export function useValueLinePassBlock(executionRoot: string | null, tickers: Array<string | null>) {
  const list = useMemo(
    () => [...new Set(tickers.filter((t): t is string => Boolean(t && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))))].sort(),
    [tickers],
  )
  const listKey = list.join(',')

  useEffect(() => {
    if (!executionRoot || list.length === 0) return
    setValueLinePassTargetOrch(executionRoot, list)
    const run = () => {
      if (valueLineAvailableOrch() && valueLinePassDueOrch()) void runValueLinePassOrch(executionRoot, list)
      if (earningsCallsAvailableOrch() && earningsCallPassDueOrch()) void runEarningsCallPassOrch(executionRoot, list)
    }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // The list's contents, not its identity
  }, [executionRoot, listKey]) // eslint-disable-line react-hooks/exhaustive-deps
}
