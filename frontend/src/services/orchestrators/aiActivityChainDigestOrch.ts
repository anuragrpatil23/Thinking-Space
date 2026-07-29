import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
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
import { currentGenerationSourceBlock } from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import {
  generationSourceForProviderBlock,
  generationSourceRankBlock,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import { getAiActivityAiTitlesEnabled } from '@/services/lego_blocks/units/storageKeyBlock'

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
  options: { refresh?: boolean } = {},
): Promise<{ digest: ProjectChainDigest; isAi: boolean } | null> {
  const parts = chainStorageParts(chain)
  if (!parts) return null
  const nextHash = computeChainInputHashBlock(chain)
  const loaded = await getProjectChainDigestBlock(parts.projectId, parts.date, parts.chainKey)
  // Reconcile mechanically-derived pointers before any branch returns `existing`
  // — they live outside the model-freshness hash on purpose (see the helper).
  const existing = loaded ? await reconcileDigestPointersBlock(loaded, chain) : null
  // Fast path with tier precedence: reuse the stored digest when it's fresh AND
  // at least as good as what the current selection would produce. So a Claude
  // digest survives a switch to local (we never downgrade a better body we
  // already have); switching *up* to Claude falls through and regenerates. The
  // target tier drops to rule-based (0) when AI titles are off or the cache
  // isn't available, so any stored AI digest is preferred over the deterministic
  // fallback. Optimistic: we don't probe live availability here — if a fall-
  // through regeneration can't run, the branches below return `existing`.
  // `refresh` (explicit "regenerate" action) bypasses reuse entirely so the
  // user can force the currently-selected provider to run, even a downgrade.
  const currentSource = currentGenerationSourceBlock()
  const aiActive = getAiActivityAiTitlesEnabled() && intelligenceCacheAvailableBlock()
  const targetRank = aiActive ? generationSourceRankBlock(currentSource) : 0
  if (
    !options.refresh &&
    existing &&
    existing.inputHash === nextHash &&
    generationSourceRankBlock(existing.generator) >= targetRank
  ) {
    return { digest: existing, isAi: true }
  }

  if (!intelligenceCacheAvailableBlock()) {
    return { digest: buildFallbackDigest(chain, parts, nextHash), isAi: false }
  }
  // User-controlled kill switch — orthogonal to provider availability.
  // Off: never call the model, use the deterministic fallback (existing stored
  // digests still surface via the `existing` branch above).
  if (!getAiActivityAiTitlesEnabled()) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(chain, parts, nextHash), isAi: false }
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
    generator: generationSourceForProviderBlock(result.providerId),
    ...chainPointers(chain),
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

/**
 * Carry the chain's file-edit provenance into the stored digest.
 *
 * The organizer's dry run concluded "chains carry no structured file
 * references." That was true of the stored chains and false of the pipeline:
 * `nativeAiSessionParserBlock` has been pulling absolute paths out of
 * Edit/Write/MultiEdit/NotebookEdit tool calls all along, and the digest simply
 * dropped them on the way to disk. Since an index entry without pointers is a
 * memoir, this is the one field that most needed persisting.
 *
 * Paths are stored vault-relative where possible so a pointer survives a move
 * to another machine; anything outside the vault stays absolute rather than
 * being guessed at.
 */
function chainPointers(chain: ActivityChain): {
  filesWritten: string[]
  filesRead: string[]
  undertaking: string
} {
  const vaultRoot = (getStoredVaultRoot() ?? '').replace(/\/+$/, '')
  const written = (chain.touchedPaths ?? []).map(path =>
    vaultRoot && path.startsWith(`${vaultRoot}/`) ? path.slice(vaultRoot.length + 1) : path,
  )
  return {
    filesWritten: Array.from(new Set(written)).sort(),
    // Reads aren't captured by the native parser — it only tracks mutating
    // tools. Left empty rather than inferred from prose.
    filesRead: [],
    // Filled by the end-of-session ask, not here. The digest is generated
    // after the ask, but assignment lands on the chain via its own path.
    undertaking: '',
  }
}

function sameStringSetBlock(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every(v => set.has(v))
}

/**
 * Keep a stored digest's mechanically-derived pointers in sync with the chain,
 * without touching the model-derived fields.
 *
 * `filesWritten` / `filesRead` come from the transcript's structured tool calls,
 * not the model, so they must not sit behind the model-freshness hash. A digest
 * written before pointer extraction existed matches its own `inputHash` forever
 * (the hash never covered pointers), so the fast path in `ensureChainDigestOrch`
 * kept handing back empty pointers — 460 real digests frozen as memoirs. Re-derive
 * on read and patch on drift; no model call, title/summary untouched.
 *
 * Two guards make this safe rather than destructive:
 *   - Only when the chain actually carries provenance. On iPhone/web there is no
 *     IPC to read `~/.claude`, so native chains come back with no `touchedPaths`;
 *     replacing good pointers (written by Electron, synced via the vault) with an
 *     empty list because *this* device is blind would be the stomp. No provenance
 *     in hand → leave the stored digest alone.
 *   - Only write on real drift, so the common no-op read stays read-only.
 */
async function reconcileDigestPointersBlock(
  existing: ProjectChainDigest,
  chain: ActivityChain,
): Promise<ProjectChainDigest> {
  if (!chain.touchedPaths || chain.touchedPaths.length === 0) return existing
  const derived = chainPointers(chain)
  if (sameStringSetBlock(existing.filesWritten, derived.filesWritten)) return existing
  const patched: ProjectChainDigest = { ...existing, filesWritten: derived.filesWritten }
  await putProjectChainDigestBlock(patched)
  return patched
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
    ...chainPointers(chain),
    // Rule-based fallback — deterministic, no model. Tagged so it's never
    // mistaken for AI output and never persisted (see ensureChainDigestOrch:
    // buildFallbackDigest results skip putProjectChainDigestBlock).
    generator: 'rule-based',
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
