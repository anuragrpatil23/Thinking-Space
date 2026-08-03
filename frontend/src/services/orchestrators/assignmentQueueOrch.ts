import {
  listChainProjectsBlock,
  listChainsBlock,
  patchChainBlock,
  type ChainEntry,
} from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'
import {
  getUndertakingBlock,
  listUndertakingsBlock,
  writeUndertakingBlock,
} from '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
import {
  undertakingKeyFromTitleBlock,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import { listSectionsBlock } from '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
import { chainActiveDurationMsBlock } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import { undisposedChainsBlock } from '@/services/lego_blocks/units/assignmentSweepBlock'
import {
  buildQueueGroupsBlock,
  latestProposalsBlock,
  targetLabelBlock,
  type AssignmentProposalBlock,
  type ProposalTargetBlock,
  type QueueGroupBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'
import {
  calibrateBandsBlock,
  type AssignmentVerdictBlock,
  type BandCalibrationBlock,
  type VerdictKindBlock,
} from '@/services/lego_blocks/units/assignmentVerdictBlock'
import {
  appendProposalsBlock,
  appendVerdictsBlock,
  readAllVerdictsBlock,
  readProposalsBlock,
} from '@/services/lego_blocks/integrations/assignmentLogStoreBlock'
import { newUuidBlock } from '@/services/lego_blocks/units/uuidBlock'
import { deriveCanonicalChainsOrch } from '@/services/orchestrators/aiActivityChainReconcileOrch'
import { chainSessionIdsBlock } from '@/services/orchestrators/aiActivityChainDigestOrch'
import { resolveChainDigestsBlock } from '@/services/lego_blocks/units/aiActivityChainResolveBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'

/**
 * The assignment queue: every chain that still owes a disposition, grouped by
 * what an AI pass proposed for it, ordered so the cheapest judgements come
 * first.
 *
 * The queue is the product, not the index. The constraint that shapes every
 * decision here is that involvement is expensive — so grouping is by proposal
 * rather than by chain (one keystroke disposes of the six chains that were
 * obviously one piece of work), ordering is by confidence descending (abandon
 * the session at any point having done the most good), and skipping is free.
 *
 * Contract: [ASSIGNMENT.md](../../../docs/contracts/ASSIGNMENT.md). The two
 * rules this file exists to enforce are that **minting is never automatic** —
 * a `new` target is surfaced for a human and `createUndertakingOrch` is the only
 * path that mints — and that **every disposition is logged**, including the ones
 * a human made without a proposal on the table.
 */

const BUCKET_TITLE = 'Not an undertaking'

export interface QueueChainBlock {
  chainId: string
  chainKey: string
  projectId: string
  title: string
  date: string
  /** Minutes of active work, for the "is this worth an undertaking" judgement
   *  the human is being asked to make at a glance. */
  activeMinutes: number
}

export interface QueueItem {
  group: QueueGroupBlock
  /** The chains in the group, joined to what they actually are — the queue has
   *  to show enough to check a proposal without opening anything. */
  chains: QueueChainBlock[]
  /** Present when the proposal points at an undertaking that exists, so the row
   *  can show what it would be joining rather than a bare key. */
  targetTitle: string
  /** Where it lands in the index, as a section *title* — resolved here because
   *  the proposal carries a section key, and a key is not something a human
   *  should have to translate mid-decision. Null for the bucket, which has no
   *  section, and for a mint whose section key names nothing. */
  targetSection: string | null
}

export interface AssignmentQueue {
  items: QueueItem[]
  /** Undisposed chains nothing has proposed for. Not an error and not hidden:
   *  this is the backlog the next proposing pass should look at, and it is the
   *  number that says whether the AI half is keeping up. */
  unproposed: QueueChainBlock[]
  /** Total chains still owing a disposition — the metric the whole feature is
   *  judged by, and the one that should trend to zero. */
  undisposedCount: number
  /**
   * Proposals naming a chain that does not exist in the project at all.
   *
   * Surfaced rather than dropped, because the two ways a proposal can vanish
   * from the queue are not the same thing. One is history — the chain was
   * disposed of since, and the proposal has simply been answered. The other is
   * a mistake: a truncated or mistyped `chainId`, which produces an empty queue
   * and no explanation for it. That happened on the very first real run of this
   * pass, and "0 groups" was indistinguishable from "nothing to do", which is
   * exactly the silent degradation DERIVATION.md forbids.
   */
  orphanedProposals: Array<{ chainId: string; projectId: string; proposedBy: string }>
}

function toQueueChainBlock(chain: ChainEntry): QueueChainBlock {
  return {
    chainId: chain.chainId,
    chainKey: chain.chainKey,
    projectId: chain.projectId,
    title: chain.title,
    date: chain.date,
    activeMinutes: Math.round(chainActiveDurationMsBlock(chain) / 60000),
  }
}

/**
 * Chains still owing a disposition, for one project or every project.
 *
 * Reads `listChainsBlock` rather than `listProjectChainsOrch`: the only field
 * this pass judges on is `undertaking`, which is the one field on a digest that
 * is *not* mechanically derivable — it is stored judgment. Going through the
 * reconciling read would pay for chain derivation on every project to decide a
 * question the stored record already answers correctly.
 */
export async function listUndisposedChainsOrch(projectId?: string): Promise<ChainEntry[]> {
  const projects = projectId ? [projectId] : await listChainProjectsBlock()
  const out: ChainEntry[] = []
  for (const project of projects) {
    out.push(...undisposedChainsBlock(await listChainsBlock({ projectId: project })))
  }
  return out
}

/**
 * The live `ActivityChain` behind a queue row, so a proposal can be checked
 * against the actual transcript instead of a title someone else wrote.
 *
 * Deliberately *not* a second matching rule. `listUndisposedChainsOrch` reads
 * stored digests because `undertaking` is stored judgment, but a transcript
 * needs session file pointers, which only the derived chain has. So this joins
 * the two the same way `listProjectChainsOrch` does — on session membership,
 * via `resolveChainDigestsBlock` — because the digest's key is what the grouping
 * rule thought at write time, and matching on it would miss every chain whose
 * grouping has since moved.
 *
 * Returns null when the chain cannot be derived (a device with no session
 * cache), which the caller must render as "can't open" rather than as an error.
 */
export async function getQueueChainTranscriptSourceOrch(
  projectId: string,
  chainId: string,
): Promise<ActivityChain | null> {
  const stored = await listChainsBlock({ projectId })
  if (stored.length === 0) return null

  let chains: ActivityChain[]
  try {
    chains = (await deriveCanonicalChainsOrch()).filter(chain => chain.project === projectId)
  } catch {
    return null
  }

  const resolved = resolveChainDigestsBlock(
    chains.map(chain => ({ key: chain.key, sessions: chainSessionIdsBlock(chain) })),
    stored,
  )
  for (const chain of chains) {
    if (resolved.get(chain.key)?.chainId === chainId) return chain
  }
  return null
}

export async function getAssignmentQueueOrch(projectId?: string): Promise<AssignmentQueue> {
  const projects = projectId ? [projectId] : await listChainProjectsBlock()

  const live: AssignmentProposalBlock[] = []
  const undisposed: ChainEntry[] = []
  const chainsById = new Map<string, ChainEntry>()
  const titlesByKey = new Map<string, string>()
  // Both keyed by `${projectId}:${key}` — the queue spans projects, and section
  // keys are only unique inside one.
  const sectionKeyByUndertaking = new Map<string, string>()
  const sectionTitles = new Map<string, string>()
  const proposedChainIds = new Set<string>()
  const orphanedProposals: AssignmentQueue['orphanedProposals'] = []

  for (const project of projects) {
    // Every chain, not just the undisposed ones: telling an answered proposal
    // apart from a mistyped one needs to know whether the chain exists at all.
    const all = await listChainsBlock({ projectId: project })
    const known = new Set(all.map(chain => chain.chainId))
    const mine = undisposedChainsBlock(all)
    undisposed.push(...mine)
    for (const chain of mine) chainsById.set(chain.chainId, chain)

    const undisposedIds = new Set(mine.map(chain => chain.chainId))
    for (const [chainId, proposal] of latestProposalsBlock(await readProposalsBlock(project))) {
      if (!known.has(chainId)) {
        orphanedProposals.push({ chainId, projectId: project, proposedBy: proposal.proposedBy })
        continue
      }
      // A proposal whose chain has since been stamped is history, not queue —
      // dropping it here is what keeps an accepted row from reappearing after a
      // chain rebuild regenerates the digest.
      if (!undisposedIds.has(chainId)) continue
      live.push(proposal)
      proposedChainIds.add(chainId)
    }

    for (const record of await listUndertakingsBlock(project)) {
      titlesByKey.set(record.key, record.title)
      sectionKeyByUndertaking.set(`${project}:${record.key}`, record.section)
    }
    for (const section of await listSectionsBlock(project)) {
      sectionTitles.set(`${project}:${section.key}`, section.title)
    }
  }

  const sectionTitleOf = (projectId: string, group: QueueGroupBlock): string | null => {
    const key =
      group.target.kind === 'new'
        ? group.target.section
        : group.target.kind === 'existing'
          ? sectionKeyByUndertaking.get(`${projectId}:${group.target.key}`)
          : undefined
    return key ? sectionTitles.get(`${projectId}:${key}`) ?? key : null
  }

  const items: QueueItem[] = buildQueueGroupsBlock(live).map(group => ({
    group,
    chains: group.proposals
      .map(proposal => chainsById.get(proposal.chainId))
      .filter((chain): chain is ChainEntry => Boolean(chain))
      .map(toQueueChainBlock),
    targetTitle:
      group.target.kind === 'existing'
        ? titlesByKey.get(group.target.key) ?? group.target.key
        : targetLabelBlock(group.target),
    targetSection: sectionTitleOf(group.projectId, group),
  }))

  return {
    items,
    unproposed: undisposed
      .filter(chain => !proposedChainIds.has(chain.chainId))
      .map(toQueueChainBlock),
    undisposedCount: undisposed.length,
    orphanedProposals,
  }
}

/** Record what an AI pass believes. Writing a proposal changes nothing a reader
 *  depends on — it is a claim awaiting a verdict — which is why this is the one
 *  assignment write an automated pass may make unattended. */
export async function proposeAssignmentsOrch(
  proposals: Array<Omit<AssignmentProposalBlock, 'proposedAt'> & { proposedAt?: string }>,
): Promise<{ written: number; paths: string[] }> {
  const now = new Date().toISOString()
  const byProject = new Map<string, AssignmentProposalBlock[]>()
  for (const proposal of proposals) {
    const full: AssignmentProposalBlock = { ...proposal, proposedAt: proposal.proposedAt ?? now }
    const bucket = byProject.get(full.projectId)
    if (bucket) bucket.push(full)
    else byProject.set(full.projectId, [full])
  }
  const paths: string[] = []
  for (const [project, batch] of byProject) {
    paths.push(await appendProposalsBlock(project, batch))
  }
  return { written: proposals.length, paths }
}

// ── Minting (human-only) ───────────────────────────────────────────────────

/**
 * Create an undertaking. The only path that mints a key, and it is deliberately
 * not reachable from an automated pass.
 *
 * A key is an address: sections file under it, chains point at it, and renaming
 * it later orphans every one of them. So a proposal that wants a new
 * undertaking is surfaced in the queue and a person presses the key — the
 * mechanism proposes, only a person commits. Auto-minting at high confidence
 * was considered and rejected: confidence is about *which* undertaking, and says
 * nothing about whether a permanent address should exist.
 */
export async function createUndertakingOrch(
  projectId: string,
  params: {
    title: string
    section?: string
    head?: string
    bucket?: boolean
    origin?: string
    /** Task tickets this undertaking fed on, written at birth. Only ever set by
     *  a human path — the seam derives the reverse edge, it never invents one. */
    fedBy?: string[]
  },
): Promise<{ path: string; record: UndertakingRecord }> {
  const title = params.title.trim()
  if (!title) throw new Error('Undertaking title cannot be empty')

  const existing = await listUndertakingsBlock(projectId)
  const key = undertakingKeyFromTitleBlock(projectId, title, existing.map(r => r.key))
  const sections = await listSectionsBlock(projectId)
  const section = params.section?.trim() || sections[0]?.key || ''
  const today = new Date().toISOString().slice(0, 10)

  const record: UndertakingRecord = {
    uuid: newUuidBlock(),
    key,
    title,
    // The stable project uuid is copied from a sibling rather than invented:
    // nothing resolves by it, but a record carrying a *different* uuid to its
    // neighbours reads as a different project to anything that ever starts to.
    projectId: existing[0]?.projectId ?? '',
    section,
    createdAt: today,
    updatedAt: today,
    sortOrder: existing.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1,
    tags: [],
    proposedTags: [],
    grewOutOf: [],
    fedBy: params.fedBy ?? [],
    produced: [],
    chains: [],
    files: [],
    origin: params.origin ?? 'assignment-queue',
    bucket: params.bucket === true,
    head: params.head?.trim() ?? '',
    comments: [],
  }
  return { path: await writeUndertakingBlock(projectId, record), record }
}

/**
 * The project's "not an undertaking" pile, created on first use.
 *
 * Get-or-create rather than seeded up front: a project that has never needed to
 * say "this wasn't work" should not carry an empty pile in its index, and the
 * first bucket verdict is the moment the concept becomes real for that project.
 * Matched by the `bucket` flag, not by title — the title is a label a human may
 * reword, and matching on it would silently mint a second pile.
 */
export async function ensureBucketUndertakingOrch(projectId: string): Promise<UndertakingRecord> {
  const existing = await listUndertakingsBlock(projectId)
  const found = existing.find(record => record.bucket)
  if (found) return found
  const { record } = await createUndertakingOrch(projectId, {
    title: BUCKET_TITLE,
    head: 'Chains judged not to be undertakings — lookups, abandoned attempts, noise. Kept so they are disposed of rather than merely unassigned.',
    bucket: true,
  })
  return record
}

// ── Disposition ────────────────────────────────────────────────────────────

/** Resolve a target to the undertaking key a chain should be stamped with,
 *  minting only when the target says to and the caller is a human path. */
async function resolveTargetKeyBlock(
  projectId: string,
  target: ProposalTargetBlock,
  origin?: string,
): Promise<string> {
  switch (target.kind) {
    case 'existing': {
      const record = await getUndertakingBlock(projectId, target.key)
      // Held rather than created. A key that is not there is either a new
      // undertaking or a typo, and from here those are indistinguishable —
      // guessing wrong makes the typo a permanent address.
      if (!record) throw new Error(`Unknown undertaking: ${target.key}`)
      return record.key
    }
    case 'bucket':
      return (await ensureBucketUndertakingOrch(projectId)).key
    case 'new': {
      // An exact title match is landed on, not minted beside. Dropping a chain
      // from a group and accepting the rest leaves the dropped one carrying the
      // same `{kind:'new', title}` proposal — without this, saying yes to it
      // afterwards mints a second undertaking with an identical title and a
      // `-2` key, and the work silently splits across two addresses. Matching
      // on title is safe here precisely because it is *not* a rename path: the
      // human typed or accepted this exact string a moment ago.
      const wanted = target.title.trim().toLowerCase()
      const twin = (await listUndertakingsBlock(projectId)).find(
        record => !record.bucket && record.title.trim().toLowerCase() === wanted,
      )
      if (twin) return twin.key

      const { record } = await createUndertakingOrch(projectId, {
        title: target.title,
        section: target.section,
        head: target.head,
        // Where the mint came from, carried through rather than defaulted. A
        // record minted off a human's own selection did not come from the
        // assignment queue's suggestions, and saying it did would make the one
        // field that records provenance lie about the only records whose
        // provenance is unambiguous.
        origin,
      })
      return record.key
    }
  }
}

export interface DisposeParams {
  chainIds: string[]
  projectId: string
  /** What was on the table, for the log. Null when a human dispositioned a
   *  chain no pass had proposed for. */
  proposed: ProposalTargetBlock | null
  confidence: number
  /** Where it actually goes. Null rejects the proposal and leaves the chain in
   *  the queue. */
  target: ProposalTargetBlock | null
  decidedBy?: 'queue' | 'auto'
  /** Provenance for an undertaking this disposition mints. Defaults to
   *  `assignment-queue`; the manual pane passes `manual`. */
  origin?: string
}

export interface DisposeResult {
  stamped: string[]
  undertaking: string | null
  verdict: VerdictKindBlock
}

/**
 * Apply a verdict to a group of chains and log it.
 *
 * One entry point for all three queue keys, because they differ only in what
 * `target` is: accept passes the proposal back, retarget passes something else,
 * bucket passes `{kind:'bucket'}`, reject passes null. Splitting them into four
 * orchestrators would give four places for the logging to be forgotten, and a
 * verdict that never got logged is indistinguishable from one that never
 * happened.
 *
 * Stamping is a **union**, never a replacement: a chain can genuinely feed two
 * undertakings, and a re-run over an already-stamped chain must be a no-op
 * rather than a rewrite. That is what makes the whole pass safe to repeat after
 * a chain rebuild.
 */
export async function disposeChainsOrch(params: DisposeParams): Promise<DisposeResult> {
  const at = new Date().toISOString()
  const verdictKind: VerdictKindBlock = !params.target
    ? 'reject'
    : params.proposed && targetsMatchBlock(params.proposed, params.target)
      ? 'accept'
      : 'modify'

  let key: string | null = null
  const stamped: string[] = []

  if (params.target) {
    key = await resolveTargetKeyBlock(params.projectId, params.target, params.origin)
    const chains = await listChainsBlock({ projectId: params.projectId })
    const wanted = new Set(params.chainIds)
    for (const chain of chains) {
      if (!wanted.has(chain.chainId)) continue
      if (chain.undertaking.includes(key)) continue
      await patchChainBlock(chain, { undertaking: [...chain.undertaking, key] })
      stamped.push(chain.chainId)
    }
  }

  const verdicts: AssignmentVerdictBlock[] = params.chainIds.map(chainId => ({
    chainId,
    projectId: params.projectId,
    proposed: params.proposed,
    confidence: params.confidence,
    verdict: verdictKind,
    // Logged as the resolved key, not the target as typed: a `new` target's
    // title is not where the chain landed, and the log has to be replayable
    // against the store a year from now.
    correctedTo: key ? { kind: 'existing', key } : null,
    decidedBy: params.decidedBy ?? 'queue',
    at,
  }))
  await appendVerdictsBlock(verdicts)

  return { stamped, undertaking: key, verdict: verdictKind }
}

/**
 * Mint an undertaking from a human's own selection, then file the selected
 * chains into it.
 *
 * The queue could only ever answer a question an AI pass had already asked. For
 * the 251 chains nothing has proposed for, the sole remedy the UI offered was
 * "ask Kai to take a pass" — which made an automated pass a prerequisite for
 * human judgement, in a feature whose contract says the opposite: AI proposes, a
 * human mints, and every chain gets a disposition. This is that missing path.
 *
 * It is a composition, not a fourth write path. The mint goes through
 * `createUndertakingOrch` and the stamping through `disposeChainsOrch`, so the
 * key rules (one minting path, every disposition logged) hold here without being
 * restated — and the verdicts land with `proposed: null`, which
 * `calibrateBandsBlock` already skips. A manual decision must not be read as
 * evidence for or against a confidence band that never made a claim.
 */
export async function mintFromSelectionOrch(params: {
  projectId: string
  title: string
  section?: string
  head?: string
  chainIds: string[]
  /** Task tickets in display form (`TP-DA-T-514`) — the seam's edge vocabulary. */
  fedBy?: string[]
}): Promise<{ key: string; stamped: string[] }> {
  const { record } = await createUndertakingOrch(params.projectId, {
    title: params.title,
    section: params.section,
    head: params.head,
    origin: 'manual',
    fedBy: params.fedBy,
  })
  if (params.chainIds.length === 0) return { key: record.key, stamped: [] }
  const result = await disposeChainsOrch({
    chainIds: params.chainIds,
    projectId: params.projectId,
    proposed: null,
    confidence: 0,
    target: { kind: 'existing', key: record.key },
    origin: 'manual',
  })
  return { key: record.key, stamped: result.stamped }
}

function targetsMatchBlock(a: ProposalTargetBlock, b: ProposalTargetBlock): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'existing' && b.kind === 'existing') return a.key === b.key
  if (a.kind === 'new' && b.kind === 'new') {
    return a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
  }
  return a.kind === 'bucket' && b.kind === 'bucket'
}

