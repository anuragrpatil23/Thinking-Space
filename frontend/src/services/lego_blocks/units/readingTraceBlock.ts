// Why a reading span did or didn't get written.
//
// The writer is best-effort by design — a logging failure must never disrupt
// the viewer — but "swallow every error" and "nothing was written" are
// indistinguishable from outside, which is exactly the position this feature
// put us in the first time it produced no rows. Errors that cannot be observed
// are errors that cannot be fixed.
//
// So the writer still never throws, and now it always says what happened. A
// bounded ring buffer, no timers, nothing retained beyond the last few dozen
// events. Read it from the app's console:
//
//   __thinkspc_reading.dump()      // recent outcomes, newest last
//   __thinkspc_reading.live()      // the sitting being measured right now
//
// The buffer is mirrored to localStorage, which is the one thing the original
// version got wrong: this class of bug plays out over hours and survives
// relaunches, and a memory-only buffer is empty exactly when you finally go
// looking. A sitting that stayed alive for three hours after its document was
// closed left no evidence of what kept it alive, and a second relaunch is not
// a reason to lose the answer a third time. Bounded and written on the same
// events the journal already checkpoints on, so it costs no new wakeups.

export type ReadingTraceOutcome =
  | 'sitting-started'
  | 'sitting-ended'
  | 'below-floor'
  | 'gate-blocked'
  | 'wrote'
  | 'merged'
  | 'unchanged'
  | 'error'

export interface ReadingTraceEntry {
  at: string
  outcome: ReadingTraceOutcome
  path?: string
  activeMs?: number
  file?: string
  detail?: string
  /**
   * The inputs that decide whether a document is being read, captured at the
   * moment a sitting starts and again when it ends.
   *
   * Without this, "the sitting restarted" and "the sitting never ended" are the
   * same line in the log, and which input flipped is unknowable after the fact.
   * Two records sharing a boundary millisecond say the effect re-ran; only
   * these say why.
   */
  inputs?: Record<string, unknown>
}

const MAX_ENTRIES = 60
const TRACE_KEY = 'ltm-reading-trace'

/** Rehydrate on load so the entries from before a relaunch are still there. */
function loadPersisted(): ReadingTraceEntry[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(TRACE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ReadingTraceEntry[]).slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TRACE_KEY, JSON.stringify(entries))
  } catch {
    // A full store must not break reading. Losing the trace is survivable;
    // throwing out of a logging call is not.
  }
}

const entries: ReadingTraceEntry[] = loadPersisted()

/** Live state of the sitting currently being measured, if any. Written by the
 *  hook so the console can answer "is it even counting right now". */
let live: Record<string, unknown> | null = null

export function traceReadingBlock(entry: Omit<ReadingTraceEntry, 'at'>): void {
  entries.push({ at: new Date().toISOString(), ...entry })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  persist()
}

export function setReadingLiveStateBlock(state: Record<string, unknown> | null): void {
  live = state
}

export function readReadingTraceBlock(): ReadingTraceEntry[] {
  return [...entries]
}

export function readReadingLiveStateBlock(): Record<string, unknown> | null {
  return live
}

export function resetReadingTraceBlock(): void {
  entries.length = 0
  live = null
  persist()
}

/** Attach the console handle. Called once from the app entry; harmless if the
 *  runtime has no window (tests, node). */
export function installReadingTraceConsoleBlock(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__thinkspc_reading = {
    dump: () => readReadingTraceBlock(),
    live: () => readReadingLiveStateBlock(),
    reset: () => resetReadingTraceBlock(),
  }
}
