import {
  listProjectSessionDigestsBlock,
  listSessionProjectsBlock,
  patchSessionUndertakingBlock,
} from '@/services/lego_blocks/integrations/aiActivitySessionDigestStoreBlock'
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
import {
  groupSessionDigestsBlock,
  sessionActiveDurationMsBlock,
  type ProjectSessionDigest,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
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
  accuracyByAuthorBlock,
  calibrateBandsBlock,
  type AssignmentVerdictBlock,
  type AuthorAccuracyBlock,
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
import { deriveCanonicalChainsOrch } from '@/services/orchestrators/aiActivityChainsOrch'
import { sessionIdOf } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

/**
 * The assignment queue: every session that still owes a disposition, grouped by
 * what an AI pass proposed for it, ordered so the cheapest judgements come
 * first.
 *
 * The queue is the product, not the index. The constraint that shapes every
 * decision here is that involvement is expensive — so grouping is by proposal
 * rather than by session (one keystroke disposes of the six sittings that were
 * obviously one piece of work), ordering is by confidence descending (abandon
 * the pass at any point having done the most good), and skipping is free.
 *
 * ## Why the session and not the chain
 *
 * This queue used to dispose of *chains*. A chain groups by time, so it can
 * hold two unrelated topics — and an undertaking is a topic. That mismatch is
 * how a Broadcom undertaking came to list four Important-Personalities notes as
 * its pages: a 20-second gap made them one chain, and a chain-level disposition
 * had no way to say "this half, not that half".
 *
 * The unit is now the session, which is the finest thing the transcript
 * actually distinguishes, so that misattribution is no longer representable.
 * The cost is roughly 1.5x the rows (chains average 1.49 sessions), which the
 * UI absorbs by *displaying* rows grouped into their sitting via `chainKey`
 * while *deciding* per session. Grouping is presentation; disposition is data.
 *
 * Contract: [ASSIGNMENT.md](../../../docs/contracts/ASSIGNMENT.md). The two
 * rules this file exists to enforce are that **minting is never automatic** —
 * a `new` target is surfaced for a human and `createUndertakingOrch` is the only
 * path that mints — and that **every disposition is logged**, including the ones
 * a human made without a proposal on the table.
 */

const BUCKET_TITLE = 'Not an undertaking'

export interface QueueSessionBlock {
  /** The unit of disposition. Stratum-1 and immovable, which is what lets a
   *  logged verdict still name the right thing after any regrouping. */
  sessionId: string
  /** Which sitting this session belongs to, for display grouping only. Derived
   *  on read and never logged — a verdict keyed by this would rot the moment
   *  the grouping changed, which is the whole defect this refactor removed. */
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
  /** The sessions in the group, joined to what they actually are — the queue
   *  has to show enough to check a proposal without opening anything. */
  sessions: QueueSessionBlock[]
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
  /** Undisposed sessions nothing has proposed for. Not an error and not hidden:
   *  this is the backlog the next proposing pass should look at, and it is the
   *  number that says whether the AI half is keeping up. */
  unproposed: QueueSessionBlock[]
  /** Total sessions still owing a disposition — the metric the whole feature is
   *  judged by, and the one that should trend to zero. */
  undisposedCount: number
  /**
   * Proposals naming a session that does not exist in the project at all.
   *
   * Surfaced rather than dropped, because the two ways a proposal can vanish
   * from the queue are not the same thing. One is history — the session was
   * disposed of since, and the proposal has simply been answered. The other is
   * a mistake: a truncated or mistyped id, which produces an empty queue and no
   * explanation for it. That happened on the very first real run of this pass,
   * and "0 groups" was indistinguishable from "nothing to do", which is exactly
   * the silent degradation DERIVATION.md forbids.
   */
  orphanedProposals: Array<{ sessionId: string; projectId: string; proposedBy: string }>
  /**
   * Lines in the logs that could not be parsed at all.
   *
   * A sibling of `orphanedProposals` and for the same reason, one level lower.
   * That field catches a proposal that parses and then names nothing; this one
   * catches a line that never became a proposal — which is the failure that
   * actually happened. The session refactor rekeyed the log from `chainId` to
   * `sessionId`, the parser dropped every pre-refactor line without a word, and
   * "Nothing suggested right now" was rendered over 220 readable proposals and
   * a full month of verdicts. Absence is not evidence; an empty queue has to be
   * able to say whether it is empty or broken.
   */
  unreadableLines: { proposals: number; verdicts: number; samples: string[] }
}

/** `chainKey` for display grouping. Computed from the sitting each session
 *  falls into, so consecutive rows that were one sitting can be shown together
 *  without any of them being *addressed* by it. */
function toQueueSessionBlock(
  digest: ProjectSessionDigest,
  chainKeyBySession: Map<string, string>,
): QueueSessionBlock {
  return {
    sessionId: digest.sessionId,
    chainKey: chainKeyBySession.get(digest.sessionId) ?? digest.sessionId,
    projectId: digest.projectId,
    title: digest.title,
    date: digest.date,
    activeMinutes: Math.round(sessionActiveDurationMsBlock(digest) / 60000),
  }
}

/** Map every session to the sitting it belongs to, by running the one grouping
 *  algorithm over the records. Display-only — see `QueueSessionBlock.chainKey`. */
function chainKeysForBlock(digests: ProjectSessionDigest[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const group of groupSessionDigestsBlock(digests)) {
    const key = `${group[0].projectId}::${group[0].sessionId}`
    for (const d of group) out.set(d.sessionId, key)
  }
  return out
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
export async function listUndisposedChainsOrch(projectId?: string): Promise<ProjectSessionDigest[]> {
  const projects = projectId ? [projectId] : await listSessionProjectsBlock()
  const out: ProjectSessionDigest[] = []
  for (const project of projects) {
    out.push(...undisposedChainsBlock(await listProjectSessionDigestsBlock(project)))
  }
  return out
}

/**
 * The transcript source behind a queue row, so a proposal can be checked
 * against what actually happened instead of a title someone else wrote.
 *
 * A queue row is one session, so this returns that session wrapped as a
 * one-member chain — `getChainTranscriptBlock` renders chains, and a session is
 * simply the smallest one.
 *
 * Note how short this got. It used to derive every chain in the project, run
 * two-pass membership-overlap resolution against the stored digests, and match
 * on a frozen `chainId` — all to answer "which live thing is this row?" when
 * the row's own id had been made unmatchable by being derived. A session id is
 * the transcript's own id, so the answer is a lookup.
 *
 * Returns null when the session cannot be found (a device with no session
 * cache), which the caller must render as "can't open" rather than as an error.
 */
export async function getQueueSessionTranscriptSourceOrch(
  projectId: string,
  sessionId: string,
): Promise<ActivityChain | null> {
  let chains: ActivityChain[]
  try {
    chains = (await deriveCanonicalChainsOrch()).filter(chain => chain.project === projectId)
  } catch {
    return null
  }
  for (const chain of chains) {
    const match = chain.sessions.find(s => sessionIdOf(s) === sessionId)
    if (match) return oneSessionChainBlock(chain.project, match)
  }
  return null
}

/** Wrap a single session as a chain of one, for readers that render chains. */
function oneSessionChainBlock(project: string, session: ParsedSession): ActivityChain {
  return {
    key: `${project}::${session.path}`,
    project,
    source: session.source,
    startedIso: session.startedIso,
    endedIso: session.endedIso ?? session.startedIso,
    msgCount: session.userMsgCount,
    topic: session.topic,
    sessions: [session],
    touchedPaths: session.touchedPaths,
    activeDurationMs: session.activeDurationMs,
  }
}

export async function getAssignmentQueueOrch(projectId?: string): Promise<AssignmentQueue> {
  const projects = projectId ? [projectId] : await listSessionProjectsBlock()

  const live: AssignmentProposalBlock[] = []
  const undisposed: ProjectSessionDigest[] = []
  const digestsById = new Map<string, ProjectSessionDigest>()
  const titlesByKey = new Map<string, string>()
  // Both keyed by `${projectId}:${key}` — the queue spans projects, and section
  // keys are only unique inside one.
  const sectionKeyByUndertaking = new Map<string, string>()
  const sectionTitles = new Map<string, string>()
  const proposedSessionIds = new Set<string>()
  const orphanedProposals: AssignmentQueue['orphanedProposals'] = []
  const chainKeys = new Map<string, string>()
  const unreadableSamples: string[] = []
  let unreadableProposals = 0

  for (const project of projects) {
    // Every session, not just the undisposed ones: telling an answered proposal
    // apart from a mistyped one needs to know whether the session exists at all.
    const all = await listProjectSessionDigestsBlock(project)
    const known = new Set(all.map(d => d.sessionId))
    // Display grouping is computed over ALL of the project's sessions, not just
    // the undisposed ones — a sitting keeps its shape even when half of it has
    // already been filed, so rows don't regroup as you work through the queue.
    for (const [id, key] of chainKeysForBlock(all)) chainKeys.set(id, key)
    const mine = undisposedChainsBlock(all)
    undisposed.push(...mine)
    for (const digest of mine) digestsById.set(digest.sessionId, digest)

    const undisposedIds = new Set(mine.map(d => d.sessionId))
    const read = await readProposalsBlock(project)
    unreadableProposals += read.skipped
    for (const sample of read.samples) if (unreadableSamples.length < 3) unreadableSamples.push(sample)
    for (const proposal of latestProposalsBlock(read.proposals)) {
      const { sessionId } = proposal
      if (!known.has(sessionId)) {
        orphanedProposals.push({ sessionId, projectId: project, proposedBy: proposal.proposedBy })
        continue
      }
      // A proposal whose session has since been stamped is history, not queue —
      // dropping it here is what keeps an accepted row from reappearing after a
      // regeneration rewrites the digest.
      if (!undisposedIds.has(sessionId)) continue
      live.push(proposal)
      proposedSessionIds.add(sessionId)
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
    sessions: group.proposals
      .map(proposal => digestsById.get(proposal.sessionId))
      .filter((digest): digest is ProjectSessionDigest => Boolean(digest))
      .map(digest => toQueueSessionBlock(digest, chainKeys)),
    targetTitle:
      group.target.kind === 'existing'
        ? titlesByKey.get(group.target.key) ?? group.target.key
        : targetLabelBlock(group.target),
    targetSection: sectionTitleOf(group.projectId, group),
  }))

  // Verdicts are read here purely to surface their unreadable count alongside
  // the proposals'. The queue does not otherwise need them — but a broken
  // verdict log is invisible everywhere else, and it is the one that costs
  // calibration rather than rows.
  const verdictRead = await readAllVerdictsBlock()
  for (const sample of verdictRead.samples) {
    if (unreadableSamples.length < 3) unreadableSamples.push(sample)
  }

  return {
    items,
    unproposed: undisposed
      .filter(digest => !proposedSessionIds.has(digest.sessionId))
      .map(digest => toQueueSessionBlock(digest, chainKeys)),
    undisposedCount: undisposed.length,
    orphanedProposals,
    unreadableLines: {
      proposals: unreadableProposals,
      verdicts: verdictRead.skipped,
      samples: unreadableSamples,
    },
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
  const unverified: string[] = []
  for (const [project, batch] of byProject) {
    const { path, verified } = await appendProposalsBlock(project, batch)
    paths.push(path)
    if (!verified) unverified.push(path)
  }
  if (unverified.length) {
    // Loud, not logged-and-shrugged. The caller asked for a claim to be
    // durable; if it is not, saying so is the only honest return.
    throw new Error(
      `Proposals could not be written durably after retries: ${unverified.join(', ')}`,
    )
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
  sessionIds: string[]
  projectId: string
  /** What was on the table, for the log. Null when a human dispositioned a
   *  chain no pass had proposed for. */
  proposed: ProposalTargetBlock | null
  confidence: number
  /** Where it actually goes. Null rejects the proposal and leaves the chain in
   *  the queue. */
  target: ProposalTargetBlock | null
  decidedBy?: 'queue' | 'auto'
  /** Who made the claim being judged, carried from the proposal onto the
   *  verdict so accuracy can be read per author. Empty when `proposed` is null
   *  — there was no claim and therefore no one to grade. */
  proposedBy?: string
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
export async function disposeSessionsOrch(params: DisposeParams): Promise<DisposeResult> {
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
    const digests = await listProjectSessionDigestsBlock(params.projectId)
    const wanted = new Set(params.sessionIds)
    for (const digest of digests) {
      if (!wanted.has(digest.sessionId)) continue
      if (digest.undertaking.includes(key)) continue
      await patchSessionUndertakingBlock(digest.projectId, digest.sessionId, [
        ...digest.undertaking,
        key,
      ])
      stamped.push(digest.sessionId)
    }
  }

  const verdicts: AssignmentVerdictBlock[] = params.sessionIds.map(sessionId => ({
    sessionId,
    projectId: params.projectId,
    proposed: params.proposed,
    confidence: params.confidence,
    verdict: verdictKind,
    proposedBy: params.proposed ? params.proposedBy?.trim() ?? '' : '',
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
 * `createUndertakingOrch` and the stamping through `disposeSessionsOrch`, so the
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
  sessionIds: string[]
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
  if (params.sessionIds.length === 0) return { key: record.key, stamped: [] }
  const result = await disposeSessionsOrch({
    sessionIds: params.sessionIds,
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

/** Remove a session from an undertaking — the other half of the two-primitive
 *  correction surface, and the undo for every auto-applied stamp. Leaves the
 *  session undisposed, which puts it back in the queue rather than losing it. */
export async function detachSessionOrch(
  projectId: string,
  sessionId: string,
  undertakingKey: string,
): Promise<{ sessionId: string } | null> {
  const digests = await listProjectSessionDigestsBlock(projectId)
  const digest = digests.find(entry => entry.sessionId === sessionId)
  if (!digest || !digest.undertaking.includes(undertakingKey)) return null
  const patched = await patchSessionUndertakingBlock(
    projectId,
    sessionId,
    digest.undertaking.filter(key => key !== undertakingKey),
  )
  return patched ? { sessionId: patched.sessionId } : null
}

/** How each confidence band has done so far, from human verdicts only. The
 *  input to any decision about letting a band auto-apply — and the reason the
 *  log had to exist before the first disposition rather than after the first
 *  disappointment. */
export async function getAssignmentCalibrationOrch(): Promise<BandCalibrationBlock[]> {
  return calibrateBandsBlock((await readAllVerdictsBlock()).verdicts)
}

/**
 * Accept rate per proposing author, across every month.
 *
 * The question this answers: is a first-hand in-session answer more or less
 * reliable than a sweep's inference? Until the in-session route reached the
 * queue there was nothing to measure, and until `proposedBy` was logged there
 * was no way to split the measurement. Read it before adding machinery to help
 * agents pick better keys — if they already pick well, that machinery is cost
 * with no return.
 */
export async function getAuthorAccuracyOrch(): Promise<AuthorAccuracyBlock[]> {
  return accuracyByAuthorBlock((await readAllVerdictsBlock()).verdicts)
}

/** Recently auto-applied stamps, newest first — the visibility half of "auto is
 *  never invisible". Each row carries what it needs for a one-key undo. */
export async function listRecentAutoAppliedOrch(limit = 20): Promise<AssignmentVerdictBlock[]> {
  const { verdicts: all } = await readAllVerdictsBlock()
  return all
    .filter(verdict => verdict.decidedBy === 'auto' && verdict.correctedTo)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
