import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

/**
 * Tokens belong to the window that spent them.
 *
 * They used to land entirely on window 0, with `undefined` on every later one,
 * on the grounds that per-window attribution meant re-running the math against
 * assistant timestamps. It does — and it is a dozen lines, against a cost of a
 * 14-minute sitting reporting no usage, which the day table then explained as
 * "this chain came from the vault markdown source only". A native transcript
 * described as a vault export, because a number was missing.
 *
 * The two sources need different arithmetic and that is the whole subtlety:
 * Claude tags each assistant turn with its own INCREMENTAL usage (sum it),
 * Codex emits a RUNNING total (take the delta).
 */

const HOUR = 3_600_000
const T0 = Date.parse('2026-08-14T09:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()

function claudeUser(offset: number, uuid: string) {
  return JSON.stringify({
    type: 'user',
    uuid,
    sessionId: 'sess-1',
    cwd: '/Users/me/code/F9',
    timestamp: at(offset),
    message: { content: `a substantive user message body for ${uuid}` },
  })
}

function claudeAssistant(offset: number, uuid: string, usage: Record<string, number>) {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    sessionId: 'sess-1',
    cwd: '/Users/me/code/F9',
    timestamp: at(offset),
    message: { model: 'claude-opus-5', content: 'reply', usage },
  })
}

function parseClaude(lines: string[]) {
  return parseNativeAiSession({ source: 'claude', relPath: 'sess-1.jsonl', mtime: 0, text: lines.join('\n') })
}

describe('claude tokens are summed per window', () => {
  const sessions = parseClaude([
    claudeUser(0, 'u1'),
    claudeAssistant(60_000, 'a1', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5 }),
    claudeAssistant(120_000, 'a2', { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 5 }),
    // idle gap → second window
    claudeUser(3 * HOUR, 'u2'),
    claudeAssistant(3 * HOUR + 60_000, 'a3', { input_tokens: 7, output_tokens: 3 }),
  ])

  it('splits the file into two sittings', () => {
    expect(sessions).toHaveLength(2)
  })

  it('gives the first window only its own turns', () => {
    expect(sessions[0].tokens).toMatchObject({ input: 300, output: 30, cacheRead: 10 })
  })

  it('gives the later window real usage instead of undefined', () => {
    // The bug: this was `undefined`, so the row rendered as having no data at
    // all and the UI blamed a vault export for it.
    expect(sessions[1].tokens).toBeDefined()
    expect(sessions[1].tokens).toMatchObject({ input: 7, output: 3 })
  })

  it('does not double-count — the windows sum to the file total', () => {
    const total = sessions.reduce((n, s) => n + (s.tokens?.input ?? 0), 0)
    expect(total).toBe(307)
  })
})

describe('codex tokens are the delta of its running totals', () => {
  // The canonical user-input form: Codex emits each turn twice and only
  // `event_msg`/`user_message` carries a clean body.
  function codexEvent(offset: number, _role: 'user' | 'assistant', text: string) {
    return JSON.stringify({
      type: 'event_msg',
      timestamp: at(offset),
      payload: { type: 'user_message', message: text },
    })
  }
  function codexCount(offset: number, input: number, output: number, cached = 0) {
    return JSON.stringify({
      type: 'event_msg',
      timestamp: at(offset),
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached } },
      },
    })
  }

  const sessions = parseNativeAiSession({
    source: 'codex',
    relPath: 'rollout-sess-2.jsonl',
    mtime: 0,
    text: [
      JSON.stringify({ type: 'session_meta', payload: { id: 'sess-2', cwd: '/Users/me/code/F9' } }),
      codexEvent(0, 'user', 'first sitting question with enough body to count'),
      codexCount(60_000, 100, 10),
      // idle gap → second window
      codexEvent(3 * HOUR, 'user', 'second sitting question with enough body to count'),
      codexCount(3 * HOUR + 60_000, 250, 35), // running total, not incremental
    ].join('\n'),
  })

  it('splits into two sittings', () => {
    expect(sessions).toHaveLength(2)
  })

  it('reads the first window as the raw total', () => {
    expect(sessions[0].tokens).toMatchObject({ input: 100, output: 10 })
  })

  it('reads the later window as the DELTA, not the running total', () => {
    // 250 - 100 = 150. Treating a running total as incremental would report
    // 250 here and inflate the day's cost by the whole earlier sitting.
    expect(sessions[1].tokens).toMatchObject({ input: 150, output: 25 })
  })
})

describe('absence still means absence', () => {
  it('leaves tokens undefined for a window with no usage events', () => {
    // "We did not measure" must stay distinguishable from "it cost nothing" —
    // a zeroed record would read as the latter everywhere downstream.
    const sessions = parseClaude([
      claudeUser(0, 'u1'),
      claudeAssistant(60_000, 'a1', { input_tokens: 100, output_tokens: 10 }),
      claudeUser(3 * HOUR, 'u2'), // second window: user turns only
      claudeUser(3 * HOUR + 60_000, 'u3'),
    ])

    expect(sessions).toHaveLength(2)
    expect(sessions[0].tokens).toBeDefined()
    expect(sessions[1].tokens).toBeUndefined()
  })
})
