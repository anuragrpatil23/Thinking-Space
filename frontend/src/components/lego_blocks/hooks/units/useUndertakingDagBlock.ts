import { useEffect, useState } from 'react'
import {
  getUndertakingDagOrch,
  type UndertakingDag,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

export interface UndertakingDagState {
  dag: UndertakingDag | null
  loading: boolean
  error: string | null
}

const EMPTY: UndertakingDag = {
  layout: { nodes: [], edges: [], layerCount: 0 },
  isolatedCount: 0,
}

export function useUndertakingDagBlock(projectId: string | null): UndertakingDagState {
  const [state, setState] = useState<UndertakingDagState>({
    dag: null,
    loading: Boolean(projectId),
    error: null,
  })

  useEffect(() => {
    if (!projectId) {
      setState({ dag: EMPTY, loading: false, error: null })
      return
    }
    let cancelled = false
    setState({ dag: null, loading: true, error: null })
    void getUndertakingDagOrch(projectId)
      .then(dag => {
        if (!cancelled) setState({ dag, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            dag: EMPTY,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return state
}
