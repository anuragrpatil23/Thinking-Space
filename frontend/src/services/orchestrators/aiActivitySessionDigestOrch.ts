import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
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
): Promise<{ digest: ProjectSessionDigest; isAi: boolean } | null> {
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
    summary: '',
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
 */
function computeSessionInputHashBlock(session: ParsedSession): string {
  const material = [
    String(session.userMsgCount),
    session.startedIso,
    session.endedIso ?? session.startedIso,
    String(session.mtime),
    sessionDigestContract.id,
    String(sessionDigestContract.promptVersion),
  ].join('\x00')
  let hash = 5381
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
