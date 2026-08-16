import { describe, it, expect } from 'vitest'
import {
  SESSION_SETTLE_MS,
  isLiveBlock,
  isSettledBlock,
} from '../src/services/lego_blocks/units/aiActivityLivenessBlock'
import type { ParsedSession } from '../src/services/lego_blocks/units/aiActivityParserBlock'
import { computeSessionInputHashBlock } from '../src/services/orchestrators/aiActivitySessionDigestOrch'
import {
  computeRangeContentFingerprintBlock,
  computeRangeDigestFingerprintBlock,
} from '../src/services/lego_blocks/units/aiActivityRangeSummaryBlock'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

describe('isSettledBlock', () => {
  it('treats a session quiet longer than the settle window as finished', () => {
    expect(isSettledBlock(iso(SESSION_SETTLE_MS + 1_000), NOW)).toBe(true)
    expect(isLiveBlock(iso(SESSION_SETTLE_MS + 1_000), NOW)).toBe(false)
  })

  it('treats a session touched moments ago as live', () => {
    expect(isSettledBlock(iso(30_000), NOW)).toBe(false)
    expect(isLiveBlock(iso(30_000), NOW)).toBe(true)
  })

  // Absence must not read as activity: sources without end times would
  // otherwise never produce a digest at all.
  it('treats missing and unparseable timestamps as settled', () => {
    expect(isSettledBlock(undefined, NOW)).toBe(true)
    expect(isSettledBlock('not a date', NOW)).toBe(true)
  })

  it('treats a future timestamp as clock skew, not activity', () => {
    expect(isSettledBlock(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true)
  })
})

describe('range fingerprints ignore live chains', () => {
  // The regression this exists to prevent: a session being worked in grows its
  // duration on every message, which used to change the fingerprint and
  // regenerate the whole range summary each time.
  it('is stable while a live chain grows', () => {
    const before = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 60_000, settled: true },
      { chainKey: 'b', date: '2026-08-16', durationMs: 120_000, settled: false },
    ])
    const after = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 60_000, settled: true },
      { chainKey: 'b', date: '2026-08-16', durationMs: 900_000, settled: false },
    ])
    expect(after).toBe(before)
  })

  it('still changes when a settled chain changes', () => {
    const before = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 60_000, settled: true },
    ])
    const after = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 90_000, settled: true },
    ])
    expect(after).not.toBe(before)
  })

  it('ignores digest text churn on a live chain', () => {
    const before = computeRangeDigestFingerprintBlock([
      { chainKey: 'b', title: 'partial', summary: 'half a thought', settled: false },
    ])
    const after = computeRangeDigestFingerprintBlock([
      { chainKey: 'b', title: 'partial still', summary: 'more of it', settled: false },
    ])
    expect(after).toBe(before)
  })

  // The other half of the fix: a summary narrated before its digests existed
  // must not match once they arrive.
  it('separates an empty digest from a real one on a settled chain', () => {
    const empty = computeRangeDigestFingerprintBlock([
      { chainKey: 'a', title: 'topic', summary: '', settled: true },
    ])
    const real = computeRangeDigestFingerprintBlock([
      { chainKey: 'a', title: 'topic', summary: '1. did the thing', settled: true },
    ])
    expect(real).not.toBe(empty)
  })

  it('defaults to settled when liveness is unknown', () => {
    const withFlag = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 60_000, settled: true },
    ])
    const withoutFlag = computeRangeContentFingerprintBlock([
      { chainKey: 'a', date: '2026-08-16', durationMs: 60_000 },
    ])
    expect(withoutFlag).toBe(withFlag)
  })
})

describe('session input hash is window-scoped', () => {
  // A rollout file splits into windows that all carry the file's mtime. When
  // mtime was in this hash, appending to the window you were working in
  // invalidated every finished window in the same file.
  const window = (over: Partial<ParsedSession> = {}): ParsedSession =>
    ({
      path: 'native/claude/abc.jsonl',
      source: 'claude-code',
      project: 'Thinking-Space',
      userMsgCount: 4,
      startedIso: '2026-08-16T09:00:00.000Z',
      endedIso: '2026-08-16T09:30:00.000Z',
      topic: 'earlier window',
      mtime: 1_770_000_000,
      ...over,
    }) as ParsedSession

  it('holds still for a finished window when the file is appended to', () => {
    const before = computeSessionInputHashBlock(window())
    const afterFileGrew = computeSessionInputHashBlock(window({ mtime: 1_770_009_999 }))
    expect(afterFileGrew).toBe(before)
  })

  it('still moves when the window itself grows', () => {
    const before = computeSessionInputHashBlock(window())
    const grown = computeSessionInputHashBlock(
      window({ userMsgCount: 5, endedIso: '2026-08-16T09:44:00.000Z' }),
    )
    expect(grown).not.toBe(before)
  })

  it('gives two windows of one file different hashes', () => {
    const first = computeSessionInputHashBlock(window())
    const second = computeSessionInputHashBlock(
      window({
        startedIso: '2026-08-16T11:00:00.000Z',
        endedIso: '2026-08-16T11:20:00.000Z',
      }),
    )
    expect(second).not.toBe(first)
  })
})
