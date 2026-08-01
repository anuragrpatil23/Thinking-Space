import { useCallback, useEffect, useState } from 'react'
import {
  getUndertakingOrch,
  type UndertakingView,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

export interface UndertakingDetailState {
  view: UndertakingView | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useUndertakingDetailBlock(
  projectId: string | null,
  key: string | null,
): UndertakingDetailState {
  const [view, setView] = useState<UndertakingView | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(projectId && key))
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    if (!projectId || !key) {
      setView(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void getUndertakingOrch(projectId, key)
      .then(detail => {
        if (cancelled) return
        setView(detail)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, key, nonce])

  return { view, loading, error, reload }
}
