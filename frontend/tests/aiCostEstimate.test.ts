import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import {
  estimateCostUsd,
  estimateSessionCostUsd,
  formatUsd,
  priceForModel,
  priceTierForModel,
} from '@/services/lego_blocks/units/aiPriceTableBlock'

/**
 * Cost estimates are the one number here nobody can eyeball for correctness.
 * A wrong price tier or a double-counted token doesn't crash, doesn't warn,
 * and doesn't look obviously wrong — it just quietly reports a figure that is
 * multiples off, forever. Both failure modes below shipped and survived; they
 * were caught only because a session claimed to cost $648 when it cost ~$114.
 *
 * So: pin the model-id → tier routing, and pin that one API response counts
 * once no matter how many transcript lines it was written across.
 */

describe('model ids route to the right price tier', () => {
  // The original rule was /opus-4-(5|6|7)/, which does not match "opus-5" or
  // "opus-4-8" — both fell through to the legacy $15/$75 Opus 3 table and were
  // billed at 3x. Newer ids must never fall back to the retired tier.
  const current = { input: 5, output: 25, cacheRead: 0.5 }
  it.each([
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
  ])('%s bills at current Opus rates', (model) => {
    expect(priceForModel(model)).toMatchObject(current)
  })

  const legacy = { input: 15, output: 75, cacheRead: 1.5 }
  it.each([
    'claude-opus-4-1',
    'claude-opus-4-1-20250805',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-3-opus-20240229',
  ])('%s still bills at the legacy Opus rates', (model) => {
    expect(priceForModel(model)).toMatchObject(legacy)
  })

  it('prices Fable above the Opus tier instead of falling back to Sonnet', () => {
    expect(priceForModel('claude-fable-5')).toMatchObject({ input: 10, output: 50 })
  })

  // The whole point of removing FALLBACK_PRICE: a model we have never priced
  // must produce no number at all, not a confident wrong one.
  it.each(['claude-opus-9', 'gpt-7', 'some-local-llama', ''])(
    'leaves %s unpriced rather than guessing',
    (model) => {
      expect(priceForModel(model)).toBeNull()
      expect(estimateCostUsd({ input: 1e6, output: 1e6, cacheRead: 0, cacheCreation: 0 }, model)).toBeNull()
    },
  )

  it('renders an unpriced figure as "unpriced", not as $0.00', () => {
    expect(formatUsd(null)).toBe('unpriced')
    expect(formatUsd(0)).toBe('<$0.01')
  })

  it('carries provenance so "when did this rate apply" is answerable', () => {
    for (const model of ['claude-opus-5', 'claude-opus-4-8-20260101', 'claude-sonnet-5']) {
      const p = priceForModel(model)
      expect(p?.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p?.label).toBeTruthy()
      expect(p?.source).toBeTruthy()
    }
  })

  // Exact-id lookup is what makes pattern drift survivable — the original bug
  // was a regex that quietly stopped matching a new id. Ids the feed knows must
  // resolve by name, not by a regex that happens to still fit.
  it.each([
    ['claude-opus-5', 'exact'],
    ['claude-haiku-4-5', 'exact'],
    ['gpt-5.6-terra', 'exact'],
    ['claude-sonnet-5', 'override'],
    ['claude-fable-5-1', 'override'],
    // Every id in real transcripts resolves exactly. Patterns now only catch
    // ids the feed has never published — a snapshot minted between refreshes.
    ['claude-opus-4-8-20260101', 'pattern'],
    ['claude-opus-9', null],
  ])('%s resolves via the %s tier', (model, tier) => {
    expect(priceTierForModel(model)).toBe(tier)
  })

  it('lets an override beat the feed', () => {
    // The feed still lists claude-sonnet-5 at the expired introductory $2/$10.
    expect(priceForModel('claude-sonnet-5')).toMatchObject({ input: 3, output: 15 })
  })

  it('charges the 1h cache-creation TTL at 2x input, not 1.25x', () => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000, cacheCreation1h: 1_000_000 }
    expect(estimateCostUsd(tokens, 'claude-opus-5')).toBeCloseTo(10, 6)
  })
})

describe('codex normalizes into the same disjoint buckets claude uses', () => {
  // Codex reports overlapping buckets: `input_tokens` INCLUDES the cached
  // subset, and `reasoning_output_tokens` is a subset of `output_tokens`.
  // Both must be subtracted out, not added, or the shared cost math counts
  // cache reads at the fresh-input rate and reasoning at twice the output rate.
  const at = (ms: number) => new Date(Date.parse('2026-08-14T09:00:00.000Z') + ms).toISOString()

  const sessions = parseNativeAiSession({
    source: 'codex',
    relPath: 'rollout-1.jsonl',
    mtime: 0,
    text: [
      JSON.stringify({
        timestamp: at(0),
        type: 'session_meta',
        payload: { id: 'sess-1', cwd: '/Users/me/code/F9' },
      }),
      JSON.stringify({ timestamp: at(1), type: 'turn_context', payload: { model: 'gpt-5.6-terra' } }),
      JSON.stringify({
        timestamp: at(2),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'a substantive user message body to open the sitting' },
      }),
      JSON.stringify({
        timestamp: at(60_000),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 19_308,
              cached_input_tokens: 5_504,
              output_tokens: 535,
              reasoning_output_tokens: 118,
              total_tokens: 19_843,
            },
          },
        },
      }),
    ].join('\n'),
  })

  it('splits the cached subset out of input rather than counting it twice', () => {
    // 19_308 total input - 5_504 cached = 13_804 genuinely fresh.
    expect(sessions[0].tokens).toMatchObject({ input: 13_804, cacheRead: 5_504 })
  })

  it('does not add reasoning tokens on top of output', () => {
    // The bug: `output + reasoning` = 653. Reasoning is already inside output.
    expect(sessions[0].tokens?.output).toBe(535)
  })

  // Every one of these was previously swallowed by a single /^gpt-5/ rule at
  // GPT-5's $1.25/$10, which understated gpt-5.5 by 3x and overstated
  // codex-mini by 5x. The GPT-5 line is not one price tier.
  it.each([
    ['gpt-5.6-terra', 2, 12],
    ['gpt-5.6-sol', 4, 20],
    ['gpt-5.5', 5, 30],
    ['gpt-5.4', 2.5, 15],
    ['gpt-5.3-codex', 1.75, 14],
    ['gpt-5.2-codex', 1.75, 14],
    ['gpt-5.1-codex-mini', 0.25, 2],
    ['gpt-5', 1.25, 10],
  ])('%s bills at its own published rate', (model, input, output) => {
    expect(priceForModel(model)).toMatchObject({ input, output })
  })
})

