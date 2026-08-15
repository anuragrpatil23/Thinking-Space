import { describe, expect, it } from 'vitest'
import {
  parseNativeAiSession,
  sessionIdOf,
} from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

/**
 * A window's id names the message it starts with, not its rank among windows.
 *
 * `::w1` was an ordinal — a *position*, the same class of value as the
 * `chainId` this stack was rebuilt to stop using as an address. An ordinal is
 * stable under append-only growth (a new idle gap can only open at the end of a
 * time-ordered file) but shifts whenever the windowing itself changes:
 * `IDLE_GAP_HOURS` moving, or Claude Code pruning events out of the middle of a
 * transcript.
 *
 * Title and summary survive a shift — the freshness hash covers window bounds
 * and message count, so they regenerate. `undertaking` does not: it is human
 * judgment, it is not recomputable, and sliding it onto a different span of work
 * is exactly the misattribution this refactor exists to prevent.
 *
 * These tests pin the two properties that matter, and the one constraint that
 * stops the fix from being applied to window 0.
 */

const HOUR = 3_600_000
const T0 = Date.parse('2026-08-14T09:00:00.000Z')

function ev(offsetMs: number, uuid: string, type: 'user' | 'assistant' = 'user') {
  return JSON.stringify({
    type,
    uuid,
    sessionId: 'sess-uuid-1',
    cwd: '/Users/me/code/F9',
    timestamp: new Date(T0 + offsetMs).toISOString(),
    message: { content: `body for ${uuid} — long enough to count as substantive text` },
  })
}

function parse(lines: string[]) {
  return parseNativeAiSession({
    source: 'claude',
    relPath: 'sess-uuid-1.jsonl',
    mtime: 0,
    text: lines.join('\n'),
  })
}

describe('window identity survives renumbering', () => {
  it('names each later window after its first event, not its index', () => {
    const sessions = parse([
      ev(0, 'evt-a'),
      ev(2 * HOUR, 'evt-b'), // gap > 1h → new window
      ev(4 * HOUR, 'evt-c'), // gap > 1h → new window
    ])

    expect(sessions).toHaveLength(3)
    expect(sessions.map(sessionIdOf)).toEqual([
      'sess-uuid-1', // window 0 keeps the bare id — see the dedup test below
      'sess-uuid-1::evt-b',
      'sess-uuid-1::evt-c',
    ])
  })

  it('keeps a window id stable when an EARLIER window splits in two', () => {
    // The renumbering case. Under `::wN` the final window is `w1` before and
    // `w2` after, so any assignment stamped on it silently moves to a different
    // sitting. Anchored to its first event, it does not move.
    const before = parse([
      ev(0, 'evt-a'),
      ev(10 * 60_000, 'evt-a2'), // same window as evt-a
      ev(4 * HOUR, 'evt-c'),
    ])
    const after = parse([
      ev(0, 'evt-a'),
      ev(2 * HOUR, 'evt-a2'), // the pause grew: this window now splits
      ev(4 * HOUR, 'evt-c'),
    ])

    expect(before).toHaveLength(2)
    expect(after).toHaveLength(3)

    // The final sitting is the same work in both parses, and keeps one id.
    const lastBefore = sessionIdOf(before[before.length - 1])
    const lastAfter = sessionIdOf(after[after.length - 1])
    expect(lastBefore).toBe('sess-uuid-1::evt-c')
    expect(lastAfter).toBe('sess-uuid-1::evt-c')
    expect(lastAfter).toBe(lastBefore)
  })

  it('keeps existing window ids stable when a new sitting is appended', () => {
    // The common case, which must also hold — appending is how files grow.
    const before = parse([ev(0, 'evt-a'), ev(2 * HOUR, 'evt-b')])
    const after = parse([ev(0, 'evt-a'), ev(2 * HOUR, 'evt-b'), ev(6 * HOUR, 'evt-d')])

    expect(sessionIdOf(after[0])).toBe(sessionIdOf(before[0]))
    expect(sessionIdOf(after[1])).toBe(sessionIdOf(before[1]))
    expect(sessionIdOf(after[2])).toBe('sess-uuid-1::evt-d')
  })
})

describe('window 0 keeps the bare session id', () => {
  it('so a vault-markdown row still dedups against its native twin', () => {
    // `aiActivityCacheBlock` collapses a vault session onto its native twin by
    // comparing FULL ids, and a vault row carries the plain uuid. Suffixing
    // window 0 would make every windowed session render twice. This is why the
    // anchoring above deliberately starts at window 1.
    const sessions = parse([ev(0, 'evt-a'), ev(2 * HOUR, 'evt-b')])

    expect(sessionIdOf(sessions[0])).toBe('sess-uuid-1')
    expect(sessionIdOf(sessions[0])).not.toContain('::')
  })

  it('and a single-window file is just the session, with no suffix at all', () => {
    const sessions = parse([ev(0, 'evt-a'), ev(10 * 60_000, 'evt-a2')])

    expect(sessions).toHaveLength(1)
    expect(sessionIdOf(sessions[0])).toBe('sess-uuid-1')
  })
})

describe('the root of a windowed id', () => {
  it('is still the session, so a parked answer naming the session finds it', () => {
    // `sessionRootBlock` splits on `::`. An event uuid contains no `::`, so the
    // root of `<uuid>::<event-uuid>` is still the session — which is what lets
    // an in-session assignment answer match every window it produced.
    const sessions = parse([ev(0, 'evt-a'), ev(2 * HOUR, 'evt-b')])
    const windowed = sessionIdOf(sessions[1])

    expect(windowed.split('::', 1)[0]).toBe('sess-uuid-1')
  })
})
