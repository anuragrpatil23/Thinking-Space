import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { sessionIdOf } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
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
  return getProjectChainDigestBlock(parts.projectId, parts.chainId, {
    date: parts.date,
    chainKey: parts.chainKey,
  })
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
  const loaded = await getProjectChainDigestBlock(parts.projectId, parts.chainId, {
    date: parts.date,
    chainKey: parts.chainKey,
  })
  // Mechanical fields come from the chain in hand, not from disk. The stored
  // copy is refreshed as a side effect so other devices benefit, but the value
  // returned here never depends on that write landing.
  const existing = loaded ? await refreshStoredChainFieldsOrch(loaded, chain) : null
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
    activeDurationMs: chain.activeDurationMs ?? 0,
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
  chainId: string
  sessions: string[]
  date: string
  chainKey: string
}

/** The chain's member session ids — its real identity. A chain *is* its
 *  sessions; everything else about it is a label. */
export function chainSessionIdsBlock(chain: ActivityChain): string[] {
  if (!Array.isArray(chain.sessions)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of chain.sessions) {
    const id = sessionIdOf(s)
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/**
 * Mint an id for a chain that has no stored digest yet.
 *
 * Deliberately *minted*, not derived: written once, and every later read finds
 * the record by it. It starts life equal to `chain.key` — but only as a seed.
 * Nothing recomputes it afterwards, so when the grouping later decides a
 * different session sorts first, `chain.key` moves and `chainId` does not.
 * That divergence is the entire point.
 *
 * Seeding from `chain.key` rather than the head session id is load-bearing for
 * existing vaults: every pre-v4 digest's `chainId` *is* its `chainKey` (that is
 * what its filename encoded), so a chain whose grouping has not changed finds
 * its record on the first lookup and never regenerates. Seeding from the
 * session id instead would have missed all 469 of them and re-run the model on
 * every one.
 */
export function mintChainIdBlock(chain: ActivityChain): string {
  return chain.key
}

function chainStorageParts(chain: ActivityChain, chainId?: string): ChainStorageParts | null {
  const date = isoDayLocalBlock(chain.startedIso)
  if (!date || !isValidChainDigestDateBlock(date)) return null
  if (!chain.project || !chain.key) return null
  return {
    projectId: chain.project,
    chainId: chainId || mintChainIdBlock(chain),
    sessions: chainSessionIdsBlock(chain),
    date,
    chainKey: chain.key,
  }
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
  undertaking: string[]
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
    undertaking: [],
  }
}

// Tolerates undefined on either side: these compare records deserialized from
// disk, and a digest written by a build that predates a field simply has no key
// there. Treating that as an empty set is the same "absence is not a value"
// rule the projection follows.
function sameStringSetBlock(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every(v => set.has(v))
}

/**
 * Project a chain's mechanical fields onto a stored digest.
 *
 * This replaces the reconcile/heal machinery that used to live here, and the
 * question it existed to answer. Mechanical fields (pointers, active duration,
 * the chain window) are pure functions of the chain, so a reader holding a
 * chain simply recomputes them — there is no "has the stored copy drifted?" to
 * ask, hence no freshness hash over them, no schema version, and nothing to
 * migrate. The stored values are transport for devices that cannot derive
 * chains at all, not a cache to be kept in step.
 *
 * That is the same rule the layer above already follows: an undertaking's tail
 * is recomputed on every read and never stored, precisely so it cannot go stale
 * (see `aiActivityChainIndexBlock`). The digest broke it, and the cost was 462
 * of 469 records frozen at their first write, 5 carrying pointers, while 397
 * sessions had correct provenance sitting in the cache the whole time.
 *
 * Model-derived (`title`, `summary`) and human (`undertaking`) fields are never
 * touched — those are the ones that genuinely cannot be recomputed.
 *
 * Absence is not zero. A device with no IPC to `~/.claude` parses native chains
 * with no `touchedPaths` and no per-message timing; overwriting good values
 * synced from Electron because *this* device is blind would be the one
 * destructive move available here. No value in hand → keep what is stored.
 */
export function projectChainFieldsBlock(
  stored: ProjectChainDigest,
  chain: ActivityChain,
): ProjectChainDigest {
  const next = { ...stored }

  if (chain.touchedPaths && chain.touchedPaths.length > 0) {
    const { filesWritten, filesRead } = chainPointers(chain)
    next.filesWritten = filesWritten
    if (filesRead.length > 0) next.filesRead = filesRead
  }
  // `Number.isFinite`, not `typeof === 'number'`: NaN is a number, and a NaN
  // sum from one malformed session would be written over a good stored value.
  // Same no-stomp rule as absent pointers.
  const active = chain.activeDurationMs
  if (typeof active === 'number' && Number.isFinite(active)) next.activeDurationMs = active
  if (chain.startedIso) next.startedIso = chain.startedIso
  if (chain.endedIso ?? chain.startedIso) next.endedIso = chain.endedIso ?? chain.startedIso
  if (typeof chain.msgCount === 'number' && Number.isFinite(chain.msgCount)) {
    next.msgCount = chain.msgCount
  }
  const duration = chainDurationMs(chain)
  if (duration > 0) next.durationMs = duration
  // Membership last. Empty means this device could not see the chain's
  // sessions, not that the chain has none — same no-stomp rule as pointers.
  const sessions = chainSessionIdsBlock(chain)
  if (sessions.length > 0) next.sessions = sessions
  // `chainKey` is a display handle that tracks the current grouping. `chainId`
  // is the address and is never reassigned here — that is what makes it an id.
  if (chain.key) next.chainKey = chain.key
  const date = isoDayLocalBlock(chain.startedIso)
  if (date && isValidChainDigestDateBlock(date)) next.date = date

  return next
}

/** True when the projection would change what is on disk — the only reason to
 *  spend a write. Compared field-by-field rather than by deep-equal so the
 *  model-derived and human fields are provably excluded from the check. */
export function chainFieldsDifferBlock(a: ProjectChainDigest, b: ProjectChainDigest): boolean {
  return (
    !sameStringSetBlock(a.filesWritten, b.filesWritten) ||
    !sameStringSetBlock(a.filesRead, b.filesRead) ||
    !sameStringSetBlock(a.sessions, b.sessions) ||
    a.chainKey !== b.chainKey ||
    a.date !== b.date ||
    a.activeDurationMs !== b.activeDurationMs ||
    a.startedIso !== b.startedIso ||
    a.endedIso !== b.endedIso ||
    a.msgCount !== b.msgCount ||
    a.durationMs !== b.durationMs
  )
}

/**
 * Refresh the transport copy on disk when the derived truth has moved.
 *
 * Not a heal — the reader already has the right values from
 * `projectChainFieldsBlock` and does not depend on this succeeding. The write
 * exists solely so a phone that cannot derive chains sees current data after
 * the vault syncs. Best-effort by construction.
 */
export async function refreshStoredChainFieldsOrch(
  stored: ProjectChainDigest,
  chain: ActivityChain,
): Promise<ProjectChainDigest> {
  const projected = projectChainFieldsBlock(stored, chain)
  if (!chainFieldsDifferBlock(stored, projected)) return stored
  await putProjectChainDigestBlock(projected).catch(() => undefined)
  return projected
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
    activeDurationMs: chain.activeDurationMs ?? 0,
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
  // Deliberately NOT chain.key: the key is the grouping rule's opinion about
  // which session sorts first. Including it meant a re-grouping invalidated the
  // hash and bought a fresh provider call for a conversation whose content had
  // not changed by one byte. Hash the model's inputs, nothing else.
  const material = [
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
