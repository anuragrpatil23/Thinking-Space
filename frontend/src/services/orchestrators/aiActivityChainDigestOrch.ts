import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import type { ProjectSessionDigest } from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import { sessionActiveDurationMsBlock } from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import {
  ensureSessionDigestOrch,
  loadSessionDigestOrch,
} from '@/services/orchestrators/aiActivitySessionDigestOrch'
import {
  chainStitchContract,
  type ChainStitchContractInput,
  type ChainStitchOutput,
} from '@/services/lego_blocks/units/intelligence/contracts/chainStitchContractBlock'
import { availability, runContract } from '@/services/orchestrators/intelligenceOrch'
import { intelligenceCacheAvailableBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import {
  heavyBackgroundWorkAllowedBlock,
  type HeavyWorkBlockReason,
} from '@/services/lego_blocks/integrations/powerStateBlock'
import { getAiActivityAiTitlesEnabled } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  generationSourceForProviderBlock,
  generationSourceRankBlock,
  type GenerationSource,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

/**
 * Chain-level digests, DERIVED from session digests. Nothing here is stored at
 * a chain address, because a chain has no address it could safely own.
 *
 * The old version of this file wrote a record to
 * `ai-activity/chains/<project>/<chainId>.md` and then spent several hundred
 * lines defending that address: an id minted once and frozen, a persisted
 * membership list acting as its own index, two-pass overlap resolution to find
 * a record whose key had moved, a reconcile orchestrator, a legacy nested-path
 * fallback. Every one of those existed because `chainId` was seeded from an
 * output of `buildChains`, so re-grouping renamed the file and orphaned the
 * record.
 *
 * A chain digest is not a record. It is an *answer*, recomputable from the
 * session digests underneath it, and the only reason to keep a copy is to avoid
 * paying the model twice for the same answer. So it lives in the intelligence
 * cache under a key derived from its own content — the members' titles and
 * summaries. A content-addressed memo cannot be orphaned, only missed, and a
 * miss costs one cheap call over short text rather than a lost record.
 *
 * Two paths, and the cheap one is the common one:
 *
 *   1 member  → PASS-THROUGH. The chain's digest *is* the session's digest.
 *               No model call, no cache entry, nothing to invalidate. In a real
 *               vault this is 64% of chains (216 of 335 with recorded
 *               membership), so most of this layer costs nothing at all.
 *   N members → STITCH. One call over N short summaries.
 */

/** A chain's title/summary plus the aggregates every surface needs. Built on
 *  read; never serialized to a chain-shaped file. */
export interface ChainDigestView {
  projectId: string
  /** Display handle only — `project::first session path`. Fine to render, fine
   *  to use as a React key within one render, never an address. Which session
   *  sorts first is an output of the grouping rule and can change. */
  chainKey: string
  /** The members, earliest first. THE chain's identity, in the only form that
   *  cannot drift: a chain *is* its sessions. */
  sessions: ProjectSessionDigest[]
  date: string
  title: string
  summary: string
  source: string
  msgCount: number
  durationMs: number
  activeDurationMs: number
  startedIso: string
  endedIso: string
  /** Union of the members' writes — the index's page numbers. Per-session
   *  attribution is not flattened away; it is on each member, where a mixed
   *  chain stays visible instead of being silently believed. */
  filesWritten: string[]
  filesRead: string[]
  /** Union of the members' undertaking assignments. A chain "belongs to" every
   *  undertaking any of its sittings does — which is exactly how a mixed chain
   *  should read, rather than pretending the whole window was one topic. The
   *  authoritative per-sitting binding stays on each member. */
  undertaking: string[]
  /** True when the title/summary came from composing several sittings rather
   *  than passing one through. Surfaces in the UI so a stitched summary is
   *  never mistaken for a first-hand reading of the transcript. */
  stitched: boolean
  /** Which family produced the text — 'local' | 'claude' | 'rule-based'.
   *  On a pass-through this is the session digest's own generator; on a stitch
   *  it is whoever ran the stitch. Weakest-link on the unstitched fallback: a
   *  concatenation is only as good as its worst member. */
  generator: GenerationSource | ''
}

export interface ChainDigestResult {
  digest: ChainDigestView
  isAi: boolean
  /** Set when automatic generation was refused on power grounds. See the
   *  power gate in `aiActivitySessionDigestOrch`. */
  blocked?: HeavyWorkBlockReason
  /** At least one member session's stored digest no longer matches its input
   *  hash — the sitting's shape moved under it. True for the CHAIN when it is
   *  true for ANY member, because the chain's body is composed from all of
   *  them, so one stale member makes the whole composition stale.
   *
   *  Advisory only. Under the replacement rule an automatic run never rebuilds
   *  a digest, so this is the *only* thing that tells a human a record has
   *  drifted — which is exactly why it must not be raised loosely (see the
   *  `promptVersion` note in `sessionDigestContractBlock`). */
  stale?: boolean
}

/** Read-only: never runs the model. Returns null when no member has a stored
 *  digest yet, and a pass-through/concatenation when they do. */
export async function loadChainDigestOrch(chain: ActivityChain): Promise<ChainDigestView | null> {
  const digests: ProjectSessionDigest[] = []
  for (const session of chain.sessions) {
    const digest = await loadSessionDigestOrch(session)
    if (digest) digests.push(digest)
  }
  if (digests.length === 0) return null
  return composeWithoutModelBlock(chain, digests)
}

/**
 * Ensure a chain digest exists, generating whatever is missing beneath it.
 *
 * Note the order: session digests first, always. The chain layer can never be
 * fresher than what it composes, and asking for it is what pulls the base layer
 * into existence.
 */
export async function ensureChainDigestOrch(
  chain: ActivityChain,
  options: { refresh?: boolean } = {},
): Promise<ChainDigestResult | null> {
  const digests: ProjectSessionDigest[] = []
  let anyAi = false
  let stale = false
  let blocked: HeavyWorkBlockReason | undefined
  for (const session of chain.sessions) {
    const result = await ensureSessionDigestOrch(session, options)
    if (!result) continue
    digests.push(result.digest)
    if (result.isAi) anyAi = true
    // Any stale member makes the composition stale — the chain body is built
    // from every member, so one drifted section is enough to misdescribe it.
    if (result.stale) stale = true
    // First refusal wins — every member is refused for the same reason anyway,
    // since the gate reads one machine's power state.
    if (result.blocked && !blocked) blocked = result.blocked
  }
  if (digests.length === 0) return null

  // PASS-THROUGH. One sitting: the chain and the session are the same thing, so
  // composing would be paying a model to rewrite a summary into itself.
  if (digests.length === 1) {
    return { digest: composeWithoutModelBlock(chain, digests), isAi: anyAi, blocked, stale }
  }

  const base = composeWithoutModelBlock(chain, digests)
  if (!intelligenceCacheAvailableBlock() || !getAiActivityAiTitlesEnabled())
    return { digest: base, isAi: false, stale }
  // The stitch is another model call, so it answers to the same power gate as
  // the digests beneath it. Degrading to the concatenation here is the same
  // honest fallback a failed stitch already takes.
  if (!options.refresh) {
    const power = await heavyBackgroundWorkAllowedBlock()
    if (!power.allowed) return { digest: base, isAi: anyAi, blocked: blocked ?? power.reason, stale }
  }
  const av = await availability().catch(() => ({ available: false }))
  if (!av.available) return { digest: base, isAi: false, stale }

  const input = stitchInputBlock(chain, digests)
  const result = await runContract<ChainStitchContractInput, typeof chainStitchContract.outputSchema>(
    chainStitchContract,
    input,
    { scope: 'ai_activity' },
  )
  // A failed stitch degrades to the concatenation, which is honest rather than
  // lesser: it is exactly the member summaries, unmerged and unembellished.
  if (!result.ok || !result.value) return { digest: base, isAi: anyAi, blocked, stale }

  const output = result.value as unknown as ChainStitchOutput
  return {
    digest: {
      ...base,
      title: output.title,
      summary: output.summary,
      stitched: true,
      generator: generationSourceForProviderBlock(result.providerId),
    },
    isAi: true,
    blocked,
    stale,
  }
}

// ── Internals ──────────────────────────────────────────────────────────

function formatWhenBlock(digest: ProjectSessionDigest): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '?'
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return `${fmt(digest.startedIso)}–${fmt(digest.endedIso)}`
}

