import { describe, expect, it } from 'vitest'
import {
  checkContextFitBlock,
  estimateTokensBlock,
  resolveMaxOutputTokensBlock,
  resolveModelProfileBlock,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// max_tokens is a stop condition the model never sees, so it can only cut an
// answer mid-sentence — it can't make the model answer more briefly. Length
// lives in each contract's prompt. These pin the consequences of that:
// the limit is a generous runaway guard, reasoning gets its own additive
// allowance rather than eating the answer's, and no contract tunes it.

describe('output budget', () => {
  it('adds reasoning headroom only when thinking is on', () => {
    const profile = resolveModelProfileBlock('mlx-community/Qwen3.8-27B-4bit')
    const off = resolveMaxOutputTokensBlock(profile, false)
    const on = resolveMaxOutputTokensBlock(profile, true)
    expect(off).toBe(profile.maxOutputTokens)
    expect(on).toBe(profile.maxOutputTokens + profile.reasoningHeadroomTokens)
    expect(on).toBeGreaterThan(off)
  })

  it('lets a reasoning model think as long as it wants', () => {
    // The thought must never be the thing that gets cut — time is the only
    // real backstop. Anything near the answer-sized ceiling would truncate
    // mid-thought on a model that reasons at any length.
    for (const model of ['qwen3.8-27b', 'qwq-32b', 'deepseek-r1-distill']) {
      const profile = resolveModelProfileBlock(model)
      expect(resolveMaxOutputTokensBlock(profile, true)).toBeGreaterThanOrEqual(32_768)
    }
  })

  it('gives a non-reasoning model no headroom either way', () => {
    const profile = resolveModelProfileBlock('gemma-4-26b-a4b-it-4bit')
    expect(profile.reasoningHeadroomTokens).toBe(0)
    expect(resolveMaxOutputTokensBlock(profile, true))
      .toBe(resolveMaxOutputTokensBlock(profile, false))
  })

  it('clears the largest legitimate answer on every model', () => {
    // month-theme compose was the biggest hand-tuned number in the old
    // scheme. If a ceiling ever drops below this, the guard starts truncating
    // real work instead of catching runaways.
    const LARGEST_LEGITIMATE_ANSWER = 1600
    for (const model of [
      'qwen3.8-27b', 'qwen3.6-35b', 'gemma-4-26b', 'llama-3.3-70b',
      'mistral-small', 'phi-4', 'deepseek-r1-distill', 'claude-opus-4-8',
      'totally-unknown-model',
    ]) {
      const profile = resolveModelProfileBlock(model)
      expect(resolveMaxOutputTokensBlock(profile, false))
        .toBeGreaterThan(LARGEST_LEGITIMATE_ANSWER)
    }
  })

  it('estimates prompt tokens roughly by character count', () => {
    expect(estimateTokensBlock('')).toBe(0)
    expect(estimateTokensBlock('a'.repeat(400))).toBe(100)
  })

  it('passes a prompt that fits the context', () => {
    const profile = resolveModelProfileBlock('qwen3.8-27b')
    expect(checkContextFitBlock(profile, 'a'.repeat(4000), 4096)).toBeNull()
  })

  it('rejects a prompt that cannot fit alongside its reserved output', () => {
    const profile = resolveModelProfileBlock('totally-unknown-model') // 8k window
    const reason = checkContextFitBlock(profile, 'a'.repeat(200_000), 4096)
    expect(reason).toContain('exceeds')
    expect(reason).toContain(String(profile.contextWindow))
  })

  it('counts reserved output against the context, not just the prompt', () => {
    const profile = resolveModelProfileBlock('totally-unknown-model')
    const prompt = 'a'.repeat(profile.contextWindow * 4 - 4_000)
    // Fits with a small reservation, not with a large one.
    expect(checkContextFitBlock(profile, prompt, 100)).toBeNull()
    expect(checkContextFitBlock(profile, prompt, 4_096)).toContain('exceeds')
  })
})
