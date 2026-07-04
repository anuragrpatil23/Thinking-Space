import {
  isValidAtomDateBlock,
  type ProjectDayAtom,
} from '@/services/lego_blocks/units/aiActivityAtomBlock'
import {
  getProjectDayAtomBlock,
  putProjectDayAtomBlock,
  listProjectDayAtomsInRangeBlock,
} from '@/services/lego_blocks/integrations/aiActivityAtomStoreBlock'

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
  const generated = await generateAtomStubBlock(input, nextHash)
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

/** Placeholder generator — returns a mechanical summary so the pipeline
 *  is exercisable end-to-end. Real prompt/model call lands next phase. */
async function generateAtomStubBlock(
  input: AtomGenerationInputBlock,
  inputHash: string,
): Promise<ProjectDayAtom | null> {
  if (input.sessionIds.length === 0) return null
  const count = input.sessionIds.length
  const headline = `${count} AI ${count === 1 ? 'session' : 'sessions'} on ${input.date}`
  const whyItMatters = input.previousAtomAnchor
    ? `Follows on from ${input.previousAtomAnchor.date}: "${input.previousAtomAnchor.headline}".`
    : ''
  return {
    projectId: input.projectId,
    date: input.date,
    headline,
    whyItMatters,
    nextSignal: '',
    confidence: 0.2, // low — this is a mechanical placeholder, not an LLM
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
  const anchor = input.previousAtomAnchor
    ? `${input.previousAtomAnchor.date}:${input.previousAtomAnchor.headline}`
    : ''
  const material = [
    input.projectId,
    input.date,
    sessionsPart,
    anchor,
    STUB_MODEL_ID,
  ].join('\x00')
  let hash = 5381
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
