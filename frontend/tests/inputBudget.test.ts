import { beforeEach, describe, expect, it } from 'vitest'

// The input budget is a latency budget: prefill dominates and degrades as the
// prompt grows. Per-turn trimming alone never bounded the TOTAL, so a long
// chain could blow far past whatever the user chose — that total is what
// these pin, along with the setting's clamping.

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    },
  })
}

const {
  AI_INPUT_BUDGET_DEFAULT_TOKENS,
  AI_INPUT_BUDGET_MAX_TOKENS,
  AI_INPUT_BUDGET_MIN_TOKENS,
  getAiInputBudgetTokens,
  setAiInputBudgetTokens,
} = await import('@/services/lego_blocks/units/storageKeyBlock')

describe('input budget setting', () => {
  beforeEach(() => {
    installLocalStorageMock()
    localStorage.clear()
  })

  it('defaults to 20k tokens', () => {
    expect(getAiInputBudgetTokens()).toBe(20_000)
    expect(AI_INPUT_BUDGET_DEFAULT_TOKENS).toBe(20_000)
  })

  it('round-trips a chosen value', () => {
    setAiInputBudgetTokens(35_000)
    expect(getAiInputBudgetTokens()).toBe(35_000)
  })

  it('clamps out-of-range values rather than trusting them', () => {
    setAiInputBudgetTokens(10)
    expect(getAiInputBudgetTokens()).toBe(AI_INPUT_BUDGET_MIN_TOKENS)
    setAiInputBudgetTokens(10_000_000)
    expect(getAiInputBudgetTokens()).toBe(AI_INPUT_BUDGET_MAX_TOKENS)
  })

  it('falls back to the default when storage holds junk', () => {
    localStorage.setItem('ltm-ai-input-budget-tokens', 'not-a-number')
    expect(getAiInputBudgetTokens()).toBe(AI_INPUT_BUDGET_DEFAULT_TOKENS)
  })
})
