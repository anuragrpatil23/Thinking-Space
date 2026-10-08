import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import { deriveSessionLimitSharesBlock } from '@/services/orchestrators/aiLimitShareOrch'

/**
 * Codex writes the account's limit percentages onto every `token_count` event,
 * so its transcripts are their own usage log — continuous, per session, and
 * there for sessions that ran long before anything read them.
 */

const HOUR = 3_600_000
const T0 = Date.parse('2026-10-01T09:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()
const FH = Math.floor(T0 / 1000) + 5 * 3600
const WK = Math.floor(T0 / 1000) + 6 * 86400

function user(offset: number, text: string) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at(offset),
    payload: { type: 'user_message', message: text },
  })
}

function count(offset: number, tokens: number, session: number, weekly: number) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at(offset),
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0 } },
      rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: session, window_minutes: 300, resets_at: FH },
        secondary: { used_percent: weekly, window_minutes: 10080, resets_at: WK },
      },
    },
  })
}

function parse(id: string, lines: string[]) {
  return parseNativeAiSession({
    source: 'codex',
    relPath: `rollout-${id}.jsonl`,
    mtime: 0,
    text: [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/Users/me/code/F9' } }),
      ...lines,
    ].join('\n'),
  })
}

describe('codex limit readings', () => {
  const sessions = parse('11111111-1111-4111-8111-111111111111', [
    user(0, 'first sitting question with enough body to count'),
    count(60_000, 100, 10, 2),
    count(120_000, 200, 10, 2), // nothing moved
    count(180_000, 300, 10, 2), // nothing moved
    count(240_000, 400, 14, 3),
    count(300_000, 500, 14, 3), // last reading: kept, to pin the token total
    user(3 * HOUR, 'second sitting question with enough body to count'),
    count(3 * HOUR + 60_000, 900, 20, 4),
  ])

  it('keeps only the readings where a meter moved, plus the last', () => {
    expect(sessions[0].limitReadings?.map(r => [r[1], r[3], r[5]])).toEqual([
      [10, 2, 100],
      [14, 3, 400],
      [14, 3, 500],
    ])
  })

  it('files each reading under the sitting it followed', () => {
    expect(sessions[1].limitReadings?.map(r => [r[1], r[3], r[5]])).toEqual([[20, 4, 900]])
  })

  it('writes an empty list, not nothing, when a sitting reported no limits', () => {
    // The parse cache reads a missing field as "parsed before this existed".
    const bare = parse('22222222-2222-4222-8222-222222222222', [
      user(0, 'a question with enough body to count as real'),
    ])
    expect(bare[0].limitReadings).toEqual([])
  })

  it('becomes a per-sitting share with no usage log at all', () => {
    const shares = deriveSessionLimitSharesBlock(sessions, '')
    expect(shares.get(sessions[0].sessionId as string)).toEqual({
      sessionPct: 4,
      weeklyPct: 1,
      approx: false,
    })
    expect(shares.get(sessions[1].sessionId as string)).toEqual({
      sessionPct: 6,
      weeklyPct: 1,
      approx: false,
    })
  })
})

describe('claude shares come from the usage log, joined on session id', () => {
  it('attributes log movement to the transcript with that id', () => {
    const id = '33333333-3333-4333-8333-333333333333'
    const sessions = parseNativeAiSession({
      source: 'claude',
      relPath: `${id}.jsonl`,
      mtime: 0,
      text: [
        JSON.stringify({
          type: 'user',
          uuid: 'u1',
          sessionId: id,
          cwd: '/Users/me/code/F9',
          timestamp: at(0),
          message: { content: 'a substantive user message body' },
        }),
      ].join('\n'),
    })
    const t = Math.floor(T0 / 1000)
    const row = (dt: number, fh: number, sd: number, cost: number) =>
      JSON.stringify({ t: t + dt, p: 'claude', sid: id, fh, fhr: FH, sd, sdr: WK, cost, model: 'm' })
    const log = [row(10, 8, 54, 0), row(310, 15, 55, 2.7), row(610, 21, 56, 5.4)].join('\n')

    expect(deriveSessionLimitSharesBlock(sessions, log).get(id)).toEqual({
      sessionPct: 13,
      weeklyPct: 2,
      approx: false,
    })
  })
})
