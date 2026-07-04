import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { ensureChainDigestOrch } from '@/services/orchestrators/aiActivityChainDigestOrch'

// Renderer-side wrapper around the chain-digest orchestrator. Renders the
// fallback (`chain.topic`) immediately so the UI never blocks on the model,
// then swaps to the real title/summary when the orchestrator resolves.

export interface ChainDigestState {
  title: string
  summary: string
  /** True once an AI-generated digest is in place; false while showing the
   *  raw-topic fallback or while a provider isn't configured. */
  isAi: boolean
  loading: boolean
}

export function useChainDigestBlock(chain: ActivityChain): ChainDigestState {
  const fallback = chain.topic
  const [title, setTitle] = useState<string>(fallback)
  const [summary, setSummary] = useState<string>('')
  const [isAi, setIsAi] = useState(false)
  const [loading, setLoading] = useState(false)
  const cancelledRef = useRef(false)
  const key = useMemo(() => chain.sessions[0]?.sessionId ?? chain.key, [chain])

  useEffect(() => {
    cancelledRef.current = false
    let alive = true
    setLoading(true)
    setTitle(fallback)
    setSummary('')
    setIsAi(false)

    void (async () => {
      const result = await ensureChainDigestOrch(chain).catch(() => null)
      if (!alive || cancelledRef.current || !result) {
        if (alive) setLoading(false)
        return
      }
      setTitle(result.digest.title || fallback)
      setSummary(result.digest.summary || '')
      setIsAi(result.isAi)
      setLoading(false)
    })()

    return () => {
      alive = false
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, chain.msgCount])

  return { title, summary, isAi, loading }
}
