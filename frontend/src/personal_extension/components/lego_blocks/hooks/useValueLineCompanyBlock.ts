import { useEffect, useState } from 'react'
import {
  syncValueLineOrch,
  valueLineAvailableOrch,
  valueLineNotCoveredOrch,
} from '@/personal_extension/services/orchestrators/webullValueLineOrch'

/**
 * Opening a company brings its Value Line report up to date (desktop only).
 * `fetchedCount` goes up when a new issue lands, so the page can reload.
 */
export function useValueLineCompanyBlock(executionRoot: string | null, ticker: string) {
  const [checking, setChecking] = useState(false)
  const [notCovered, setNotCovered] = useState(false)
  const [fetchedCount, setFetchedCount] = useState(0)

  useEffect(() => {
    const symbol = ticker.trim().toUpperCase()
    setNotCovered(symbol ? valueLineNotCoveredOrch(symbol) : false)
    if (!executionRoot || !symbol || !valueLineAvailableOrch()) return
    let cancelled = false
    setChecking(true)
    void syncValueLineOrch(executionRoot, symbol)
      .then((result) => {
        if (cancelled) return
        setNotCovered(result.outcome === 'not-covered')
        if (result.outcome === 'fetched') setFetchedCount(n => n + 1)
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => {
      cancelled = true
    }
  }, [executionRoot, ticker])

  return { checking, notCovered, fetchedCount }
}
