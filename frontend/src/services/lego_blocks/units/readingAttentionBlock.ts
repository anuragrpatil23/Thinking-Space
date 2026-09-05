// Attention accounting for a document that is on screen.
//
// Reading generates almost no events — you hold a page or a diagram and think —
// so "how long was this open" and "how long was this read" differ by however
// long you were away from the desk. This block credits time only between
// observed signs of presence, and never credits more than IDLE_CEILING_MS for
// any single gap, so a walk-away costs the ceiling rather than the whole
// absence.
//
// **Only signals are evidence.** Opening a document, switching apps, and
// closing a window are not signs that anyone read anything — they are things
// that happen *around* reading. An earlier version credited at those
// boundaries, on the theory that you were reading right up to the moment you
// switched away. For a document you actually close when you finish, that is
// true. For one left open in a pane while you work elsewhere, it mints five
// minutes per app switch out of nothing, which is exactly what a real span log
// showed: a book open overnight on two machines collected 5.4m on one and
// contributed to 45.2m on the other, with nobody awake.
//
// So a sitting's extent is [first signal, last signal] and nothing else. The
// unobserved tail between the last scroll and the close is dropped rather than
// guessed. Totals under-report by design.
//
// Deliberately timer-free. A repeating interval is the most reliable way to
// keep a CPU out of its deep idle states (docs/contracts/ENERGY.md), and the
// same numbers fall out of arithmetic performed whenever an event happens to
// arrive. Nothing here schedules anything — including the idle break, which is
// discovered retroactively by the next signal to arrive.
//
// Pure and immutable so the accounting can be tested without a DOM — the hook
// (useReadingAttentionBlock) owns every listener; this owns every decision.

export interface ReadingAttentionStateBlock {
  /**
   * Epoch ms the next credit measures from, or null when not accruing —
   * before the first observed signal, and after a suspension. A null here is
   * what makes arrival free: the first signal arms the clock without paying
   * for the time before it.
   */
  creditFromMs: number | null
  /** First observed signal, or null. The sitting's start bound. */
  firstEventMs: number | null
  /** Last observed signal, or null. The sitting's end bound. */
  lastEventMs: number | null
  /** Attention credited so far, in ms. */
  creditedMs: number
}

/**
 * Longest gap between two signs of presence that still counts as attention,
 * and — the same number wearing its other hat — the gap at which a sitting is
 * considered over rather than merely quiet.
 *
 * It bites in exactly one situation: the window kept focus and nothing fired.
 * That case is genuinely ambiguous — a page held still for eight minutes is
 * either deep reading or an empty chair, and no signal available to the
 * renderer separates them. Five minutes under-credits the reader and
 * over-credits the empty chair by the same bounded amount.
 */
export const IDLE_CEILING_MS = 5 * 60_000

/** Below this a sitting is a glance, not a reading session, and is dropped
 *  rather than logged. Totals under-report by design — every number the app
 *  shows should be one it actually observed. */
export const MIN_ATTENTION_MS = 60_000

/** A state that is already accruing from `nowMs`. For nested accounting —
 *  stations and page dwells — where the boundary IS an observed signal,
 *  because it was sampled during one. */
export function createReadingAttentionBlock(nowMs: number): ReadingAttentionStateBlock {
  return { creditFromMs: nowMs, firstEventMs: nowMs, lastEventMs: nowMs, creditedMs: 0 }
}

/** A state that has seen nothing yet. For a sitting, whose start is a mount
 *  rather than an observation. */
export function createPendingReadingAttentionBlock(): ReadingAttentionStateBlock {
  return { creditFromMs: null, firstEventMs: null, lastEventMs: null, creditedMs: 0 }
}

/**
 * Record a sign of presence: credit the gap since the last one and advance.
 *
 * The gap is clamped to `ceilingMs`, and a clock that jumped backwards credits
 * nothing rather than subtracting. When the state is not accruing — no signal
 * yet, or suspended — this only arms it, which is what keeps opening a
 * document and returning to one free.
 */
export function creditReadingAttentionBlock(
  state: ReadingAttentionStateBlock,
  nowMs: number,
  ceilingMs: number = IDLE_CEILING_MS,
): ReadingAttentionStateBlock {
  if (!Number.isFinite(nowMs)) return state
  const bounds = {
    firstEventMs: state.firstEventMs ?? nowMs,
    lastEventMs: nowMs,
  }
  if (state.creditFromMs === null) {
    return { ...bounds, creditFromMs: nowMs, creditedMs: state.creditedMs }
  }
  const gap = nowMs - state.creditFromMs
  const credited = gap > 0 ? Math.min(gap, ceilingMs) : 0
  return { ...bounds, creditFromMs: nowMs, creditedMs: state.creditedMs + credited }
}

/**
 * Stop accruing without ending the sitting — the window lost focus or was
 * hidden. The bounds are untouched, so the sitting still ends at the last
 * thing actually observed, and the next signal resumes from itself rather than
 * billing for the absence.
 */
export function suspendReadingAttentionBlock(
  state: ReadingAttentionStateBlock,
): ReadingAttentionStateBlock {
  if (state.creditFromMs === null) return state
  return { ...state, creditFromMs: null }
}

/**
 * Whether a signal arriving at `nowMs` belongs to a *different* sitting.
 *
 * A gap wider than the ceiling means the reader left and came back; the span
 * between them is not reading and must not be inside a record. Without this a
 * document left open overnight is one span, and — since a span is filed by the
 * day it started — the next day's real reading is swallowed into yesterday.
 * That is not a rounding error: a 945-minute record made an afternoon of
 * reading vanish from the day it happened on.
 */
export function isReadingSittingBreakBlock(
  state: ReadingAttentionStateBlock,
  nowMs: number,
  ceilingMs: number = IDLE_CEILING_MS,
): boolean {
  if (state.lastEventMs === null || !Number.isFinite(nowMs)) return false
  return nowMs - state.lastEventMs > ceilingMs
}

/** Whether a finished sitting is worth writing down. */
export function isReportableAttentionBlock(
  creditedMs: number,
  minMs: number = MIN_ATTENTION_MS,
): boolean {
  return Number.isFinite(creditedMs) && creditedMs >= minMs
}
