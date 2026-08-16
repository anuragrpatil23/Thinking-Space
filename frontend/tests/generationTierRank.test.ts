import { describe, expect, it } from 'vitest'
import {
  generationTierRankBlock,
  generationSourceRankBlock,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

/**
 * Thinking is a rung on the quality ladder, not a cache-buster.
 *
 * Before this, thinking was invisible to precedence: it lived only in the
 * intelligence cache key, which is consulted *after* a record has already been
 * judged fresh. So turning thinking ON never upgraded existing digests — you
 * had to force-regenerate each one by hand — and an unrelated regeneration
 * while thinking was off silently replaced a thought-through body with a
 * thinner one, leaving nothing on the record to say it had happened.
 *
 * The asymmetry these ranks encode is the same one the local→claude ladder
 * already had: an upgrade applies itself; a downgrade never stomps.
 */

describe('the ladder', () => {
  it('ranks rule-based below everything', () => {
    expect(generationTierRankBlock('rule-based', false)).toBe(0)
    expect(generationTierRankBlock('rule-based', true)).toBe(0)
  })

  it('puts a thinking local run above a non-thinking one', () => {
    expect(generationTierRankBlock('local', true)).toBeGreaterThan(
      generationTierRankBlock('local', false),
    )
  })

  it('keeps claude above local, thinking or not', () => {
    // Thinking is a rung *within* the local family — the toggle is
    // opensource-ai-only, so "local that thought" is the best local offers.
    expect(generationTierRankBlock('claude', false)).toBeGreaterThan(
      generationTierRankBlock('local', true),
    )
  })

  it('floors a legacy record at local-no-thinking', () => {
    // Low enough that a real upgrade still applies, high enough that a
    // same-tier read does not trigger a regeneration storm.
    expect(generationTierRankBlock('', false)).toBe(generationTierRankBlock('local', false))
  })
})

describe('reuse-vs-regenerate, expressed as the comparison the orchestrator makes', () => {
  const keeps = (
    stored: Parameters<typeof generationTierRankBlock>,
    target: Parameters<typeof generationTierRankBlock>,
  ) => generationTierRankBlock(...stored) >= generationTierRankBlock(...target)

  it('regenerates when thinking is turned ON', () => {
    // The upgrade that used to require a manual regenerate.
    expect(keeps(['local', false], ['local', true])).toBe(false)
  })

  it('keeps the thought-through body when thinking is turned OFF', () => {
    expect(keeps(['local', true], ['local', false])).toBe(true)
  })

  it('keeps a claude body when the user drops to local WITH thinking', () => {
    expect(keeps(['claude', false], ['local', true])).toBe(true)
  })

  it('regenerates a thinking-local body when the user switches up to claude', () => {
    expect(keeps(['local', true], ['claude', false])).toBe(false)
  })

  it('is stable when nothing changed', () => {
    for (const tier of [['local', false], ['local', true], ['claude', false]] as const) {
      expect(keeps(tier as never, tier as never)).toBe(true)
    }
  })

  it('cannot loop when the model has no reasoning mode', () => {
    // The hazard the target resolution exists to avoid: if the target were read
    // off the *setting*, a model that ignores the toggle would target a tier it
    // can never produce and regenerate on every read forever. Both sides ask
    // "did/will reasoning actually run", so on such a model both are false.
    const producedByAModelWithNoReasoningMode = false
    expect(
      keeps(['local', producedByAModelWithNoReasoningMode], ['local', producedByAModelWithNoReasoningMode]),
    ).toBe(true)
  })
})

describe('the family-only rank it extends', () => {
  it('still exists for callers that do not track thinking', () => {
    // The range-summary pipeline has its own tiering; this stays for anything
    // reasoning does not apply to.
    expect(generationSourceRankBlock('claude')).toBeGreaterThan(generationSourceRankBlock('local'))
    expect(generationSourceRankBlock('local')).toBeGreaterThan(generationSourceRankBlock('rule-based'))
  })
})
