import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntelligenceRequest } from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import type { EngineStateBlock } from '@/services/lego_blocks/units/intelligence/engineStatusBlock'

// When the local engine dies under a request, the job waits for the supervisor
// to bring it back and retries — up to twice — instead of failing. A job that
// was in flight for two deaths in a row is the likely cause and is not retried
// again: it fails loudly, with the failure on record.

const seen: IntelligenceRequest[] = []
let deathsBeforeSuccess = 0
let supervised = true
/** Which request ids the engine's failure record names after each death. */
let implicate: (requestId: string, death: number) => string[] = () => []
let deaths = 0

const provider = {
  id: 'openai-compat' as const,
  isConfigured: () => true,
  availability: async () => ({ available: true, defaultModel: 'qwen3.8-27b', details: {} }),
  chat: async (request: IntelligenceRequest) => {
    seen.push({ ...request })
    if (deaths < deathsBeforeSuccess) {
      deaths += 1
      throw new TypeError('fetch failed')
    }
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
  writeIntelligenceCacheBlock: async () => undefined,
}))

vi.mock('@/services/lego_blocks/integrations/intelligence/engineMonitorBlock', () => ({
  ensureEngineMonitorBlock: () => undefined,
  isEngineSupervisedBlock: () => supervised,
  waitForEngineReadyBlock: async (): Promise<EngineStateBlock> => ({
    kind: 'ready',
    source: 'supervisor',
    checkedAt: Date.now(),
    lastFailure: {
      id: `failure-${deaths}`,
      at: '2026-10-31T00:00:00Z',
      reason: 'thread_exception',
      inFlight: implicate(seen[seen.length - 1].requestId!, deaths).map(requestId => ({ requestId })),
    },
  }),
}))

const { runContract } = await import('@/services/orchestrators/intelligenceOrch')
const { clearTelemetryBlock, readTelemetryBlock } = await import(
  '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'
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

function run() {
  return runContract(contract as never, `input-${Math.random()}` as never, { model: 'qwen3.8-27b' })
}

beforeEach(() => {
  installLocalStorageMock()
  seen.length = 0
  deaths = 0
  deathsBeforeSuccess = 0
  supervised = true
  implicate = () => []
  clearTelemetryBlock()
})

describe('runContract engine-death retries', () => {
  it('retries after the engine comes back, under the same request id', async () => {
    deathsBeforeSuccess = 1
    const result = await run()
    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen[0].requestId).toBeTruthy()
    expect(seen[1].requestId).toBe(seen[0].requestId)
    expect(seen[0].jobId).toBe('test-contract')
  })

  it('gives up after two retries when the job is not to blame', async () => {
    deathsBeforeSuccess = 5
    const result = await run()
    expect(seen).toHaveLength(3)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('engine-crashed')
      expect(result.error.details).toMatchObject({ attempts: 3, poison: false })
    }
  })

  it('stops at the second death that names this job — poison input', async () => {
    deathsBeforeSuccess = 5
    implicate = requestId => [requestId]
    const result = await run()
    expect(seen).toHaveLength(2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('engine-crashed')
      expect(result.error.details).toMatchObject({ poison: true })
    }
  })

  it('does not count deaths that named other jobs toward poison', async () => {
    deathsBeforeSuccess = 2
    implicate = (requestId, death) => (death === 1 ? [requestId] : ['someone-else'])
    const result = await run()
    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(3)
  })

  it('does not retry an unsupervised server — nothing is bringing it back', async () => {
    supervised = false
    deathsBeforeSuccess = 1
    const result = await run()
    expect(seen).toHaveLength(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('provider-unreachable')
  })

  it('records a failure that threw, so it shows in AI Runs', async () => {
    deathsBeforeSuccess = 5
    await run()
    const [entry] = readTelemetryBlock()
    expect(entry.status).toBe('error')
    expect(entry.error?.kind).toBe('engine-crashed')
    expect(entry.payload?.user).toBe('hi')
  })
})
