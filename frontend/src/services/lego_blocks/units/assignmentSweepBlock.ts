/**
 * Deciding what a parked assignment answer should do once the chain exists.
 *
 * `aiActivityAssignmentBlock` parks an answer — "this session belonged to these
 * undertakings" — keyed on session id, because the ask fires while the
 * conversation is live and the chain does not exist yet. This block is the other
 * end: given the parked answers and the chains that have since been generated,
 * decide what to stamp and what to hold for a person.
 *
 * Pure on purpose. This is the one place where an automated pass writes into
 * judgment fields, so the decision has to be inspectable in a test rather than
 * only observable as a vault mutation.
 *
 * Scope, so this file is not mistaken for the whole feature: parked answers are
 * *one* input to assignment, not the job. The sweep proper proposes over every
 * undisposed chain, including the hundreds that predate the in-session ask —
 * draining this directory alone would leave them untouched forever. See
 * [ASSIGNMENT.md](../../../../../docs/contracts/ASSIGNMENT.md).
 *
 * ## What may be automated, and what may not
 *
 * Attaching a session to an undertaking that already exists is reversible and
 * cheap to check: the worst case is one wrong pointer, visible in the index and
 * removed with one edit.
 *
 * Minting an undertaking is not. A new undertaking gets a key, and the key is an
 * address — sections file under it, chains point at it, and renaming it later
 * orphans every one of them. DERIVATION.md is blunt about this: derived data
 * must never be identity. So an answer naming an undertaking that does not exist
 * is held here rather than acted on, at any confidence, whether it is a
 * deliberate new one or a mid-session typo — the two are indistinguishable from
 * here, and guessing wrong makes the typo a permanent address. The mechanism
 * proposes; only a person commits.
 */

/** The fields of a chain digest this decision depends on. Narrow on purpose —
 *  the sweep should not be able to touch anything else. */
export interface SweepChainBlock {
  sessionId: string
  projectId: string
  /** `sessionIdOf` values: a uuid, or `<uuid>::<first-event-uuid>` for a
   *  windowed session. */
  sessions: string[]
  /** Undertaking keys already stamped on this chain. */
  undertaking: string[]
}

/** The parked answer, structurally identical to `PendingAssignment`. Restated
 *  rather than imported so this unit stays free of the vault-touching block. */
export interface SweepPendingBlock {
  sessionId: string
  undertakings: string[]
  newTitle?: string
  head?: string
  section?: string
  projectId?: string
  recordedAt: string
}

export interface SweepChainPatchBlock {
  sessionId: string
  projectId: string
  /** The full field to write — a union, never a replacement. */
  undertaking: string[]
}

/**
 * What to do with one parked answer.
 *
 * Note what is absent: there is no `clear`. The parked file is never deleted.
 * The hook runs twice per session, so clearing after the first run would leave
 * the second run's chain unstamped — but the deeper reason is that
 * session→undertaking is the durable fact and chain→undertaking is only its
 * projection. Chains are regenerable; a retained answer re-applies itself after
 * a rebuild. Stamping is a union, so re-running over a stamped chain is a no-op.
 * The ledger is the record, and there is nothing here to garbage-collect.
 */
export type SweepPlanBlock =
  /** Ready to stamp. */
  | {
      kind: 'apply'
      patches: SweepChainPatchBlock[]
      /** Head text the ask carried, for the primary undertaking. Applying it is
       *  conditional and the caller enforces that: write only into an empty
       *  head, otherwise append a dated note. `head` is a human field. */
      head: { undertaking: string; projectId: string; text: string } | null
    }
  /** The chain has not been generated yet. Normal, not an error — the render
   *  hook runs after the session ends, and a sweep can easily run in between.
   *  Also where an answer naming nothing lands: nothing to stamp, nothing to
   *  hold, and the chain still owes a disposition through the queue. */
  | { kind: 'wait'; reason: 'no-chain-yet' | 'nothing-named' }
  /** Names an undertaking that does not exist. Held for a person, never minted.
   *  One reason, not two: "brand new" and "misspelled" look identical here. */
  | { kind: 'hold'; reason: 'unknown-undertaking'; keys: string[] }

