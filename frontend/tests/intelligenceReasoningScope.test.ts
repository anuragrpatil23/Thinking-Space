import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntelligenceRequest } from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'

// runContract used to hardcode reasoning off for every reasoning-capable model,
// so the AI Settings thinking toggle governed chat but never the internal
// contracts (chain digest, day atom, range summary). These cover the wiring
// that fixed that — and the asymmetry that keeps it safe: the setting defaults
// to ON (correct for chat), but an untouched setting must still mean OFF for a
// single-shot contract, or every digest silently gets slower and can truncate.

const seen: IntelligenceRequest[] = []
const cacheKeys: string[] = []

const provider = {
  id: 'openai-compat' as const,
  isConfigured: () => true,
  listModels: async () => ['qwen3.8-27b'],
  chat: async (request: IntelligenceRequest) => {
    seen.push(request)
    return {
      content: 'hello',
      latencyMs: 1,
      finishReason: 'stop',
      providerModel: request.model,
      usage: { promptTokens: 1, completionTokens: 1 },
    }
  },
}

vi.mock('@/services/lego_blocks/integrations/intelligence/providerRegistryBlock', () => ({
  resolveProviderBlock: () => provider,
  listProvidersBlock: () => [provider],
}))

vi.mock('@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock', () => ({
  intelligenceCacheAvailableBlock: () => true,
  readIntelligenceCacheBlock: async () => null,
  writeIntelligenceCacheBlock: async (record: { cacheKey: string }) => {
    cacheKeys.push(record.cacheKey)
  },
}))

const { runContract } = await import('@/services/orchestrators/intelligenceOrch')
const { setSelectedAiThinkingForScopeBlock, setSelectedAiThinkingBlock } = await import(
  '@/services/lego_blocks/integrations/aiSettingsBlock'
)

const contract = {
  id: 'test-contract',
  promptVersion: 1,
  outputSchema: { kind: 'string' } as const,
  buildRequest: () => ({ system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] }),
  finalize: (value: string) => ({ value, meta: {} }),
}

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    },
  })
}

async function run(options: Record<string, unknown>) {
  seen.length = 0
  // Distinct input per call so the in-flight dedup key never collides.
  return runContract(contract as never, `input-${Math.random()}` as never, {
    model: 'qwen3.8-27b',
    ...options,
  } as never)
}

describe('runContract reasoning resolution', () => {
  beforeEach(() => {
    installLocalStorageMock()
    localStorage.clear()
    cacheKeys.length = 0
  })

  it('disables reasoning when no scope is attributed (unchanged default)', async () => {
    await run({})
    expect(seen[0].disableReasoning).toBe(true)
  })

  it('keeps reasoning off for an untouched setting, despite the toggle defaulting to on', async () => {
    await run({ scope: 'ai_activity' })
    expect(seen[0].disableReasoning).toBe(true)
  })

  it('enables reasoning when the scope override opts in', async () => {
    setSelectedAiThinkingForScopeBlock('ai_activity', 'opensource-ai', true)
    await run({ scope: 'ai_activity' })
    expect(seen[0].disableReasoning).toBe(false)
  })

  it('honours an explicit provider-level setting when no scope override exists', async () => {
    setSelectedAiThinkingBlock('opensource-ai', true)
    await run({ scope: 'ai_activity' })
    expect(seen[0].disableReasoning).toBe(false)
  })

  it('lets a scope override win over the provider-level setting', async () => {
    setSelectedAiThinkingBlock('opensource-ai', true)
    setSelectedAiThinkingForScopeBlock('ai_activity', 'opensource-ai', false)
    await run({ scope: 'ai_activity' })
    expect(seen[0].disableReasoning).toBe(true)
  })

  it('leaves reasoning unset for a model with no reasoning mode', async () => {
    await run({ scope: 'ai_activity', model: 'some-unknown-local-model' })
    expect(seen[0].disableReasoning).toBeUndefined()
  })

  it('varies the cache key by reasoning state so toggling does not serve stale output', async () => {
    await run({ scope: 'ai_activity' })
    setSelectedAiThinkingForScopeBlock('ai_activity', 'opensource-ai', true)
    await run({ scope: 'ai_activity' })
    expect(cacheKeys).toHaveLength(2)
    expect(cacheKeys[0]).not.toEqual(cacheKeys[1])
  })
})
