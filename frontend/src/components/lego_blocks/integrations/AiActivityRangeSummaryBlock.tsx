import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Loader2, Sparkles } from 'lucide-react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { loadChainDigestOrch } from '@/services/orchestrators/aiActivityChainDigestOrch'
import { ensureRangeSummaryOrch } from '@/services/orchestrators/aiActivityRangeSummaryOrch'
import type { AiActivityRangeSummaryProvider } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  rangeSummaryProviderToGenerationSourceBlock,
  type ProjectRangeSummary,
} from '@/services/lego_blocks/units/aiActivityRangeSummaryBlock'
import LightMarkdownTextBlock from '@/components/lego_blocks/units/LightMarkdownTextBlock'
import AiActivitySourceChipBlock from '@/components/lego_blocks/units/AiActivitySourceChipBlock'

interface Props {
  projectId: string
  projectLabel?: string
  /** Inclusive local-date bounds of the range being summarized. */
  rangeStartDate: string
  rangeEndDate: string
  /** Chains in the range (already filtered by project). Order-agnostic. */
  chains: ActivityChain[]
  /** When true, render without the outer card wrapper — the summary body
   *  becomes an inline block that a parent (e.g. the This Week card, where
   *  each project already has its own row header) can slot in place of a
   *  topics list. The provider badge and refresh button move inline. */
  compact?: boolean
}

function isoDayLocal(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function AiActivityRangeSummaryBlock({
  projectId,
  projectLabel,
  rangeStartDate,
  rangeEndDate,
  chains,
  compact = false,
}: Props) {
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
        // Best-effort digest lookup — chains without a stored digest still
        // get summarized using their raw topic as the title. Reads are cache-
        // first so this is cheap; missing digests never block.
        const enriched = await Promise.all(
          chains.map(async chain => {
            const digest = await loadChainDigestOrch(chain).catch(() => null)
            return {
              chainKey: chain.key,
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
        const enriched = await Promise.all(
          chains.map(async chain => {
            const digest = await loadChainDigestOrch(chain).catch(() => null)
            return {
              chainKey: chain.key,
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

  if (chains.length === 0) return null

  if (compact) {
    // Inline shape — no card frame, no heading, no per-project badge. The
    // parent (e.g. ThisWeekDigestBlock) shows a single provider badge at
    // section level because every project in a section uses the same
    // setting anyway; repeating the badge per row is noise. Just the body.
    return (
      <div>
        {error && (
          <p className="text-[11px] text-destructive">Summary failed: {error}</p>
        )}
        {!error && loading && !summary && (
          <p className="text-[11px] text-muted-foreground">Generating…</p>
        )}
        {!error && summary && (
          <LightMarkdownTextBlock
            text={summary.body}
            className="text-[11px] leading-relaxed text-muted-foreground"
          />
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="mb-2 flex items-start gap-2">
        {/* Heading on its own line so the chip sits UNDER it (smaller, quieter);
            refresh button stays top-right, keyed off the header row height. */}
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-foreground">Range summary</h4>
          {summary && (
            <AiActivitySourceChipBlock
              generator={rangeSummaryProviderToGenerationSourceBlock(summary.provider)}
              className="block"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Spend Claude on this one summary without changing the global
              provider — the "sharpen this specific thing" path. Shown only when
              the stored body isn't already Claude-tier, so it reads as an
              upgrade rather than a redundant re-run. */}
          {summary && summary.provider !== 'claude-cli' && (
            <button
              type="button"
              onClick={() => void run(true, 'claude-cli')}
              disabled={loading || chains.length === 0}
              className="rounded-full border border-border/40 bg-card/50 p-1 text-muted-foreground hover:border-border/70 hover:text-foreground disabled:opacity-40"
              title="Regenerate with Claude"
              aria-label="Regenerate range summary with Claude"
            >
              <Sparkles className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={loading || chains.length === 0}
            className="rounded-full border border-border/40 bg-card/50 p-1 text-muted-foreground hover:border-border/70 hover:text-foreground disabled:opacity-40"
            title="Regenerate"
            aria-label="Regenerate range summary"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-destructive">Range summary failed: {error}</p>
      )}
      {!error && loading && !summary && (
        <p className="text-xs text-muted-foreground">Generating summary…</p>
      )}
      {!error && summary && (
        <LightMarkdownTextBlock
          text={summary.body}
          className="text-[11px] leading-relaxed text-muted-foreground"
        />
      )}
    </div>
  )
}