/**
 * A windowed session id (`<uuid>::<first-event-uuid>`) is the same session as
 * its root.
 *
 * Windows exist because one conversation can carry two topics, and the chain
 * layer splits them. For *assignment* that split is invisible: the ask is
 * answered mid-conversation, before any window boundary is known, so the answer
 * can only ever name the whole session. Matching on the root is what lets a
 * parked answer find the chain it produced.
 */
export function sessionRootBlock(sessionId: string): string {
  const cut = sessionId.indexOf('::')
  return cut === -1 ? sessionId : sessionId.slice(0, cut)
}

/** Every chain carrying this session, window splits included. */
export function chainsForSessionBlock(
  sessionId: string,
  chains: SweepChainBlock[],
): SweepChainBlock[] {
  const root = sessionRootBlock(sessionId)
  if (!root) return []
  return chains.filter(chain => chain.sessions.some(s => sessionRootBlock(s) === root))
}

/** Union preserving the order already on disk, so a re-run rewrites nothing. */
function unionBlock(existing: string[], incoming: string[]): string[] {
  const out = [...existing]
  const seen = new Set(existing)
  for (const key of incoming) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * Decide what a single parked answer should do.
 *
 * `knownUndertakings` is the set of keys that exist right now. Anything the
 * answer names that isn't in it is a hold, not a create — see the note above.
 */
export function planAssignmentBlock(
  pending: SweepPendingBlock,
  chains: SweepChainBlock[],
  knownUndertakings: ReadonlySet<string>,
): SweepPlanBlock {
  const wanted = pending.undertakings.map(k => k.trim()).filter(Boolean)
  if (!wanted.length) return { kind: 'wait', reason: 'nothing-named' }

  // Checked before the chain lookup: what needs a person is the minting, not
  // the timing, so a new key is held whether or not its chain has landed.
  const unknown = wanted.filter(key => !knownUndertakings.has(key))
  if (unknown.length) return { kind: 'hold', reason: 'unknown-undertaking', keys: unknown }

  const matched = chainsForSessionBlock(pending.sessionId, chains)
  if (!matched.length) return { kind: 'wait', reason: 'no-chain-yet' }

  const patches: SweepChainPatchBlock[] = []
  for (const chain of matched) {
    const next = unionBlock(chain.undertaking, wanted)
    // Skip chains that already carry every key — a sweep that rewrites
    // unchanged files churns iCloud and muddies "what did this pass do".
    if (next.length === chain.undertaking.length) continue
    patches.push({ sessionId: chain.sessionId, projectId: chain.projectId, undertaking: next })
  }

  const headText = pending.head?.trim() ?? ''
  const primary = wanted[0]
  // The project comes from the chain that was actually found, not from the
  // parked answer: the answer was written mid-session, before attribution ran,
  // so the chain is the later and better-informed witness.
  const projectId = matched[0]?.projectId ?? pending.projectId ?? ''

  return {
    kind: 'apply',
    patches,
    head: headText && primary && projectId ? { undertaking: primary, projectId, text: headText } : null,
  }
}

/**
 * Chains that still owe a disposition.
 *
 * This is the number the whole feature is judged by, and it is meant to go to
 * zero. A chain with no undertaking is not "noise we tolerated" — it is work
 * nobody has judged yet. Sessions that genuinely are not undertakings get said
 * so explicitly, by landing in the project's not-an-undertaking bucket, which is
 * an ordinary undertaking and therefore already excluded by this filter. Leaving
 * them blank instead would make this layer a second copy of the AI Activity
 * panel, which already shows every factual thing about a session.
 *
 * Computed by inspection every time, never stored: a count that persists is a
 * count that goes stale the moment anything is stamped.
 */
export function undisposedChainsBlock<T extends { undertaking: string[] }>(chains: T[]): T[] {
  return chains.filter(chain => !chain.undertaking.some(key => key.trim()))
}
