/**
 * Match derived chains to their stored digests.
 *
 * A chain's identity is its *sessions*. Its `key` is only the grouping rule's
 * opinion about which of them sorts first, and its `chainId` is a name minted
 * once and frozen. So when the grouping changes — a rule fix, an earlier
 * session discovered, two chains merging — the key moves while the record stays
 * where it was written. Matching on the key alone is what stranded 462 digests.
 *
 * The stored digests are their own index: each carries the session ids it was
 * built from, so no side table exists that could go stale. That is the whole
 * reason `sessions` is persisted (see `ProjectChainDigest`).
 *
 * Resolution is deliberately one-to-one. A digest holds a title and summary
 * that cost a provider call, so handing the same one to two chains would show
 * the same title twice and let one chain's write clobber the other's record.
 */

export interface ResolvableChain {
  /** `ActivityChain.key` — project + earliest session path. */
  key: string
  /** Member session ids, in chain order. */
  sessions: string[]
}

export interface ResolvableDigest {
  /** The minted, frozen address. */
  chainId: string
  /** Members recorded at last write. Absent on pre-v4 records. */
  sessions?: string[]
}

/**
 * Map each chain's `key` to the digest that belongs to it.
 *
 * Two passes, in this order and for this reason:
 *
 *  1. **Exact id.** A chain whose grouping has not changed still mints the id
 *     its record already has. This must win outright — it is both the common
 *     case and the only one that is certain, and it settles merges (two old
 *     chains becoming one) deterministically in favour of the surviving head.
 *
 *  2. **Greatest membership overlap**, for whatever is left. This is the case
 *     that used to orphan: the chain is the same work, but the key moved. Ties
 *     break on chain key then digest id purely so the result is stable across
 *     runs — an arbitrary but *fixed* answer beats a shifting one.
 *
 * A pre-v4 digest has no `sessions` and so can only ever be matched by pass 1.
 * That is correct: it is exactly the record whose id still equals its key.
 */
export function resolveChainDigestsBlock<C extends ResolvableChain, D extends ResolvableDigest>(
  chains: C[],
  stored: D[],
): Map<string, D> {
  const out = new Map<string, D>()
  if (chains.length === 0 || stored.length === 0) return out

  const claimedDigests = new Set<string>()
  const unmatchedChains: C[] = []

  // Pass 1 — exact id. `mintChainIdBlock` seeds a chain's id from its key, so
  // an unchanged chain lands here and never touches the overlap logic.
  const byId = new Map<string, D>()
  for (const digest of stored) {
    if (digest.chainId && !byId.has(digest.chainId)) byId.set(digest.chainId, digest)
  }
  for (const chain of chains) {
    const hit = byId.get(chain.key)
    if (hit && !claimedDigests.has(hit.chainId)) {
      out.set(chain.key, hit)
      claimedDigests.add(hit.chainId)
    } else {
      unmatchedChains.push(chain)
    }
  }
  if (unmatchedChains.length === 0) return out

  // Pass 2 — membership. Score every surviving pair, then assign greedily from
  // the strongest match down, so a chain that clearly owns a digest gets it
  // before a chain that merely brushes against it.
  interface Candidate {
    chainKey: string
    digest: D
    overlap: number
  }
  const candidates: Candidate[] = []
  for (const chain of unmatchedChains) {
    if (chain.sessions.length === 0) continue
    const members = new Set(chain.sessions)
    for (const digest of stored) {
      if (claimedDigests.has(digest.chainId)) continue
      if (!digest.sessions || digest.sessions.length === 0) continue
      let overlap = 0
      for (const id of digest.sessions) {
        if (members.has(id)) overlap += 1
      }
      if (overlap > 0) candidates.push({ chainKey: chain.key, digest, overlap })
    }
  }

  candidates.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      a.chainKey.localeCompare(b.chainKey) ||
      a.digest.chainId.localeCompare(b.digest.chainId),
  )

  for (const candidate of candidates) {
    if (out.has(candidate.chainKey)) continue
    if (claimedDigests.has(candidate.digest.chainId)) continue
    out.set(candidate.chainKey, candidate.digest)
    claimedDigests.add(candidate.digest.chainId)
  }

  return out
}
