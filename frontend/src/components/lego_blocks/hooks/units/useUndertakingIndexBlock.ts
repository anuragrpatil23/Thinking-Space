import { useCallback, useEffect, useState } from 'react'
import {
  getUndertakingIndexOrch,
  type UndertakingIndex,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Loads the Thinking Organizer index for a project. Thin: all grouping and
// bucketing lives in the orch (getUndertakingIndexOrch) so the CLI and the tab
// derive identical data. This hook only owns load state and cancellation.

export interface UndertakingIndexState {
  index: UndertakingIndex | null
  loading: boolean
  error: string | null
  /** Re-derive the index — call after a section or undertaking edit. */
  reload: () => void
}

const EMPTY: UndertakingIndex = { sections: [], taskSections: [], windowStart: '', windowEnd: '' }

export function useUndertakingIndexBlock(projectId: string | null): UndertakingIndexState {
  const [state, setState] = useState<Omit<UndertakingIndexState, 'reload'>>({
    index: null,
    loading: Boolean(projectId),
    error: null,
  })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    if (!projectId) {
      setState({ index: EMPTY, loading: false, error: null })
      return
    }
    let cancelled = false
    setState({ index: null, loading: true, error: null })
    void getUndertakingIndexOrch(projectId)
      .then(index => {
        if (!cancelled) setState({ index, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            index: EMPTY,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, nonce])

  return { ...state, reload }
}