/** Remove a chain from an undertaking — the other half of the two-primitive
 *  correction surface, and the undo for every auto-applied stamp. Leaves the
 *  chain undisposed, which puts it back in the queue rather than losing it. */
export async function detachChainOrch(
  projectId: string,
  chainId: string,
  undertakingKey: string,
): Promise<{ path: string } | null> {
  const chains = await listChainsBlock({ projectId })
  const chain = chains.find(entry => entry.chainId === chainId)
  if (!chain || !chain.undertaking.includes(undertakingKey)) return null
  const { path } = await patchChainBlock(chain, {
    undertaking: chain.undertaking.filter(key => key !== undertakingKey),
  })
  return { path }
}

/** How each confidence band has done so far, from human verdicts only. The
 *  input to any decision about letting a band auto-apply — and the reason the
 *  log had to exist before the first disposition rather than after the first
 *  disappointment. */
export async function getAssignmentCalibrationOrch(): Promise<BandCalibrationBlock[]> {
  return calibrateBandsBlock(await readAllVerdictsBlock())
}

/** Recently auto-applied stamps, newest first — the visibility half of "auto is
 *  never invisible". Each row carries what it needs for a one-key undo. */
export async function listRecentAutoAppliedOrch(limit = 20): Promise<AssignmentVerdictBlock[]> {
  const all = await readAllVerdictsBlock()
  return all
    .filter(verdict => verdict.decidedBy === 'auto' && verdict.correctedTo)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