describe('one API response is counted once, however many lines it spans', () => {
  // A single response is written as several assistant lines — a `thinking`
  // block and a `tool_use` block land separately — and EVERY line repeats the
  // same `usage` object. Summing per line inflated real transcripts ~1.8x.
  const at = (ms: number) => new Date(Date.parse('2026-08-14T09:00:00.000Z') + ms).toISOString()
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 50_000 }

  const line = (uuid: string, requestId: string, block: string, offset: number) =>
    JSON.stringify({
      type: 'assistant',
      uuid,
      requestId,
      sessionId: 'sess-1',
      cwd: '/Users/me/code/F9',
      timestamp: at(offset),
      message: { id: 'msg_1', model: 'claude-opus-5', content: [{ type: block }], usage },
    })

  const sessions = parseNativeAiSession({
    source: 'claude',
    relPath: 'sess-1.jsonl',
    mtime: 0,
    text: [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId: 'sess-1',
        cwd: '/Users/me/code/F9',
        timestamp: at(0),
        message: { content: 'a substantive user message body to open the sitting' },
      }),
      line('a1', 'req_1', 'thinking', 60_000),
      line('a2', 'req_1', 'tool_use', 60_001),
      line('a3', 'req_1', 'text', 60_002),
    ].join('\n'),
  })

  it('counts the shared usage object once, not once per content block', () => {
    expect(sessions[0].tokens).toMatchObject({ input: 10, output: 100, cacheRead: 50_000 })
  })

  it('still counts genuinely distinct responses separately', () => {
    const two = parseNativeAiSession({
      source: 'claude',
      relPath: 'sess-1.jsonl',
      mtime: 0,
      text: [
        JSON.stringify({
          type: 'user',
          uuid: 'u1',
          sessionId: 'sess-1',
          cwd: '/Users/me/code/F9',
          timestamp: at(0),
          message: { content: 'a substantive user message body to open the sitting' },
        }),
        line('a1', 'req_1', 'text', 60_000),
        JSON.stringify({
          type: 'assistant',
          uuid: 'a2',
          requestId: 'req_2',
          sessionId: 'sess-1',
          cwd: '/Users/me/code/F9',
          timestamp: at(60_001),
          message: { id: 'msg_2', model: 'claude-opus-5', content: [{ type: 'text' }], usage },
        }),
      ].join('\n'),
    })
    expect(two[0].tokens).toMatchObject({ input: 20, output: 200, cacheRead: 100_000 })
  })
})

describe('a session is not one model', () => {
  // The shape that was structurally impossible to price correctly: a
  // coordinator on Opus delegating to a Haiku subagent. `model` names only the
  // last model seen, so pricing the whole session by it charged every
  // delegated token at Opus rates — silently, with nothing on screen wrong.
  const opus = { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }
  const haiku = { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }

  it('prices each model at its own rate', () => {
    const cost = estimateSessionCostUsd({
      tokens: { input: 2_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
      tokensByModel: { 'claude-opus-5': opus, 'claude-haiku-4-5': haiku },
      model: 'claude-haiku-4-5',
    })
    // Opus $5 + Haiku $1 = $6. Priced at the session's last model it would be
    // $2 (all Haiku); at the first, $10 (all Opus). Both were reachable before.
    expect(cost?.usd).toBeCloseTo(6, 6)
    expect(cost?.unpricedModels).toEqual([])
  })

  it('reports a partly-priced session as a floor rather than a total', () => {
    const cost = estimateSessionCostUsd({
      tokensByModel: { 'claude-opus-5': opus, 'some-unknown-model': haiku },
    })
    expect(cost?.usd).toBeCloseTo(5, 6)
    expect(cost?.unpricedModels).toEqual(['some-unknown-model'])
  })

  it('is null only when nothing at all could be priced', () => {
    expect(estimateSessionCostUsd({ tokensByModel: { 'some-unknown-model': haiku } })).toBeNull()
  })

  it('falls back to the single-model path for sources without per-turn models', () => {
    const cost = estimateSessionCostUsd({ tokens: opus, model: 'claude-opus-5' })
    expect(cost?.usd).toBeCloseTo(5, 6)
  })
})
