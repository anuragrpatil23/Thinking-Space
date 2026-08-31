// Attention accounting for a document that is on screen.
//
// Reading generates almost no events — you hold a page or a diagram and think —
// so "how long was this open" and "how long was this read" differ by however
// long you were away from the desk. This block credits time only between
// observed signs of presence, and never credits more than IDLE_CEILING_MS for
// any single gap, so a walk-away costs the ceiling rather than the whole
// absence.
//
// Deliberately timer-free. A repeating interval is the most reliable way to
// keep a CPU out of its deep idle states (docs/contracts/ENERGY.md), and the
// same numbers fall out of arithmetic performed whenever an event happens to
// arrive. Nothing here schedules anything.
//
// Pure and immutable so the accounting can be tested without a DOM — the hook
// (useReadingAttentionBlock) owns every listener; this owns every decision.

export interface ReadingAttentionStateBlock {
  /** Epoch ms of the last processed sign of presence. */
  lastEventMs: number
  /** Attention credited so far, in ms. */
  creditedMs: number
}

/**
 * Longest gap between two signs of presence that still counts as attention.
 *
 * This is the only judgement call in the block, and it bites in exactly one
 * situation: the window kept focus and nothing fired. That case is genuinely
 * ambiguous — a page held still for eight minutes is either deep reading or an
 * empty chair, and no signal available to the renderer separates them. Five
 * minutes under-credits the reader and over-credits the empty chair by the
 * same bounded amount.
 *
 * Every *other* walk-away is caught by a real signal instead: switching apps
 * blurs the window, switching tabs hides the document, and both credit the
 * true elapsed time and then freeze.
 */
export const IDLE_CEILING_MS = 5 * 60_000

/** Below this a sitting is a glance, not a reading session, and is dropped
 *  rather than logged. Totals under-report by design — every number the app
 *  shows should be one it actually observed. */
export const MIN_ATTENTION_MS = 60_000

export function createReadingAttentionBlock(nowMs: number): ReadingAttentionStateBlock {
  return { lastEventMs: nowMs, creditedMs: 0 }
}

/**
 * Credit the gap since the last signal and advance. The gap is clamped to
 * `ceilingMs`, and a clock that jumped backwards credits nothing rather than
 * subtracting.
 */
export function creditReadingAttentionBlock(
  state: ReadingAttentionStateBlock,
  nowMs: number,
  ceilingMs: number = IDLE_CEILING_MS,
): ReadingAttentionStateBlock {
  if (!Number.isFinite(nowMs)) return state
  const gap = nowMs - state.lastEventMs
  const credited = gap > 0 ? Math.min(gap, ceilingMs) : 0
  return {
    lastEventMs: nowMs,
    creditedMs: state.creditedMs + credited,
  }
}

/**
 * Advance without crediting — the user has just come back. Attention resumes
 * from now, so the time spent away contributes nothing regardless of how the
 * absence ended.
 */
export function resumeReadingAttentionBlock(
  state: ReadingAttentionStateBlock,
  nowMs: number,
): ReadingAttentionStateBlock {
  if (!Number.isFinite(nowMs)) return state
  return { lastEventMs: nowMs, creditedMs: state.creditedMs }
}

/** Whether a finished sitting is worth writing down. */
export function isReportableAttentionBlock(
  creditedMs: number,
  minMs: number = MIN_ATTENTION_MS,
): boolean {
  return Number.isFinite(creditedMs) && creditedMs >= minMs
}