function stitchInputBlock(
  chain: ActivityChain,
  digests: ProjectSessionDigest[],
): ChainStitchContractInput {
  return {
    projectLabel: chain.project,
    sessions: digests.map(d => ({
      when: formatWhenBlock(d),
      title: d.title,
      summary: d.summary,
    })),
  }
}

/**
 * Build the chain view from its members without spending a model call.
 *
 * For one member this is the final answer — the pass-through. For several it is
 * the honest fallback the stitch improves on: the member summaries kept whole
 * and labelled by sitting. Deliberately NOT a blended paraphrase; anything that
 * reads as one narrative should have come from the model that was told not to
 * invent connections between sittings.
 */
function composeWithoutModelBlock(
  chain: ActivityChain,
  digests: ProjectSessionDigest[],
): ChainDigestView {
  const ordered = [...digests].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )
  const first = ordered[0]
  const last = ordered[ordered.length - 1]

  const written = new Set<string>()
  const read = new Set<string>()
  const undertaking = new Set<string>()
  let msgCount = 0
  let activeDurationMs = 0
  for (const d of ordered) {
    for (const f of d.filesWritten) written.add(f)
    for (const f of d.filesRead) read.add(f)
    for (const u of d.undertaking) undertaking.add(u)
    msgCount += d.msgCount
    activeDurationMs += sessionActiveDurationMsBlock(d)
  }

  const single = ordered.length === 1
  const summary = single
    ? first.summary
    : ordered.map(d => `**${formatWhenBlock(d)} — ${d.title}**\n\n${d.summary}`).join('\n\n')

  // Several sittings with the same document open share one title, and joining
  // them produced that title repeated once per sitting. The chain is still
  // *about* one thing; say it once. Order-preserving so a genuinely mixed
  // chain still reads as the sequence it was.
  const titles = ordered.map(d => d.title).filter(Boolean)
  const uniqueTitles = titles.filter((t, i) => titles.indexOf(t) === i)

  const startMs = Date.parse(first.startedIso)
  const endMs = Date.parse(last.endedIso)

  return {
    projectId: first.projectId,
    chainKey: chain.key,
    sessions: ordered,
    date: first.date,
    title: single ? first.title : uniqueTitles.join(' · '),
    summary,
    source: first.source,
    msgCount,
    durationMs: Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : 0,
    activeDurationMs,
    startedIso: first.startedIso,
    endedIso: last.endedIso,
    filesWritten: Array.from(written).sort(),
    filesRead: Array.from(read).sort(),
    undertaking: Array.from(undertaking).sort(),
    stitched: false,
    // Weakest link, not first member: an unstitched chain view is a
    // concatenation, so it is only as trustworthy as its least-well-generated
    // part. Reporting the best member's generator would overstate the whole.
    generator: ordered.reduce<GenerationSource | ''>(
      (worst, d) =>
        generationSourceRankBlock(d.generator) < generationSourceRankBlock(worst) ? d.generator : worst,
      ordered[0].generator,
    ),
  }
}
