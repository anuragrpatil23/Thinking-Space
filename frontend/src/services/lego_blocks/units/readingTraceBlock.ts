// Why a reading span did or didn't get written.
//
// The writer is best-effort by design — a logging failure must never disrupt
// the viewer — but "swallow every error" and "nothing was written" are
// indistinguishable from outside, which is exactly the position this feature
// put us in the first time it produced no rows. Errors that cannot be observed
// are errors that cannot be fixed.
//
// So the writer still never throws, and now it always says what happened. A
// bounded ring buffer, no timers, no I/O, nothing retained beyond the last few
// dozen events. Read it from the app's console:
//
//   __thinkspc_reading.dump()      // recent outcomes, newest last
//   __thinkspc_reading.live()      // the sitting being measured right now

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
}

const MAX_ENTRIES = 60
const entries: ReadingTraceEntry[] = []

/** Live state of the sitting currently being measured, if any. Written by the
 *  hook so the console can answer "is it even counting right now". */
let live: Record<string, unknown> | null = null

export function traceReadingBlock(entry: Omit<ReadingTraceEntry, 'at'>): void {
  entries.push({ at: new Date().toISOString(), ...entry })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
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
