import { useEffect, useState } from 'react'
import { readSyncedPricesOrch, type SyncedPriceBlock } from '@/personal_extension/services/orchestrators/webullPricesOrch'
import { useF9SyncBlock } from './useF9AppSyncBlock'

/**
 * One company's latest price as F9 sync keeps it (the last close, or the day's
 * live quote over it). Nothing is fetched: it is read again whenever a sync
 * run ends, which is when the quotes are written.
 */
export function useSyncedPriceBlock(executionRoot: string | null, ticker: string): SyncedPriceBlock | null {
  const { snap } = useF9SyncBlock()
  const running = Boolean(snap?.run)
  const [price, setPrice] = useState<SyncedPriceBlock | null>(null)
  useEffect(() => {
    if (!executionRoot || !ticker || running) return
    let live = true
    void readSyncedPricesOrch(executionRoot, [ticker])
      .then(map => { if (live) setPrice(map.get(ticker.toUpperCase()) ?? null) })
      .catch(() => undefined)
    return () => { live = false }
  }, [executionRoot, ticker, running])
  return price
}
