// Resolve a chain's display title. Delegates to the intelligence orchestrator
// for generation + caching; the hook is a thin renderer-side wrapper that
// tracks loading/available state and falls back to chain.topic on any error.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  prepareSessionTitleInput,
  sessionTitleContract,
  type SessionTitleOutput,
} from '@/services/lego_blocks/units/intelligence/contracts/sessionTitleContractBlock'
import { availability, runContract } from '@/services/orchestrators/intelligenceOrch'
import { intelligenceCacheAvailableBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'

export interface ChainTitleState {
  display: string
  isAi: boolean
  loading: boolean
}

export function useChainTitleBlock(chain: ActivityChain): ChainTitleState {
  const fallback = chain.topic
  const [aiTitle, setAiTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const cancelledRef = useRef(false)
  const key = useMemo(() => chain.sessions[0]?.sessionId ?? null, [chain])

  useEffect(() => {
    cancelledRef.current = false
    setAiTitle(null)
    if (!key) return
    if (!intelligenceCacheAvailableBlock()) return

    let alive = true
    void (async () => {
      // Cheap availability check up front — no point preparing the prompt if
      // no provider is configured. Cache read happens inside runContract, so
      // we still get the fast path when a title is already cached.
      const av = await availability().catch(() => ({ available: false, defaultModel: null, details: {} }))
      if (!alive) return
      if (!av.available) return

      await prepareSessionTitleInput(chain)
      if (!alive) return
      setLoading(true)
      const result = await runContract<ActivityChain, typeof sessionTitleContract.outputSchema>(
        sessionTitleContract,
        chain,
      )
      if (!alive || cancelledRef.current) return
      if (result.ok) {
        setAiTitle((result.value as unknown as SessionTitleOutput).title)
      }
      setLoading(false)
    })()

    return () => {
      alive = false
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, chain.msgCount])

  return { display: aiTitle || fallback, isAi: !!aiTitle, loading }
}
