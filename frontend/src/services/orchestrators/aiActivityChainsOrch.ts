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
  groupSessionDigestsBlock,
  sessionActiveDurationMsBlock,
  type ProjectSessionDigest,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import { listProjectSessionDigestsBlock } from '@/services/lego_blocks/integrations/aiActivitySessionDigestStoreBlock'

/**
 * The canonical chain derivation, and the organizer's chain read.
 *
 * ## Why the canonical derivation exists
 *
 * Sessions were once grouped into chains only inside a `useMemo` in
 * `useAiActivityBlock`, over the *filtered* session list — range preset plus
 * source filter. Derivation that varies with UI state has no single answer to
 * "what are this project's chains", which is why nothing could ever be checked
 * against it. `deriveCanonicalChainsOrch` is that single answer: every session,
 * no range filter, no source filter. A hook may keep a filtered *view* — that
 * is a legitimate lens — but anything joined or composed reads from here.
 *
 * ## What used to be here and is now gone
 *
 * This file also held `listProjectChainsOrch`, which read stored chain digests
 * off disk and then worked hard to figure out which live chain each one
 * belonged to: two-pass membership-overlap resolution, a `chainId` → chain map,
 * a field projection to overwrite the stale mechanical values, and a
 * fire-and-forget write to heal the copy. All of it existed because a chain
 * digest was a *file at a derived address*, so the record and the thing it
 * described could drift apart.
 *
 * There is no such file now. Chain-level content is composed on read from
 * session digests (`aiActivityChainDigestOrch`), and the grouping itself is
 * re-derived from those same records (`groupSessionDigestsBlock`). Nothing is
 * stored at a chain address, so nothing can be orphaned from one, so there is
 * nothing to resolve, project, or heal. The reconcile machinery did not get
 * simpler — it stopped being necessary.
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

/** A chain as the organizer sees it: its member digests plus the aggregates
 *  rolled up from them. Free to build — this read never spends a model call.
 *  For composed prose, callers go through `ensureChainDigestOrch`. */
export interface ProjectChainRollup {
  projectId: string
  /** Display handle, `project::<first session id>`. Stable for the life of a
   *  render and useful as a React key; never an address. */
  chainKey: string
  sessions: ProjectSessionDigest[]
  /** A free, deterministic label for the sitting: the member titles joined.
   *
   *  Deliberately NOT the composed chain digest — that may cost a model call,
   *  and an index that renders a hundred rows must not spend a hundred calls to
   *  draw itself. Callers that want the composed prose ask
   *  `ensureChainDigestOrch` for the one row the user actually opened. For the
   *  64% of sittings with a single member this string IS the session's title,
   *  so the common row is both free and exact. */
  title: string
  date: string
  startedIso: string
  endedIso: string
  durationMs: number
  activeDurationMs: number
  msgCount: number
  filesWritten: string[]
  filesRead: string[]
  undertaking: string[]
}

/**
 * The organizer's chain read: stored session digests, regrouped into chains.
 *
 * Works identically on every device. A phone with no access to `~/.claude` has
 * the same records as the desktop and runs the same grouping over them, so it
 * sees the same sittings — which is why no chain-shaped transport file needs to
 * exist. See `groupSessionDigestsBlock`.
 */
export async function listProjectChainsOrch(projectId: string): Promise<ProjectChainRollup[]> {
  const digests = await listProjectSessionDigestsBlock(projectId)
  if (digests.length === 0) return []
  return groupSessionDigestsBlock(digests).map(rollupBlock)
}

function rollupBlock(sessions: ProjectSessionDigest[]): ProjectChainRollup {
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  const written = new Set<string>()
  const read = new Set<string>()
  const undertaking = new Set<string>()
  let msgCount = 0
  let activeDurationMs = 0
  for (const d of sessions) {
    for (const f of d.filesWritten) written.add(f)
    for (const f of d.filesRead) read.add(f)
    for (const u of d.undertaking) undertaking.add(u)
    msgCount += d.msgCount
    activeDurationMs += sessionActiveDurationMsBlock(d)
  }
  const startMs = Date.parse(first.startedIso)
  const endMs = Date.parse(last.endedIso)
  return {
    projectId: first.projectId,
    chainKey: `${first.projectId}::${first.sessionId}`,
    sessions,
    // Deduped: a chain of sittings with one document open shares one title,
    // and repeating it once per sitting said nothing new each time.
    title: sessions
      .map(d => d.title)
      .filter(Boolean)
      .filter((t, i, all) => all.indexOf(t) === i)
      .join(' · '),
    date: first.date,
    startedIso: first.startedIso,
    endedIso: last.endedIso,
    durationMs:
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : 0,
    activeDurationMs,
    msgCount,
    filesWritten: Array.from(written).sort(),
    filesRead: Array.from(read).sort(),
    undertaking: Array.from(undertaking).sort(),
  }
}
