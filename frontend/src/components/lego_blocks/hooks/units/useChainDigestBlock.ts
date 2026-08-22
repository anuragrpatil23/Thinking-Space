import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { ensureChainDigestOrch } from '@/services/orchestrators/aiActivityChainDigestOrch'
import type { GenerationSource } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import type { HeavyWorkBlockReason } from '@/services/lego_blocks/integrations/powerStateBlock'

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
  /** Which family produced the shown digest — 'local' | 'claude' |
   *  'rule-based'; '' for legacy records with no recorded source. Drives the
   *  small source chip in the drill-down. */
  generator: GenerationSource | ''
  /** Why automatic generation was skipped, when it was: the machine is on
   *  battery or in Low Power Mode. Manual `refresh` ignores the gate, so this
   *  is the UI's cue to point at the regenerate button. */
  blocked: HeavyWorkBlockReason | null
  /** Force a regeneration with the currently-selected provider, bypassing the
   *  reuse/precedence fast path (e.g. to re-run local even when a Claude
   *  digest is cached). */
  refresh: () => void
}

export function useChainDigestBlock(chain: ActivityChain): ChainDigestState {
  const fallback = chain.topic
  const [title, setTitle] = useState<string>(fallback)
  const [summary, setSummary] = useState<string>('')
  const [isAi, setIsAi] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generator, setGenerator] = useState<GenerationSource | ''>('')
  const [blocked, setBlocked] = useState<HeavyWorkBlockReason | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const prevNonce = useRef(0)
  const cancelledRef = useRef(false)
  const key = useMemo(() => chain.sessions[0]?.sessionId ?? chain.key, [chain])

  const refresh = useCallback(() => setRefreshNonce(n => n + 1), [])

  useEffect(() => {
    cancelledRef.current = false
    let alive = true
    // A bump of `refreshNonce` (vs. a key/msgCount change) means the user hit
    // regenerate — only then do we bypass the reuse precedence.
    const isManualRefresh = refreshNonce !== prevNonce.current
    prevNonce.current = refreshNonce
    setLoading(true)
    setTitle(fallback)
    setSummary('')
    setIsAi(false)
    if (!isManualRefresh) setGenerator('')

    void (async () => {
      const result = await ensureChainDigestOrch(chain, { refresh: isManualRefresh }).catch(() => null)
      if (!alive || cancelledRef.current || !result) {
        if (alive) setLoading(false)
        return
      }
      setTitle(result.digest.title || fallback)
      setSummary(result.digest.summary || '')
      setIsAi(result.isAi)
      setGenerator(result.digest.generator)
      setBlocked(result.blocked ?? null)
      setLoading(false)
    })()

    return () => {
      alive = false
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, chain.msgCount, refreshNonce])

  return { title, summary, isAi, loading, generator, blocked, refresh }
}
