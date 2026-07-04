import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  isValidChainDigestDateBlock,
  type ProjectChainDigest,
} from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import {
  getProjectChainDigestBlock,
  putProjectChainDigestBlock,
} from '@/services/lego_blocks/integrations/aiActivityChainDigestStoreBlock'
import {
  chainDigestContract,
  prepareChainDigestInputBlock,
  type ChainDigestOutput,
} from '@/services/lego_blocks/units/intelligence/contracts/chainDigestContractBlock'
import { availability, runContract } from '@/services/orchestrators/intelligenceOrch'
import { intelligenceCacheAvailableBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'

// Public surface for per-chain digests. Wraps the intelligence contract with:
//   - the durable store (cache + vault) added earlier,
//   - graceful degradation when the intelligence subsystem is unavailable
//     (no persist; caller sees a fallback digest built from chain.topic),
//   - a deterministic isoDayLocal-of-startedIso for the date bucket, so the
//     chain lands in the same day the heatmap and trend chart show it in.

/** Read-only variant — never runs the model. Used when the caller just
 *  wants to know whether a digest exists (e.g. atom generator input
 *  assembly, timeline scrubbing). */
export async function loadChainDigestOrch(chain: ActivityChain): Promise<ProjectChainDigest | null> {
  const parts = chainStorageParts(chain)
  if (!parts) return null
  return getProjectChainDigestBlock(parts.projectId, parts.date, parts.chainKey)
}

/** Ensure a stored digest exists for `chain`. Returns:
 *   - the stored digest if input hash matches (fast path),
 *   - a regenerated digest if the chain grew or the model changed,
 *   - a fallback digest built from `chain.topic` when the intelligence
 *     subsystem is unavailable. The fallback is NOT persisted so a later
 *     boot with a provider configured generates the real thing. */
export async function ensureChainDigestOrch(
  chain: ActivityChain,
): Promise<{ digest: ProjectChainDigest; isAi: boolean } | null> {
  const parts = chainStorageParts(chain)
  if (!parts) return null
  const nextHash = computeChainInputHashBlock(chain)
  const existing = await getProjectChainDigestBlock(parts.projectId, parts.date, parts.chainKey)
  if (existing && existing.inputHash === nextHash) {
    return { digest: existing, isAi: true }
  }

  if (!intelligenceCacheAvailableBlock()) {
    return { digest: buildFallbackDigest(chain, parts, nextHash), isAi: false }
  }
  const av = await availability().catch(() => ({ available: false }))
  if (!av.available) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(chain, parts, nextHash), isAi: false }
  }

  await prepareChainDigestInputBlock(chain)
  const result = await runContract<ActivityChain, typeof chainDigestContract.outputSchema>(
    chainDigestContract,
    chain,
  )
  if (!result.ok || !result.value) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(chain, parts, nextHash), isAi: false }
  }

  const output = result.value as unknown as ChainDigestOutput
  const digest: ProjectChainDigest = {
    ...parts,
    title: output.title,
    summary: output.summary,
    source: String(chain.source),
    msgCount: chain.msgCount,
    durationMs: chainDurationMs(chain),
    startedIso: chain.startedIso,
    endedIso: chain.endedIso,
    inputHash: nextHash,
    generatedAt: new Date().toISOString(),
    model: (result.meta?.model as string) ?? 'unknown',
  }
  await putProjectChainDigestBlock(digest)
  return { digest, isAi: true }
}

// ── Internals ──────────────────────────────────────────────────────────

interface ChainStorageParts {
  projectId: string
  date: string
  chainKey: string
}

function chainStorageParts(chain: ActivityChain): ChainStorageParts | null {
  const date = isoDayLocalBlock(chain.startedIso)
  if (!date || !isValidChainDigestDateBlock(date)) return null
  if (!chain.project || !chain.key) return null
  return { projectId: chain.project, date, chainKey: chain.key }
}

function chainDurationMs(chain: ActivityChain): number {
  const start = Date.parse(chain.startedIso)
  const end = Date.parse(chain.endedIso ?? chain.startedIso)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return end - start
}

function isoDayLocalBlock(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildFallbackDigest(
  chain: ActivityChain,
  parts: ChainStorageParts,
  inputHash: string,
): ProjectChainDigest {
  return {
    ...parts,
    title: chain.topic || '(untitled)',
    summary: '',
    source: String(chain.source),
    msgCount: chain.msgCount,
    durationMs: chainDurationMs(chain),
    startedIso: chain.startedIso,
    endedIso: chain.endedIso,
    inputHash,
    generatedAt: new Date().toISOString(),
    model: 'fallback:chain-topic',
  }
}

/** Hash the inputs the digest depends on. Djb2 for speed; not crypto. */
function computeChainInputHashBlock(chain: ActivityChain): string {
  const material = [
    chain.key,
    String(chain.msgCount),
    chain.startedIso,
    chain.endedIso,
    chainDigestContract.id,
    String(chainDigestContract.promptVersion),
  ].join('\x00')
  let hash = 5381
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
