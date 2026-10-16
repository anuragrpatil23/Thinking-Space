import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { ensureChainDigestOrch } from '@/services/orchestrators/aiActivityChainDigestOrch'
import { isSettledBlock } from '@/services/lego_blocks/units/aiActivityLivenessBlock'
import { ensureRangeSummaryOrch } from '@/services/orchestrators/aiActivityRangeSummaryOrch'
import type { AiActivityRangeSummaryProvider } from '@/services/lego_blocks/units/storageKeyBlock'
import type { ProjectRangeSummary } from '@/services/lego_blocks/units/aiActivityRangeSummaryBlock'

// Load-or-generate the range summary for one project over one date range.
// Extracted from AiActivityRangeSummaryBlock (2026-10-16) so the This Week
// project rows can read the summary's themes for their collapsed line, not
// only render its body.

export interface UseProjectRangeSummaryArgs {
  projectId: string
  projectLabel?: string
  /** Inclusive local-date bounds of the range being summarized. */
  rangeStartDate: string
  rangeEndDate: string
  /** Chains in the range (already filtered by project). Order-agnostic. */
  chains: ActivityChain[]
}

export interface UseProjectRangeSummaryResult {
  summary: ProjectRangeSummary | null
  loading: boolean
  error: string | null
  run: (refresh: boolean, providerOverride?: AiActivityRangeSummaryProvider) => Promise<void>
}

function isoDayLocal(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function useProjectRangeSummaryBlock({
  projectId,
  projectLabel,
  rangeStartDate,
  rangeEndDate,
  chains,
}: UseProjectRangeSummaryArgs): UseProjectRangeSummaryResult {
  const [summary, setSummary] = useState<ProjectRangeSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputKey = useMemo(
    () =>
      `${projectId}|${rangeStartDate}|${rangeEndDate}|${chains
        .map(c => `${c.key}:${Date.parse(c.endedIso) - Date.parse(c.startedIso)}`)
        .sort()
        .join(',')}`,
    [projectId, rangeStartDate, rangeEndDate, chains],
  )

  const run = useCallback(
    async (refresh: boolean, providerOverride?: AiActivityRangeSummaryProvider) => {
      if (chains.length === 0) return
      setLoading(true)
      setError(null)
      try {
        // Digests first, and we wait for them.
        //
        // This used to be a read-only lookup with "missing digests never
        // block" — which meant that whenever digests were actually being
        // generated, the narration jumped the queue and summarised a range
        // from titles alone while the digests it needed waited behind it. The
        // cost of waiting is a slower first summary; the cost of not waiting
        // was a summary built from nothing.
        // Newest first, all the way through.
        //
        // The queue is FIFO, so enqueue order is run order: the digests worth
        // having soonest are for the days you were just working on, not six
        // months of backlog first. The model sees the same order, which is also
        // the order the summary reads in. Fingerprints sort their own input, so
        // reordering here cannot invalidate a cached summary.
        const byNewest = [...chains].sort(
          (a, b) => Date.parse(b.startedIso) - Date.parse(a.startedIso),
        )
        const enriched = await Promise.all(
          byNewest.map(async chain => {
            const digest = (await ensureChainDigestOrch(chain).catch(() => null))?.digest ?? null
            return {
              chainKey: chain.key,
              // Live chains are pinned out of the fingerprints, so the session
              // you are working in does not regenerate this summary on every
              // message.
              settled: isSettledBlock(chain.endedIso ?? chain.startedIso),
              date: isoDayLocal(chain.startedIso),
              startedIso: chain.startedIso,
              endedIso: chain.endedIso,
              title: digest?.title || chain.topic || '(untitled chain)',
              summary: digest?.summary ?? '',
              durationMs: Math.max(0, Date.parse(chain.endedIso) - Date.parse(chain.startedIso)),
              msgCount: chain.msgCount,
            }
          }),
        )
        const result = await ensureRangeSummaryOrch({
          projectId,
          projectLabel: projectLabel ?? projectId,
          rangeStartDate,
          rangeEndDate,
          chains: enriched,
          refresh,
          providerOverride,
        })
        setSummary(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [chains, projectId, projectLabel, rangeStartDate, rangeEndDate],
  )

  // Load-or-generate whenever the effective input changes.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        if (chains.length === 0) {
          if (!cancelled) setSummary(null)
          return
        }
        // Same rule as the manual path above: the digests the narration reads
        // are generated first, not raced.
        // Newest first, all the way through.
        //
        // The queue is FIFO, so enqueue order is run order: the digests worth
        // having soonest are for the days you were just working on, not six
        // months of backlog first. The model sees the same order, which is also
        // the order the summary reads in. Fingerprints sort their own input, so
        // reordering here cannot invalidate a cached summary.
        const byNewest = [...chains].sort(
          (a, b) => Date.parse(b.startedIso) - Date.parse(a.startedIso),
        )
        const enriched = await Promise.all(
          byNewest.map(async chain => {
            const digest = (await ensureChainDigestOrch(chain).catch(() => null))?.digest ?? null
            return {
              chainKey: chain.key,
              // Live chains are pinned out of the fingerprints, so the session
              // you are working in does not regenerate this summary on every
              // message.
              settled: isSettledBlock(chain.endedIso ?? chain.startedIso),
              date: isoDayLocal(chain.startedIso),
              startedIso: chain.startedIso,
              endedIso: chain.endedIso,
              title: digest?.title || chain.topic || '(untitled chain)',
              summary: digest?.summary ?? '',
              durationMs: Math.max(0, Date.parse(chain.endedIso) - Date.parse(chain.startedIso)),
              msgCount: chain.msgCount,
            }
          }),
        )
        const result = await ensureRangeSummaryOrch({
          projectId,
          projectLabel: projectLabel ?? projectId,
          rangeStartDate,
          rangeEndDate,
          chains: enriched,
        })
        if (!cancelled) setSummary(result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey])

  return { summary, loading, error, run }
}
