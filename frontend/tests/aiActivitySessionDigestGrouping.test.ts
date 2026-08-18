import { describe, expect, it } from 'vitest'
import {
  buildChains,
  groupChainableBlock,
  type ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  groupSessionDigestsBlock,
  type ProjectSessionDigest,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'

/**
 * The equivalence that lets chain-level files stop existing.
 *
 * `buildChains` groups live transcripts; `groupSessionDigestsBlock` groups
 * stored records. If those two can ever disagree, a phone (which only has
 * records) shows different sittings than the desktop (which has transcripts),
 * and the fix would be to ship a chain-shaped transport file — whose address
 * would have to be derived from the grouping, which is the exact defect
 * docs/contracts/DERIVATION.md exists to prevent.
 *
 * So this file pins that they agree. Both call `groupChainableBlock`; these
 * tests exist to keep it that way, and to catch an adapter that drops or
 * mistranslates one of the four inputs the algorithm reads.
 */

const T = (h: number, m = 0, d = 14) => new Date(Date.UTC(2026, 6, d, h, m)).toISOString()

function session(over: Partial<ParsedSession> & { path: string }): ParsedSession {
  return {
    source: 'claude-code',
    startedIso: T(10),
    endedIso: T(10, 30),
    project: 'F9',
    userMsgCount: 5,
    topic: 'a topic',
    hadClear: false,
    mtime: 0,
    ...over,
  } as ParsedSession
}

/** The digest that `ensureSessionDigestOrch` would write for `s`, restricted to
 *  the fields grouping actually reads. */
function digestFor(s: ParsedSession): ProjectSessionDigest {
  return {
    projectId: s.project,
    sessionId: s.path,
    path: s.path,
    date: s.startedIso.slice(0, 10),
    title: 'title',
    summary: 'summary',
    source: String(s.source),
    msgCount: s.userMsgCount,
    durationMs: 0,
    activeDurationMs: 0,
    startedIso: s.startedIso,
    endedIso: s.endedIso ?? s.startedIso,
    hadClear: s.hadClear === true,
    filesWritten: [],
    filesRead: [],
    inputHash: 'h',
    generatedAt: T(12),
    model: 'm',
    generator: 'local',
    // Neither is read by grouping, but both are required on the record — and a
    // fixture that is not a valid digest can drift from the real one silently.
    undertaking: [],
    thinking: false,
  }
}

/** Chain membership as a comparable shape, independent of which side built it. */
function fromSessions(sessions: ParsedSession[]): string[][] {
  return buildChains(sessions).map(c => c.sessions.map(s => s.path))
}

function fromDigests(sessions: ParsedSession[]): string[][] {
  return groupSessionDigestsBlock(sessions.map(digestFor)).map(g => g.map(d => d.sessionId))
}

function expectAgreement(sessions: ParsedSession[]): string[][] {
  const viaSessions = fromSessions(sessions)
  expect(fromDigests(sessions)).toEqual(viaSessions)
  return viaSessions
}

describe('session digests regroup into the same chains as live transcripts', () => {
  it('agrees on a simple in-gap merge', () => {
    const sessions = [
      session({ path: 'a', startedIso: T(10), endedIso: T(10, 30) }),
      session({ path: 'b', startedIso: T(11), endedIso: T(11, 30) }),
    ]
    expect(expectAgreement(sessions)).toEqual([['a', 'b']])
  })

  it('agrees on an idle-gap split', () => {
    const sessions = [
      session({ path: 'a', startedIso: T(2), endedIso: T(2, 30) }),
      session({ path: 'b', startedIso: T(20), endedIso: T(20, 30) }),
    ]
    expect(expectAgreement(sessions)).toEqual([['b'], ['a']])
  })

  it('agrees on a project split', () => {
    const sessions = [
      session({ path: 'a', project: 'F9' }),
      session({ path: 'b', project: 'Thinking-Space' }),
    ]
    expect(expectAgreement(sessions).map(g => g.length)).toEqual([1, 1])
  })

  it('agrees when a /clear closes a chain', () => {
    const sessions = [
      session({ path: 'a', startedIso: T(10), endedIso: T(10, 30), hadClear: true }),
      session({ path: 'b', startedIso: T(11), endedIso: T(11, 30) }),
    ]
    expect(expectAgreement(sessions)).toEqual([['b'], ['a']])
  })

  it('agrees on overlapping sessions from two terminals', () => {
    // A runs 10:00-12:00, B cuts in at 10:30, A resumes at 12:30. B overlaps A
    // so it breaks out; A's resumption rejoins A. The interleaving case that
    // motivated multiple open chains per project.
    const sessions = [
      session({ path: 'a1', startedIso: T(10), endedIso: T(12) }),
      session({ path: 'b1', startedIso: T(10, 30), endedIso: T(11) }),
      session({ path: 'a2', startedIso: T(12, 30), endedIso: T(13) }),
    ]
    expectAgreement(sessions)
  })

  it('agrees when zero-length rows would over-merge if measured end-to-start', () => {
    // Vault rows carry no end, so the gap must be measured start-to-start.
    const sessions = [
      session({ path: 'a', startedIso: T(10), endedIso: undefined }),
      session({ path: 'b', startedIso: T(10, 20), endedIso: undefined }),
    ]
    expectAgreement(sessions)
  })

  it('breaks ties deterministically for identical start instants', () => {
    // Same instant, supplied in reverse order: the tie-break must decide, not
    // the input order, or two devices reading the same vault disagree.
    const forward = [session({ path: 'a' }), session({ path: 'b' })]
    const reversed = [session({ path: 'b' }), session({ path: 'a' })]
    expect(fromDigests(forward)).toEqual(fromDigests(reversed))
    expect(fromDigests(forward)).toEqual(fromSessions(forward))
  })
})

describe('groupChainableBlock', () => {
  it('groups anything carrying the four inputs, not just sessions', () => {
    // The point of the generic: nothing session-shaped is required.
    const groups = groupChainableBlock([
      { project: 'p', startedIso: T(10), endedIso: T(10, 30), hadClear: false, chainSortKey: '1' },
      { project: 'p', startedIso: T(11), endedIso: T(11, 30), hadClear: false, chainSortKey: '2' },
      { project: 'p', startedIso: T(23), endedIso: T(23, 30), hadClear: false, chainSortKey: '3' },
    ])
    expect(groups.map(g => g.map(i => i.chainSortKey))).toEqual([['1', '2'], ['3']])
  })

  it('returns nothing for no input', () => {
    expect(groupChainableBlock([])).toEqual([])
  })
})
