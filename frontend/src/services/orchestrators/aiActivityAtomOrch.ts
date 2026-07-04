import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  isValidAtomDateBlock,
  type ProjectDayAtom,
} from '@/services/lego_blocks/units/aiActivityAtomBlock'
import {
  getProjectDayAtomBlock,
  putProjectDayAtomBlock,
  listProjectDayAtomsInRangeBlock,
} from '@/services/lego_blocks/integrations/aiActivityAtomStoreBlock'
import {
  ensureChainDigestOrch,
  loadChainDigestOrch,
} from '@/services/orchestrators/aiActivityChainDigestOrch'
import { availability, runContract } from '@/services/orchestrators/intelligenceOrch'
import { intelligenceCacheAvailableBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import { getAiActivityAiTitlesEnabled } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  dayAtomContract,
  type DayAtomContractInput,
  type DayAtomOutput,
} from '@/services/lego_blocks/units/intelligence/contracts/dayAtomContractBlock'

// Public surface for the project-day atom pipeline. Callers (This Week card,
// scheduled sealing routines, future insight surfaces) go through here —
// they never talk to the store or the generator directly, so we can swap
// the stubbed generator for a real intelligenceOrch contract without
// touching the call sites.

/** Minimal input the generator needs. Kept schema-light on purpose — the
 *  real contract lands next phase; we just need enough surface here to
 *  compute a stable inputHash and to exercise the read/write pipeline. */
export interface AtomGenerationInputBlock {
  projectId: string
  date: string
  /** Stable ids of sessions attributed to this project on this day. */
  sessionIds: string[]
  /** Optional per-session content hash (from vault stat / native mtime).
   *  Lets us detect edits to a previously-seen session without
   *  re-parsing the transcript. Same order as sessionIds. */
  sessionHashes?: string[]
  /** Per-chain digests (title + summary) covering this day's chains for the
   *  project. Populated when the intelligence subsystem is available; empty
   *  when it isn't (the generator degrades to session-id-count summaries). */
  chainDigests?: Array<{
    chainKey: string
    title: string
    summary: string
    durationMs: number
  }>
  /** Previous day's atom (headline only is fine) — anchors narrative flow
   *  so the generator can reference "yesterday you were…". */
  previousAtomAnchor?: {
    date: string
    headline: string
  }
}

/**
 * Ensure an atom exists for (projectId, date) and reflects the current
 * inputs. Returns the atom; regenerates if the inputHash doesn't match.
 * Never throws — a generator failure returns the stale atom (if any) or
 * null so the UI can render the day as "no digest yet".
 */
export async function ensureAtomForDayOrch(
  input: AtomGenerationInputBlock,
): Promise<ProjectDayAtom | null> {
  if (!input.projectId || !isValidAtomDateBlock(input.date)) return null
  const nextHash = computeInputHashBlock(input)
  const existing = await getProjectDayAtomBlock(input.projectId, input.date)
  if (existing && existing.inputHash === nextHash && existing.sealed === isSealedDate(input.date)) {
    return existing
  }
  // Try the AI contract first; fall through to the stub when the
  // intelligence subsystem is unavailable or the contract discards output.
  const generated =
    (await generateAtomViaContractBlock(input, nextHash).catch(() => null)) ??
    (await generateAtomStubBlock(input, nextHash))
  if (!generated) return existing ?? null
  await putProjectDayAtomBlock(generated)
  return generated
}

/** Convenience for the This Week / Set card: read a range of atoms for a
 *  project, generating any that are missing given the passed-in inputs.
 *  Days with no sessions are skipped — no atom is generated for empty
 *  days so the "silent day" reads as silent in the UI. */
