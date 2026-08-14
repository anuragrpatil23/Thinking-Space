import { describe, expect, it } from 'vitest'
import quirks from '@/data/modelQuirks.json'
import { resolveModelProfileBlock } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// The quirks table is order sensitive: the first matching regex wins, so a
// general pattern placed above a specific one silently swallows it. That is
// exactly how Qwen 3.8 would have landed on the generic "Qwen 3" profile and
// been capped at 32k instead of its real 262k window.

describe('modelQuirks table', () => {
  it('compiles every pattern', () => {
    for (const entry of quirks.models) {
      expect(() => new RegExp(entry.match, 'i')).not.toThrow()
    }
  })

  it('resolves specific families before general ones', () => {
    expect(resolveModelProfileBlock('mlx-community/Qwen3.8-27B-4bit').family).toBe('Qwen 3.8')
    expect(resolveModelProfileBlock('unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit').family).toBe('Qwen 3.6 / Qwen3-Next')
    expect(resolveModelProfileBlock('Qwen3-8B-Instruct').family).toBe('Qwen 3')
  })

  it('gives Qwen 3.8 its real context window rather than the generic Qwen 3 cap', () => {
    const profile = resolveModelProfileBlock('qwen3.8-27b')
    expect(profile.contextWindow).toBe(262_144)
    expect(profile.hasReasoningMode).toBe(true)
  })

  it('falls back conservatively for an unrecognized model', () => {
    const profile = resolveModelProfileBlock('some-brand-new-thing')
    expect(profile.supportsTools).toBe(false)
    expect(profile.hasReasoningMode).toBe(false)
    // ...but still lets the user reach for a thinking toggle.
    expect(profile.thinkingToggleVisible).toBe(true)
  })

  it('hides the thinking toggle for known non-reasoning families', () => {
    for (const model of ['gemma-4-26b-it', 'llama-3.3-70b', 'mistral-small', 'phi-4']) {
      expect(resolveModelProfileBlock(model).thinkingToggleVisible).toBe(false)
    }
  })

  it('shows the thinking toggle for known reasoning families', () => {
    for (const model of ['qwen3.8-27b', 'qwq-32b', 'deepseek-r1-distill-llama-8b']) {
      expect(resolveModelProfileBlock(model).thinkingToggleVisible).toBe(true)
    }
  })

  it('routes Claude ids to the anthropic provider', () => {
    expect(resolveModelProfileBlock('claude-opus-4-8').provider).toBe('anthropic')
    expect(resolveModelProfileBlock('', 'anthropic').family).toBe('Unknown Claude')
  })

  it('covers every server family referenced by a fingerprint rule', () => {
    const families = Object.keys(quirks.servers.families)
    for (const rule of quirks.servers.fingerprints) {
      expect(families).toContain(rule.family)
    }
    expect(families).toContain('unknown-openai-compat')
  })
})
