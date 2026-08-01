import { describe, expect, it } from 'vitest'
import {
  buildChains,
  type ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'

/**
 * Characterization suite for `buildChains`.
 *
 * This function decides what a "logical session" is — it is the seam the whole
 * AI-activity stack sits on, and it had no tests at all, which is why it has
 * been quietly changed three times and broken something each time. Everything
 * below except the block marked THE DEFECT pins behaviour that is *correct
 * today* and must survive any rewrite.
 */

const T = (h: number, m = 0, d = 14) =>
  new Date(Date.UTC(2026, 6, d, h, m)).toISOString()

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

/** Chains as `key -> member paths`, order-insensitive, for readable asserts. */
function shape(sessions: ParsedSession[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const chain of buildChains(sessions)) {
    out[chain.key] = chain.sessions.map(s => s.path)
  }
  return out
}

describe('buildChains — grouping rules that must not change', () => {
  it('merges sessions in the same project within the gap', () => {
    expect(
      shape([
        session({ path: 'A', startedIso: T(10), endedIso: T(10, 30) }),
        session({ path: 'B', startedIso: T(10, 50), endedIso: T(11, 20) }),
      ]),
    ).toEqual({ 'F9::A': ['A', 'B'] })
  })

  it('splits when the idle gap exceeds an hour', () => {
    expect(
      shape([
        session({ path: 'A', startedIso: T(10), endedIso: T(10, 30) }),
        session({ path: 'B', startedIso: T(12), endedIso: T(12, 30) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'F9::B': ['B'] })
  })

  it('ignores topic entirely — it groups by project and time, never by subject', () => {
    expect(
      shape([
        session({ path: 'A', topic: 'refactor the parser' }),
        session({ path: 'B', topic: 'write the launch email', startedIso: T(10, 50), endedIso: T(11) }),
      ]),
    ).toEqual({ 'F9::A': ['A', 'B'] })
  })

  it('never merges across projects, however close in time', () => {
    expect(
      shape([
        session({ path: 'A', project: 'F9' }),
        session({ path: 'B', project: 'Thinking-Space', startedIso: T(10, 31), endedIso: T(11) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'Thinking-Space::B': ['B'] })
  })

  it('breaks the chain after a session containing /clear', () => {
    expect(
      shape([
        session({ path: 'A', hadClear: true }),
        session({ path: 'B', startedIso: T(10, 50), endedIso: T(11) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'F9::B': ['B'] })
  })

  it('splits concurrent sessions instead of absorbing the second', () => {
    // Two terminals on one project. Absorbing B would hide it from the
    // drill-down entirely — the row carries only the first session's topic.
    expect(
      shape([
        session({ path: 'A', startedIso: T(10), endedIso: T(12) }),
        session({ path: 'B', startedIso: T(10, 30), endedIso: T(11) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'F9::B': ['B'] })
  })

  it('does not over-merge zero-length sessions, which have no real end', () => {
    // Vault markdown rows: endedIso === startedIso. Gap is measured
    // start-to-start there rather than pretending the session was an instant.
    expect(
      shape([
        session({ path: 'A', startedIso: T(10), endedIso: T(10) }),
        session({ path: 'B', startedIso: T(11, 30), endedIso: T(11, 30) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'F9::B': ['B'] })
  })

  it('is insensitive to input order', () => {
    const sessions = [
      session({ path: 'B', startedIso: T(10, 50), endedIso: T(11, 20) }),
      session({ path: 'A', startedIso: T(10), endedIso: T(10, 30) }),
    ]
    expect(shape(sessions)).toEqual({ 'F9::A': ['A', 'B'] })
  })
})

describe('buildChains — chain aggregates that must not change', () => {
  it('sums message counts and spans the full window', () => {
    const [chain] = buildChains([
      session({ path: 'A', userMsgCount: 5, startedIso: T(10), endedIso: T(10, 30) }),
      session({ path: 'B', userMsgCount: 7, startedIso: T(10, 50), endedIso: T(11, 20) }),
    ])
    expect(chain.msgCount).toBe(12)
    expect(chain.startedIso).toBe(T(10))
    expect(chain.endedIso).toBe(T(11, 20))
  })

  it('unions file provenance across every member session', () => {
    const [chain] = buildChains([
      session({ path: 'A', touchedPaths: ['/v/one.md'] }),
      session({
        path: 'B',
        startedIso: T(10, 50),
        endedIso: T(11),
        touchedPaths: ['/v/two.md', '/v/one.md'],
      }),
    ])
    expect([...(chain.touchedPaths ?? [])].sort()).toEqual(['/v/one.md', '/v/two.md'])
  })

  it('leaves touchedPaths undefined when no session carried any', () => {
    // Absence must stay distinguishable from "wrote nothing" — the whole
    // no-stomp rule downstream depends on it.
    const [chain] = buildChains([session({ path: 'A' })])
    expect(chain.touchedPaths).toBeUndefined()
  })

  it('sums active duration, and leaves it undefined when nothing measured it', () => {
    const [measured] = buildChains([
      session({ path: 'A', activeDurationMs: 1000 }),
      session({ path: 'B', startedIso: T(10, 50), endedIso: T(11), activeDurationMs: 500 }),
    ])
    expect(measured.activeDurationMs).toBe(1500)

    const [unmeasured] = buildChains([session({ path: 'A' })])
    expect(unmeasured.activeDurationMs).toBeUndefined()
  })

  it('lifts the topic past a label-only or empty head session', () => {
    const [chain] = buildChains([
      session({ path: 'A', topic: '[auto]' }),
      session({ path: 'B', startedIso: T(10, 50), endedIso: T(11), topic: 'the real question' }),
    ])
    expect(chain.topic).toBe('the real question')

    const [none] = buildChains([
      session({ path: 'A', topic: '(no user message)' }),
      session({ path: 'B', startedIso: T(10, 50), endedIso: T(11), topic: 'the real question' }),
    ])
    expect(none.topic).toBe('the real question')
  })

  it('keeps a substantive head topic rather than reaching past it', () => {
    const [chain] = buildChains([
      session({ path: 'A', topic: 'the first real question' }),
      session({ path: 'B', startedIso: T(10, 50), endedIso: T(11), topic: 'a later one' }),
    ])
    expect(chain.topic).toBe('the first real question')
  })

  it('returns chains newest first', () => {
    const chains = buildChains([
      session({ path: 'A', startedIso: T(10), endedIso: T(10, 30) }),
      session({ path: 'B', startedIso: T(14), endedIso: T(14, 30) }),
    ])
    expect(chains.map(c => c.key)).toEqual(['F9::B', 'F9::A'])
  })

  it('returns [] for no sessions', () => {
    expect(buildChains([])).toEqual([])
  })
})

describe('buildChains — several chains open at once on one project', () => {
  it('rejoins a long-running thread after a parallel session interrupts it', () => {
    // A1 runs 10:00-12:00. B runs in another terminal 10:30-11:00 and correctly
    // breaks out. A2 resumes the original thread at 12:30, half an hour after
    // A1 ended — well inside the gap.
    //
    // The old algorithm kept a single open chain per project, so breaking out B
    // *closed A1 and forgot it*, and A2 could never rejoin. A thread that got
    // interleaved even once was permanently unresumable.
    expect(
      shape([
        session({ path: 'A1', startedIso: T(10), endedIso: T(12) }),
        session({ path: 'B', startedIso: T(10, 30), endedIso: T(11) }),
        session({ path: 'A2', startedIso: T(12, 30), endedIso: T(13) }),
      ]),
    ).toEqual({ 'F9::A1': ['A1', 'A2'], 'F9::B': ['B'] })
  })

  it('does not let a /clear in a parallel session break an unrelated chain', () => {
    // The old `lastBreaker` was read from whichever session came last in the
    // flat list, so clearing in terminal B severed terminal A's chain.
    expect(
      shape([
        session({ path: 'A1', startedIso: T(10), endedIso: T(11) }),
        session({ path: 'B', startedIso: T(10, 30), endedIso: T(10, 45), hadClear: true }),
        session({ path: 'A2', startedIso: T(11, 30), endedIso: T(12) }),
      ]),
    ).toEqual({ 'F9::A1': ['A1', 'A2'], 'F9::B': ['B'] })
  })

  it('still retires a chain once the gap passes, even with another open', () => {
    // Resumability is bounded by the same idle rule as everything else — an
    // open chain is not open forever just because a sibling kept the project
    // busy. A1 ends at 11:00; A2 at 13:00 is two hours late and starts fresh.
    expect(
      shape([
        session({ path: 'A1', startedIso: T(10), endedIso: T(11) }),
        session({ path: 'B', startedIso: T(10, 30), endedIso: T(12, 30) }),
        session({ path: 'A2', startedIso: T(13), endedIso: T(13, 30) }),
      ]),
    ).toEqual({ 'F9::A1': ['A1'], 'F9::B': ['B', 'A2'] })
  })

  it('joins the chain that was active most recently, not the oldest one', () => {
    // Both A and B are joinable at 12:10. B ended at 12:00, A at 11:00, so the
    // user was last working in B — that is the thread they are continuing.
    expect(
      shape([
        session({ path: 'A', startedIso: T(10), endedIso: T(11) }),
        session({ path: 'B', startedIso: T(10, 30), endedIso: T(12) }),
        session({ path: 'C', startedIso: T(12, 10), endedIso: T(12, 30) }),
      ]),
    ).toEqual({ 'F9::A': ['A'], 'F9::B': ['B', 'C'] })
  })

  it('keeps parallel threads on separate projects independent', () => {
    expect(
      shape([
        session({ path: 'A1', project: 'F9', startedIso: T(10), endedIso: T(12) }),
        session({ path: 'X', project: 'TS', startedIso: T(10, 30), endedIso: T(11) }),
        session({ path: 'A2', project: 'F9', startedIso: T(12, 30), endedIso: T(13) }),
      ]),
    ).toEqual({ 'F9::A1': ['A1', 'A2'], 'TS::X': ['X'] })
  })
})