export async function ensureAtomsForRangeOrch(
  inputsByDate: Map<string, AtomGenerationInputBlock>,
): Promise<ProjectDayAtom[]> {
  const out: ProjectDayAtom[] = []
  for (const [, input] of inputsByDate) {
    if (input.sessionIds.length === 0) continue
    const atom = await ensureAtomForDayOrch(input)
    if (atom) out.push(atom)
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Read-only variant — no generation, just fetch what's already stored.
 *  Used by surfaces that render the historical timeline without wanting
 *  to trigger LLM calls (e.g. flipping through past weeks). */
export async function loadAtomsForRangeOrch(
  projectId: string,
  fromDate: string,
  toDate: string,
): Promise<ProjectDayAtom[]> {
  return listProjectDayAtomsInRangeBlock(projectId, fromDate, toDate)
}

// ── Internals ──────────────────────────────────────────────────────────

const STUB_MODEL_ID = 'ai-activity-atom:stub@v1'

/** AI contract path — composes chain digests into a single-day atom via
 *  the day-atom contract on whatever intelligence provider is configured.
 *  Returns null when the subsystem is unavailable, the contract discards
 *  output, or there are no chain digests to compose (empty input). The
 *  caller falls through to the stub for null returns. */
async function generateAtomViaContractBlock(
  input: AtomGenerationInputBlock,
  inputHash: string,
): Promise<ProjectDayAtom | null> {
  if (!input.chainDigests || input.chainDigests.length === 0) return null
  if (!intelligenceCacheAvailableBlock()) return null
  // User-controlled kill switch — mirrors the chain-digest orchestrator so
  // the day-atom pipeline also falls back to the stub when AI titles are off.
  if (!getAiActivityAiTitlesEnabled()) return null
  const av = await availability().catch(() => ({ available: false }))
  if (!av.available) return null

  const contractInput: DayAtomContractInput = {
    projectId: input.projectId,
    date: input.date,
    chainDigests: input.chainDigests,
    previousAtomAnchor: input.previousAtomAnchor,
  }
  const result = await runContract<DayAtomContractInput, typeof dayAtomContract.outputSchema>(
    dayAtomContract,
    contractInput,
  )
  if (!result.ok || !result.value) return null

  const output = result.value as unknown as DayAtomOutput
  // Confidence is a function of coverage: how many chains got real digests
  // vs. how many sessions existed on the day. Half-covered days still
  // render; fully-covered days get a clearer signal in the UI.
  const digestCoverage = input.chainDigests.length / Math.max(1, input.sessionIds.length)
  const confidence = Math.min(1, 0.5 + 0.5 * digestCoverage)
  return {
    projectId: input.projectId,
    date: input.date,
    headline: output.headline,
    whyItMatters: output.whyItMatters,
    confidence,
    sealed: isSealedDate(input.date),
    inputHash,
    generatedAt: new Date().toISOString(),
    model: result.model ?? 'unknown',
  }
}

/** Fallback generator — composes chain-digest titles when available, or
 *  falls back to a mechanical session-count summary. Runs when the AI
 *  contract path is unavailable or returns null. */
async function generateAtomStubBlock(
  input: AtomGenerationInputBlock,
  inputHash: string,
): Promise<ProjectDayAtom | null> {
  if (input.sessionIds.length === 0) return null

  const digests = input.chainDigests ?? []
  let headline: string
  let whyItMatters = ''

  if (digests.length > 0) {
    // Rank by duration desc; use the top titles as the headline, first
    // summary as the why-it-matters. Trivial composition, but at least
    // renders real chain-level content instead of a session count.
    const ranked = [...digests].sort((a, b) => b.durationMs - a.durationMs)
    const topTitles = ranked.slice(0, 2).map(d => d.title).filter(Boolean)
    headline = topTitles.length ? topTitles.join(' · ') : `${input.sessionIds.length} sessions on ${input.date}`
    const firstSummary = ranked.find(d => d.summary)?.summary
    if (firstSummary) whyItMatters = firstSummary
  } else {
    const count = input.sessionIds.length
    headline = `${count} AI ${count === 1 ? 'session' : 'sessions'} on ${input.date}`
  }

  if (input.previousAtomAnchor && !whyItMatters) {
    whyItMatters = `Follows on from ${input.previousAtomAnchor.date}: "${input.previousAtomAnchor.headline}".`
  }

  return {
    projectId: input.projectId,
    date: input.date,
    headline,
    whyItMatters,
    confidence: digests.length > 0 ? 0.5 : 0.2,
    sealed: isSealedDate(input.date),
    inputHash,
    generatedAt: new Date().toISOString(),
    model: STUB_MODEL_ID,
  }
}

function todayLocalIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isSealedDate(dateStr: string): boolean {
  return dateStr < todayLocalIso()
}

/** Stable hash of the generator inputs. Djb2 — no crypto needed for a
 *  cache invalidation signal, we just want deterministic + fast + short. */
function computeInputHashBlock(input: AtomGenerationInputBlock): string {
  const sessionsPart = input.sessionIds
    .map((id, i) => `${id}:${input.sessionHashes?.[i] ?? ''}`)
    .sort()
    .join('|')
  const digestsPart = (input.chainDigests ?? [])
    .map(d => `${d.chainKey}:${d.title}:${d.summary}`)
    .sort()
    .join('|')
  const anchor = input.previousAtomAnchor
    ? `${input.previousAtomAnchor.date}:${input.previousAtomAnchor.headline}`
    : ''
  const material = [
    input.projectId,
    input.date,
    sessionsPart,
    digestsPart,
    anchor,
    // Bumping the contract's promptVersion invalidates every atom that
    // depends on it — same policy as chainDigest. The stub-model tag is
    // included as a stable suffix so switching the fallback shape also
    // busts cache without touching the contract.
    `${dayAtomContract.id}#v${dayAtomContract.promptVersion}`,
    STUB_MODEL_ID,
  ].join('\x00')
  let hash = 5381
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * Build an atom-generation input from a project's chains for a single day.
 * Runs the chain-digest orchestrator for each chain first — `ensure` when
 * the intelligence subsystem is likely to succeed, `load` (read-only) for
 * bulk range operations where blocking on model calls per chain is too
 * expensive. The returned input carries whichever digests were resolvable.
 */
export async function buildAtomInputForDayOrch(
  projectId: string,
  date: string,
  chains: ActivityChain[],
  options: { generateMissing?: boolean; previousAtomAnchor?: AtomGenerationInputBlock['previousAtomAnchor'] } = {},
): Promise<AtomGenerationInputBlock> {
  const digests: NonNullable<AtomGenerationInputBlock['chainDigests']> = []
  const sessionIds: string[] = []
  for (const chain of chains) {
    sessionIds.push(chain.key)
    const result = options.generateMissing
      ? await ensureChainDigestOrch(chain).catch(() => null)
      : { digest: await loadChainDigestOrch(chain).catch(() => null), isAi: true }
    const digest = result?.digest
    if (!digest) continue
    digests.push({
      chainKey: digest.chainKey,
      title: digest.title,
      summary: digest.summary,
      durationMs: digest.durationMs,
    })
  }
  return {
    projectId,
    date,
    sessionIds,
    chainDigests: digests,
    previousAtomAnchor: options.previousAtomAnchor,
  }
}
