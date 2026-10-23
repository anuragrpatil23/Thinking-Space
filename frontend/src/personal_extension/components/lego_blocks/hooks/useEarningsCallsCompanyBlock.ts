import { useEffect, useState } from 'react'
import {
  earningsCallsAvailableOrch,
  earningsCallsNotCoveredOrch,
  syncEarningsCallsOrch,
} from '@/personal_extension/services/orchestrators/webullEarningsCallsOrch'

/**
 * Opening a company brings its earnings calls up to date (desktop only).
 * `fetchedCount` goes up when new calls land, so the page can reload.
 */
export function useEarningsCallsCompanyBlock(executionRoot: string | null, ticker: string) {
  const symbol = ticker.trim().toUpperCase()
  const available = Boolean(executionRoot && symbol && earningsCallsAvailableOrch())
  const [checking, setChecking] = useState(false)
  const [notCovered, setNotCovered] = useState(false)
  const [fetchedCount, setFetchedCount] = useState(0)

  useEffect(() => {
    setNotCovered(symbol ? earningsCallsNotCoveredOrch(symbol) : false)
    if (!available) return
    let cancelled = false
    setChecking(true)
    void syncEarningsCallsOrch(executionRoot!, symbol)
      .then((result) => {
        if (cancelled) return
        setNotCovered(result.outcome === 'not-covered')
        if (result.outcome === 'fetched') setFetchedCount(n => n + 1)
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => {
      cancelled = true
    }
  }, [available, executionRoot, symbol])

  return { available, checking, notCovered, fetchedCount }
}
