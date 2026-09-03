import { isReadingSource, isManualSource, type ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { isSettledBlock } from '@/services/lego_blocks/units/aiActivityLivenessBlock'
import { sessionIdOf } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import {
  getAiActivityAiTitlesEnabled,
  getStoredVaultRoot,
} from '@/services/lego_blocks/units/storageKeyBlock'
import {
  isValidSessionDigestDateBlock,
  type ProjectSessionDigest,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import {
  getProjectSessionDigestBlock,
  putProjectSessionDigestBlock,
} from '@/services/lego_blocks/integrations/aiActivitySessionDigestStoreBlock'
import {
  prepareSessionDigestInputBlock,
  sessionDigestContract,
  type SessionDigestOutput,
} from '@/services/lego_blocks/units/intelligence/contracts/sessionDigestContractBlock'
import {
  availability,
  contractReasoningWillRunOrch,
  runContract,
} from '@/services/orchestrators/intelligenceOrch'
import { intelligenceCacheAvailableBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import {
  heavyBackgroundWorkAllowedBlock,
  type HeavyWorkBlockReason,
} from '@/services/lego_blocks/integrations/powerStateBlock'
import { currentGenerationSourceBlock } from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import {
  generationSourceForProviderBlock,
  generationTierRankBlock,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// Public surface for per-session digests — the base of the AI-activity strata.
//
// Compare with the chain-digest orchestrator this replaces: no `mintChainId`,
// no membership resolution, no reconcile pass, no legacy address fallback.
// None of that machinery was ever about summarizing well; all of it was about
// surviving an address that moved when the grouping rule changed. A session id
// is stratum-1, so this file is just: hash the inputs, reuse or regenerate,
// project the mechanical fields, store.

/** Read-only variant — never runs the model. For callers that just want to
 *  know whether a digest exists (chain composition, timeline scrubbing). */
export async function loadSessionDigestOrch(
  session: ParsedSession,
): Promise<ProjectSessionDigest | null> {
  const parts = sessionStorageParts(session)
  if (!parts) return null
  const stored = await getProjectSessionDigestBlock(parts.projectId, parts.sessionId)
  return stored ? projectSessionFieldsBlock(stored, session) : null
}

export interface SessionDigestResult {
  digest: ProjectSessionDigest
  isAi: boolean
  /** Set when an automatic run was refused for power reasons rather than
   *  attempted and failed. Lets the UI say "paused, and here is why" instead of
   *  showing a rule-based title that looks like the model's best effort. */
  blocked?: HeavyWorkBlockReason
  /** The stored digest no longer matches its input hash — the sitting's shape
   *  moved, or a lever was bumped — and we served it anyway. Purely advisory:
   *  it drives the "regenerate" affordance, and is never a reason to spend on
   *  its own. See the replacement rule in `ensureSessionDigestOrch`. */
  stale?: boolean
}

/**
 * Ensure a stored digest exists for `session`. Returns:
 *   - the stored digest when the input hash matches (fast path),
 *   - a regenerated digest when the session grew or the model changed,
 *   - a fallback built from `session.topic` when intelligence is unavailable.
 * The fallback is NOT persisted, so a later boot with a provider configured
 * generates the real thing.
 */
export async function ensureSessionDigestOrch(
  session: ParsedSession,
  options: { refresh?: boolean } = {},
): Promise<SessionDigestResult | null> {
  const parts = sessionStorageParts(session)
  if (!parts) return null
  const nextHash = computeSessionInputHashBlock(session)

  // Mechanical fields come from the session in hand, not from disk. The stored
  // copy is refreshed as a side effect so other devices benefit, but the value
  // returned here never depends on that write landing.
  const loaded = await getProjectSessionDigestBlock(parts.projectId, parts.sessionId)
  const existing = loaded ? await refreshStoredSessionFieldsOrch(loaded, session) : null

  // Fast path with tier precedence: reuse the stored digest when it is fresh
  // AND at least as good as what the current selection would produce. So a
  // Claude digest survives a switch to local (never downgrade a better body we
  // already have); switching *up* to Claude falls through and regenerates. The
  // target tier drops to rule-based (0) when AI titles are off or the cache is
  // unavailable, so any stored AI digest beats the deterministic fallback.
  // `refresh` bypasses reuse entirely so the user can force the currently
  // selected provider to run, even a downgrade.
  const aiActive = getAiActivityAiTitlesEnabled() && intelligenceCacheAvailableBlock()
  // The tier the current selection would produce, thinking included. Resolved
  // through the same path a real run takes, so a model with no reasoning mode
  // targets the tier it can actually reach rather than one it never will.
  const targetRank = aiActive
    ? generationTierRankBlock(
        currentGenerationSourceBlock(),
        await contractReasoningWillRunOrch('ai_activity'),
      )
    : 0
  if (
    !options.refresh &&
    existing &&
    existing.inputHash === nextHash &&
    generationTierRankBlock(existing.generator, existing.thinking) >= targetRank
  ) {
    return { digest: existing, isAi: true }
  }

  // REPLACEMENT RULE: an automatic run may CREATE a digest. It may never
  // REPLACE one. Only an explicit `refresh` — a person clicking regenerate —
  // overwrites a digest that already exists.
  //
  // Auto-regeneration was correct while this layer was being built: a few dozen
  // digests, the deriving code changing weekly, and re-deriving on a hash miss
  // was how a fix reached the corpus at all. Both halves of that have inverted.
  // The corpus is ~4,800 digests, and the code is settled — so the behaviour
  // that used to mean "your fix propagates" now means "any change to a hash
  // input silently bills the whole archive". The authorship change nearly
  // demonstrated it: bumping `promptVersion` would have re-derived every digest
  // in the vault to correct the handful whose sitting actually moved.
  //
  // This is the structural fix, and it is why the version levers stop being
  // dangerous. `CACHE_VERSION` and `promptVersion` still do their job — a stale
  // record is still *identified* as stale — but identifying is now decoupled
  // from spending. The user is told, and decides.
  //
  // What this deliberately gives up: a digest whose session genuinely grew no
  // longer silently improves itself. That is the intended trade — a wrong title
  // on a finished sitting is cheap and visible; an unrequested five-figure token
  // bill is neither. The `stale` flag carries the difference to the UI.
  if (!options.refresh && existing) {
    return { digest: existing, isAi: true, stale: existing.inputHash !== nextHash }
  }

  // Live sessions do not get a model call.
  //
  // The input hash covers message count and the window bounds, so the window
  // you are working in invalidates itself on every message: each view
  // regenerates,
  // and the summary it produces describes a conversation that has not finished.
  // Waiting for quiet turns an unbounded loop into one run. An explicit refresh
  // still goes through — the guard is against a background loop deciding to do
  // this, not against a person asking for it.
  if (!options.refresh && !isSettledBlock(session.endedIso ?? session.startedIso)) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  // Nothing to summarise, so nothing to ask. A session with no user message
  // spends a model call to be told what its own message count already said, and
  // the answer comes back as the one title the contract used to reject — so
  // these looped: run, discard, re-queue, forever. The rule-based digest is the
  // honest and free answer.
  if (session.userMsgCount <= 0) {
    return { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  // Reading and hand-logged sittings have no transcript. Everything worth
  // saying about them — pages, canvas places, scroll depth, the duration
  // itself — is mechanically derived and already on the session, so a provider
  // call would be paying to have structured data read back. They also carry a
  // synthetic `userMsgCount` of at least 1, so the check above does not catch
  // them. DERIVATION.md: model-derived and mechanically-derived fields are
  // different things and must not share a path.
  if (isReadingSource(session.source) || isManualSource(session.source)) {
    return { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  if (!intelligenceCacheAvailableBlock()) {
    return { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }
  // User-controlled kill switch — orthogonal to provider availability. Off:
  // never call the model; existing stored digests still surface above.
  if (!getAiActivityAiTitlesEnabled()) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  // POWER GATE. A digest is a 400–600s local-model run; on battery that is a
  // visible chunk of charge, and under Low Power Mode it directly contradicts
  // what the user just told the OS. Automatic runs therefore require wall
  // power. `refresh` is a person clicking regenerate — their machine, their
  // call — so it never reaches this check.
  //
  // Blocked is not failed: any stored digest still surfaces, and the fallback
  // is not persisted, so plugging in and reopening generates the real thing.
  if (!options.refresh) {
    const power = await heavyBackgroundWorkAllowedBlock()
    if (!power.allowed) {
      return existing
        ? { digest: existing, isAi: true }
        : { digest: buildFallbackDigest(session, parts, nextHash), isAi: false, blocked: power.reason }
    }
  }

  const av = await availability().catch(() => ({ available: false }))
  if (!av.available) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  await prepareSessionDigestInputBlock(session)
  const result = await runContract<ParsedSession, typeof sessionDigestContract.outputSchema>(
    sessionDigestContract,
    session,
    { scope: 'ai_activity' },
  )
  if (!result.ok || !result.value) {
    return existing
      ? { digest: existing, isAi: true }
      : { digest: buildFallbackDigest(session, parts, nextHash), isAi: false }
  }

  const output = result.value as unknown as SessionDigestOutput
  const digest: ProjectSessionDigest = {
    ...parts,
    title: output.title,
    summary: output.summary,
    source: String(session.source),
    msgCount: session.userMsgCount,
    durationMs: sessionDurationMs(session),
    activeDurationMs: session.activeDurationMs ?? 0,
    startedIso: session.startedIso,
    endedIso: session.endedIso ?? session.startedIso,
    hadClear: session.hadClear === true,
    inputHash: nextHash,
    generatedAt: new Date().toISOString(),
    model: (result.meta?.model as string) ?? 'unknown',
    generator: generationSourceForProviderBlock(result.providerId),
    // What actually ran, reported by the run itself — not the setting. A cache
    // hit is by definition a body produced under the same reasoning state, so
    // this is accurate on both paths.
    thinking: result.meta?.reasoning === 'on',
    // HUMAN field, carried across regeneration. AI rewrote the title and
    // summary; it does not get to forget who assigned this sitting to what.
    undertaking: existing?.undertaking ?? [],
    ...sessionPointers(session),
  }
  await putProjectSessionDigestBlock(digest)
  return { digest, isAi: true }
}

// ── Internals ──────────────────────────────────────────────────────────

interface SessionStorageParts {
  projectId: string
  sessionId: string
  path: string
  date: string
}

function sessionStorageParts(session: ParsedSession): SessionStorageParts | null {
  const date = isoDayLocalBlock(session.startedIso)
  if (!date || !isValidSessionDigestDateBlock(date)) return null
  const sessionId = sessionIdOf(session)
  if (!session.project || !sessionId) return null
  return { projectId: session.project, sessionId, path: session.path, date }
}

/**
 * Carry the session's file-edit provenance into the stored digest.
 *
 * Lifted from the transcript's structured Edit/Write/MultiEdit/NotebookEdit
 * tool calls, never inferred from prose — an index entry without pointers is a
 * memoir. Paths are stored vault-relative where possible so a pointer survives
 * a move to another machine; anything outside the vault stays absolute rather
 * than being guessed at.
 *
 * Note there is no `filesBySession` here, and there cannot be: the record IS
 * one session. That field existed on the chain digest purely to undo the
 * flattening a chain forced, and it is the clearest single sign that the
 * session was the right unit all along.
 */
function toVaultRelativeBlock(paths: readonly string[]): string[] {
  const vaultRoot = (getStoredVaultRoot() ?? '').replace(/\/+$/, '')
  return paths.map(path =>
    vaultRoot && path.startsWith(`${vaultRoot}/`) ? path.slice(vaultRoot.length + 1) : path,
  )
}

function sessionPointers(session: ParsedSession): { filesWritten: string[]; filesRead: string[] } {
  const written = toVaultRelativeBlock(session.touchedPaths ?? [])
  return {
    filesWritten: Array.from(new Set(written)).sort(),
    // Reads aren't captured by the native parser — it only tracks mutating
    // tools. Left empty rather than inferred from prose.
    filesRead: [],
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
 * Project a session's mechanical fields onto a stored digest.
 *
 * Mechanical fields are pure functions of the ParsedSession, so a reader
 * holding one simply recomputes them — there is no "has the stored copy
 * drifted?" to ask, hence no freshness hash over them and nothing to migrate.
 * The stored values are transport for devices that cannot see `~/.claude` at
 * all, not a cache to be kept in step.
 *
 * Model-derived (`title`, `summary`) fields are never touched — those are the
 * ones that genuinely cannot be recomputed.
 *
 * Absence is not zero. A device with no IPC to `~/.claude` parses sessions with
 * no `touchedPaths` and no per-message timing; overwriting good values synced
 * from Electron because *this* device is blind would be the one destructive
 * move available here. No value in hand → keep what is stored.
 */
export function projectSessionFieldsBlock(
  stored: ProjectSessionDigest,
  session: ParsedSession,
): ProjectSessionDigest {
  const next = { ...stored }

  if (session.touchedPaths && session.touchedPaths.length > 0) {
    const { filesWritten, filesRead } = sessionPointers(session)
    next.filesWritten = filesWritten
    if (filesRead.length > 0) next.filesRead = filesRead
  }
  // `Number.isFinite`, not `typeof === 'number'`: NaN is a number, and a NaN
  // from one malformed session would be written over a good stored value.
  const active = session.activeDurationMs
  if (typeof active === 'number' && Number.isFinite(active)) next.activeDurationMs = active
  if (session.startedIso) next.startedIso = session.startedIso
  if (session.endedIso ?? session.startedIso) next.endedIso = session.endedIso ?? session.startedIso
  next.hadClear = session.hadClear === true
  if (typeof session.userMsgCount === 'number' && Number.isFinite(session.userMsgCount)) {
    next.msgCount = session.userMsgCount
  }
  const duration = sessionDurationMs(session)
  if (duration > 0) next.durationMs = duration
  if (session.path) next.path = session.path
  const date = isoDayLocalBlock(session.startedIso)
  if (date && isValidSessionDigestDateBlock(date)) next.date = date

  return next
}

/** True when the projection would change what is on disk — the only reason to
 *  spend a write. Compared field-by-field rather than by deep-equal so the
 *  model-derived fields are provably excluded from the check. */
export function sessionFieldsDifferBlock(
  a: ProjectSessionDigest,
  b: ProjectSessionDigest,
): boolean {
  return (
    !sameStringSetBlock(a.filesWritten, b.filesWritten) ||
    !sameStringSetBlock(a.filesRead, b.filesRead) ||
    a.path !== b.path ||
    a.date !== b.date ||
    a.activeDurationMs !== b.activeDurationMs ||
    a.startedIso !== b.startedIso ||
    a.endedIso !== b.endedIso ||
    a.hadClear !== b.hadClear ||
    a.msgCount !== b.msgCount ||
    a.durationMs !== b.durationMs
  )
}

/**
 * Refresh the transport copy on disk when the derived truth has moved.
 *
 * Not a heal — the reader already has the right values from
 * `projectSessionFieldsBlock` and does not depend on this succeeding. The write
 * exists solely so a phone that cannot see `~/.claude` shows current data after
 * the vault syncs. Best-effort by construction.
 */
export async function refreshStoredSessionFieldsOrch(
  stored: ProjectSessionDigest,
  session: ParsedSession,
): Promise<ProjectSessionDigest> {
  const projected = projectSessionFieldsBlock(stored, session)
  if (!sessionFieldsDifferBlock(stored, projected)) return stored
  await putProjectSessionDigestBlock(projected).catch(() => undefined)
  return projected
}

function sessionDurationMs(session: ParsedSession): number {
  const start = Date.parse(session.startedIso)
  const end = Date.parse(session.endedIso ?? session.startedIso)
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
  session: ParsedSession,
  parts: SessionStorageParts,
  inputHash: string,
): ProjectSessionDigest {
  return {
    ...parts,
    title: session.topic || '(untitled)',
    // A reading sitting has no transcript, but it does have pages, canvas
    // places or scroll depth — all mechanically derived, none of it needing a
    // model. Without this the summary was empty and the expanded row showed a
    // timestamp with nothing under it.
    summary: session.readingDetail ?? '',
    source: String(session.source),
    msgCount: session.userMsgCount,
    durationMs: sessionDurationMs(session),
    activeDurationMs: session.activeDurationMs ?? 0,
    startedIso: session.startedIso,
    endedIso: session.endedIso ?? session.startedIso,
    hadClear: session.hadClear === true,
    inputHash,
    generatedAt: new Date().toISOString(),
    model: 'fallback:session-topic',
    thinking: false,
    undertaking: [],
    ...sessionPointers(session),
    // Rule-based fallback — deterministic, no model. Tagged so it is never
    // mistaken for AI output and never persisted (callers of this function
    // skip putProjectSessionDigestBlock).
    generator: 'rule-based',
  }
}

/**
 * Hash the inputs the digest depends on. Djb2 for speed; not crypto.
 *
 * Everything positional is deliberately excluded — nothing about which chain,
 * day, or range this session lands in may cost a provider call. That was the
 * chain digest's defect in miniature: its hash covered the whole chain window,
 * so a new sitting joining a chain re-derived every sitting already summarized.
 * A session's content is fixed once it ends, so this hash settles and stays
 * settled.
 *
 * `mtime` used to be in here and is the same defect a third time. A rollout file
 * splits into several windows, and every one of them carries the *file's* mtime
 * (`mtime: env.mtime` in the parser) — a file-level value in a window-level
 * hash. Appending one message to the window you are working in bumped the file
 * mtime and therefore invalidated every earlier window in that file, so a single
 * keystroke re-derived a morning's worth of finished sittings.
 *
 * What is left is window-scoped and content-derived: message count and the two
 * window bounds all move when this window's content moves, and hold still when
 * it does not. The narrow case this gives up is a rewrite that preserves the
 * count and both bounds exactly; a forced refresh covers it.
 */
export function computeSessionInputHashBlock(session: ParsedSession): string {
  const material = [
    String(session.userMsgCount),
    session.startedIso,
    session.endedIso ?? session.startedIso,
    sessionDigestContract.id,
    String(sessionDigestContract.promptVersion),
  ].join('\x00')
  let hash = 5381
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
