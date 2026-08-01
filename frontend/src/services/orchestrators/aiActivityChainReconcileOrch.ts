import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import { resolveCanonicalProjectBlock } from '@/services/lego_blocks/units/aiActivityMappingBlock'
import {
  buildChains,
  inheritUnknownSessions,
  type ActivityChain,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  chainSessionIdsBlock,
  projectChainFieldsBlock,
  refreshStoredChainFieldsOrch,
} from '@/services/orchestrators/aiActivityChainDigestOrch'
import { resolveChainDigestsBlock } from '@/services/lego_blocks/units/aiActivityChainResolveBlock'
import {
  listChainsBlock,
  type ChainEntry,
} from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'

/**
 * The canonical chain derivation, and the read that joins stored digests to it.
 *
 * ## Why this exists
 *
 * Until now the only place sessions were grouped into chains was a `useMemo` in
 * `useAiActivityBlock`, over the *filtered* session list — range preset plus
 * source filter. Chain identity is `project::firstSessionPath`, so a chain whose
 * head session fell outside the visible window got a different key, and any
 * digest written under it landed at a different filename. Derivation that varies
 * with UI state has no single answer to "what are this project's chains", which
 * is why nothing could be checked against it.
 *
 * `deriveCanonicalChainsOrch` is that single answer: every session, no range
 * filter, no source filter. The hook may keep its filtered view for display —
 * that is a legitimate lens — but anything persisted or joined reads from here.
 */

let inflight: Promise<ActivityChain[]> | null = null

/** Build every project's chains from every known session. Deliberately
 *  unfiltered — see the note above. Coalesced, because a single organizer
 *  render asks for this once per project. */
export async function deriveCanonicalChainsOrch(): Promise<ActivityChain[]> {
  if (inflight) return inflight
  inflight = (async () => {
    const fs = getVaultFS()
    // Registry first, so the canonical-project resolution below reads a warm
    // cache and folder variants collapse to one project rather than several.
    await loadProjectRegistryBlock().catch(() => undefined)
    const { sessions } = await loadAiActivity(fs)
    const enriched = inheritUnknownSessions(sessions)
    const mapped = enriched.map(s => {
      const canonical = resolveCanonicalProjectBlock(s.project, s.path, s.cwd)
      return canonical === s.project ? s : { ...s, project: canonical }
    })
    return buildChains(mapped)
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/**
 * The organizer's chain read: stored digests, with their mechanical fields taken
 * from the live chain wherever one exists.
 *
 * This is the whole fix for the reported bug. `listChainsBlock` parses digest
 * files off disk, so the undertaking drawer used to render whatever was frozen
 * at first write — for 462 of 469 records, no file pointers at all, even though
 * the provenance was in the cache. Joining against the derived chain means the
 * drawer shows what the chain actually did, and a stale file on disk becomes
 * unobservable rather than something to migrate.
 *
 * A digest with no matching chain keeps its stored values untouched: on a device
 * that cannot derive chains, *every* digest is in that position, and the stored
 * copy is exactly the transport that case is for.
 */
export async function listProjectChainsOrch(projectId: string): Promise<ChainEntry[]> {
  const stored = await listChainsBlock({ projectId })
  if (stored.length === 0) return stored

  let chains: ActivityChain[]
  try {
    chains = (await deriveCanonicalChainsOrch()).filter(c => c.project === projectId)
  } catch {
    // Deriving is an enhancement over the stored copy, never a precondition for
    // reading it. A vault or cache failure degrades to the transport values.
    return stored
  }

  // Match on membership, not on the key. The key is what the grouping rule
  // currently thinks; the record was written under whatever it thought before.
  const resolved = resolveChainDigestsBlock(
    chains.map(c => ({ key: c.key, sessions: chainSessionIdsBlock(c) })),
    stored,
  )
  const chainForDigest = new Map<string, ActivityChain>()
  for (const chain of chains) {
    const digest = resolved.get(chain.key)
    if (digest) chainForDigest.set(digest.chainId, chain)
  }

  return stored.map(entry => {
    const chain = chainForDigest.get(entry.chainId)
    if (!chain) return entry
    // Fire-and-forget: keep the on-disk copy current for devices that cannot
    // derive, without making this read wait on a write.
    void refreshStoredChainFieldsOrch(entry, chain)
    return { ...projectChainFieldsBlock(entry, chain), path: entry.path }
  })
}
