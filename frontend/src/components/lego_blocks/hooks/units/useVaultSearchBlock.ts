// Live vault search for any surface: debounced query → ranked hits from the
// shared engine, re-run automatically when a sync makes results stale (an
// agent writing a note shows up in an open search). `null` while idle.

import { useEffect, useState } from 'react'
import {
  onVaultSearchStaleOrch,
  searchVaultOrch,
  type VaultSearchOptions,
} from '@/services/orchestrators/vaultSearchOrch'
import type { VaultSearchRanking } from '@/services/lego_blocks/units/vaultSearchRankBlock'

const DEBOUNCE_MS = 60

export function useVaultSearchBlock(query: string, options: VaultSearchOptions = {}): VaultSearchRanking | null {
  const { scope, limit } = options
  const trimmed = query.trim()
  const [ranking, setRanking] = useState<VaultSearchRanking | null>(null)
  const [staleTick, setStaleTick] = useState(0)

  useEffect(() => {
    if (!trimmed) return undefined
    return onVaultSearchStaleOrch(() => setStaleTick(t => t + 1))
  }, [trimmed])

  useEffect(() => {
    if (!trimmed) {
      setRanking(null)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchVaultOrch(trimmed, { scope, limit })
        .then(next => { if (!cancelled) setRanking(next) })
        .catch(() => { if (!cancelled) setRanking({ hits: [], total: 0 }) })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, scope, limit, staleTick])

  return trimmed ? ranking : null
}
