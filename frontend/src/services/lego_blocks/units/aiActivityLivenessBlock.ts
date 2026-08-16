// Is a session finished, or still being worked in?
//
// Nothing asked this before, and every derived layer paid for it. A session's
// input hash covers its message count, end time and mtime; a range summary's
// fingerprint covers chain durations. All three change on every message. So
// while you are actually working, the session you are in re-derives its digest
// on each view, and the range summary above it re-derives because that session's
// duration ticked — a treadmill that runs hardest exactly when the machine is
// busiest and produces a digest of a conversation that is not over.
//
// The rule: a session is *settled* once it has been quiet for a while. Derived
// layers regenerate from settled material and leave live material alone, so the
// work happens once, after the thing being described has stopped changing.
//
// This is a heuristic about wall-clock quiet, not a claim that the session is
// closed — nothing in a transcript says "done". A user-initiated refresh always
// overrides it, because a person asking for a digest of the conversation they
// are in the middle of is a legitimate request; a background loop deciding to do
// that fifty times is not.

/** Quiet period after which a session is treated as finished. Long enough to
 *  cover thinking pauses and tool runs inside one sitting, short enough that a
 *  session you walked away from is summarised while you still care. */
export const SESSION_SETTLE_MS = 10 * 60_000

/**
 * True when `lastActivityIso` is far enough in the past to treat the session as
 * finished. Unparseable or missing timestamps count as settled: an unknown time
 * is not evidence of activity, and treating it as live would suppress digests
 * forever on any source that does not report end times.
 */
export function isSettledBlock(lastActivityIso: string | undefined, now = Date.now()): boolean {
  if (!lastActivityIso) return true
  const t = Date.parse(lastActivityIso)
  if (!Number.isFinite(t)) return true
  // A timestamp in the future is a clock skew, not a live session.
  if (t > now) return true
  return now - t >= SESSION_SETTLE_MS
}

/** Inverse, for call sites that read better in the positive. */
export function isLiveBlock(lastActivityIso: string | undefined, now = Date.now()): boolean {
  return !isSettledBlock(lastActivityIso, now)
}
