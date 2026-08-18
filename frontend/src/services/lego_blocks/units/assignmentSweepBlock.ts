/**
 * The two facts a disposition sweep needs about a session.
 *
 * ## What used to be here
 *
 * This file was the other half of `ai-activity/pending-assignments/`: pure
 * decision logic that turned a parked in-session answer into a stamp, with
 * `planAssignmentBlock` deciding what to apply, what to hold for a human, and
 * what to wait on. It was careful code and it never ran once — the directory it
 * drained had a writer and no reader, so the plan it computed had no input, and
 * every answer an agent ever gave about its own work sat in a file nothing
 * opened.
 *
 * It is deleted rather than wired up because the case it existed to handle no
 * longer exists. An in-session answer is now written as an ordinary proposal
 * (`recordAssignmentOrch`), so it reaches a person through the queue — the same
 * path every other claim takes. Its careful rule about minting survives where it
 * belongs, at the write: a key naming no undertaking is refused unless a
 * `newTitle` justifies it, because a typo and a deliberate mint are
 * indistinguishable and only one is safe to act on.
 *
 * Contract: [ASSIGNMENT.md](../../../../../docs/contracts/ASSIGNMENT.md).
 */

/**
 * A windowed session id (`<uuid>::<first-event-uuid>`) reduced to its root.
 *
 * Windows exist because one conversation can carry two topics, and the chain
 * layer splits them. For *assignment* that split is invisible: the ask is
 * answered mid-conversation, before any window boundary is known, so the answer
 * can only ever name the whole session.
 *
 * Kept as the written-down statement of that rule — the window-identity tests
 * reason about it by name when they check that an id chosen as a window anchor
 * cannot itself contain a `::`.
 */
export function sessionRootBlock(sessionId: string): string {
  const cut = sessionId.indexOf('::')
  return cut === -1 ? sessionId : sessionId.slice(0, cut)
}

/**
 * Sessions that still owe a disposition.
 *
 * A session is disposed when it carries at least one undertaking key — and
 * "not an undertaking" is a key like any other, pointing at the project's
 * bucket record, so a judged-as-noise session is *not* undisposed. Leaving
 * noise blank instead would make this layer a second copy of the AI Activity
 * panel, which already shows every factual thing about a session; the point of
 * this layer is the judgement.
 *
 * Computed by inspection every time, never stored: a count that persists is a
 * count that goes stale the moment anything is stamped.
 */
export function undisposedChainsBlock<T extends { undertaking: string[] }>(chains: T[]): T[] {
  return chains.filter(chain => !chain.undertaking.some(key => key.trim()))
}
