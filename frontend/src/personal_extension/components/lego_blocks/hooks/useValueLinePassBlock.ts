import { useEffect, useMemo } from 'react'
import {
  runValueLinePassOrch,
  valueLineAvailableOrch,
  valueLinePassDueOrch,
} from '@/personal_extension/services/orchestrators/webullValueLineOrch'

/**
 * Once a day, when the F9 page is open or comes back to the front, bring every
 * tracked company's Value Line report up to date (desktop only; no timers).
 */
export function useValueLinePassBlock(executionRoot: string | null, tickers: Array<string | null>) {
  const list = useMemo(
    () => [...new Set(tickers.filter((t): t is string => Boolean(t && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))))].sort(),
    [tickers],
  )
  const listKey = list.join(',')

  useEffect(() => {
    if (!executionRoot || list.length === 0 || !valueLineAvailableOrch()) return
    const run = () => { if (valueLinePassDueOrch()) void runValueLinePassOrch(executionRoot, list) }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // The list's contents, not its identity
  }, [executionRoot, listKey]) // eslint-disable-line react-hooks/exhaustive-deps
}
