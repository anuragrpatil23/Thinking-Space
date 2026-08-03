import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectChainDigest } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'

// A1: a digest's file pointers are mechanically derived from the transcript's
// tool calls, not the model, so they must not sit behind the model-freshness
// hash. A digest written before pointer extraction existed matches its own
// inputHash forever, so the fast path kept returning it with empty pointers.
// ensureChainDigestOrch now reconciles pointers on read — patching on drift,
// but never stomping good pointers on a device that can't see the transcript.

let stored: ProjectChainDigest | null = null
const putProjectChainDigestBlock = vi.fn(async (d: ProjectChainDigest) => {
  stored = d
})

vi.mock('@/services/lego_blocks/integrations/aiActivityChainDigestStoreBlock', () => ({
  getProjectChainDigestBlock: async () => stored,
  putProjectChainDigestBlock: (d: ProjectChainDigest) => putProjectChainDigestBlock(d),
}))

// AI off → no model path; ensureChainDigestOrch returns the stored digest after
// reconciliation. Keeps the test on the pointer logic, not the model.
vi.mock('@/services/lego_blocks/units/storageKeyBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/storageKeyBlock')>()),
  getStoredVaultRoot: () => '/vault',
  getAiActivityAiTitlesEnabled: () => false,
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/providerRegistryBlock', () => ({
  currentGenerationSourceBlock: () => 'local',
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock', () => ({
  intelligenceCacheAvailableBlock: () => true,
}))
vi.mock('@/services/orchestrators/intelligenceOrch', () => ({
  availability: async () => ({ available: false }),
  runContract: async () => ({ ok: false, value: undefined }),
}))

const { ensureChainDigestOrch } = await import(
  '@/services/orchestrators/aiActivityChainDigestOrch'
)
type ActivityChain = Parameters<typeof ensureChainDigestOrch>[0]

function digest(over: Partial<ProjectChainDigest> = {}): ProjectChainDigest {
  // Cast because spreading a Partial re-optionalizes required fields; every one
  // of them is supplied by the literal below.
  return {
    projectId: 'F9',
    chainKey: 'c-1',
    date: '2026-06-02',
    title: 'Micron thesis',
    summary: 'Read the 10-K.',
    source: 'claude-code',
    msgCount: 20,
    // Must agree with the window below: durationMs is mechanical, so a fixture
    // that disagrees with its own chain is drift the projection will correct.
    durationMs: 1_800_000,
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T10:30:00.000Z',
    inputHash: 'h',
    generatedAt: '2026-06-02T10:35:00.000Z',
    model: 'test',
    generator: 'local',
    filesWritten: [],
    filesRead: [],
    undertaking: [],
    activeDurationMs: 0,
    ...over,
  } as ProjectChainDigest
}

function chain(touchedPaths?: string[], activeDurationMs?: number): ActivityChain {
  return {
    key: 'c-1',
    project: 'F9',
    source: 'claude-code',
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T10:30:00.000Z',
    msgCount: 20,
    topic: 'Micron',
    touchedPaths,
    activeDurationMs,
  } as unknown as ActivityChain
}

describe('ensureChainDigestOrch — pointer reconciliation (A1)', () => {
  beforeEach(() => {
    stored = null
    putProjectChainDigestBlock.mockClear()
  })

  it('backfills pointers onto a frozen pointer-less digest, no model call', async () => {
    stored = digest({ filesWritten: [] })
    const res = await ensureChainDigestOrch(
      chain(['/vault/acceleration_core/F9/micron.md', '/vault/acceleration_core/F9/hbm.md']),
    )
    expect(res?.digest.filesWritten).toEqual([
      'acceleration_core/F9/hbm.md',
      'acceleration_core/F9/micron.md',
    ])
    // Model-derived fields survive untouched.
    expect(res?.digest.title).toBe('Micron thesis')
    expect(putProjectChainDigestBlock).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite when pointers already match', async () => {
    stored = digest({ filesWritten: ['acceleration_core/F9/micron.md'] })
    await ensureChainDigestOrch(chain(['/vault/acceleration_core/F9/micron.md']))
    expect(putProjectChainDigestBlock).not.toHaveBeenCalled()
  })

  it('heals activeDurationMs onto a digest written before the field existed', async () => {
    stored = digest({ activeDurationMs: 0 })
    const res = await ensureChainDigestOrch(
      chain(['/vault/acceleration_core/F9/micron.md'], 900_000),
    )
    expect(res?.digest.activeDurationMs).toBe(900_000)
  })

  it('does NOT touch activeDurationMs when the chain never measured it', async () => {
    // No per-message timing on this device/source → chain.activeDurationMs is
    // undefined → leave the stored value, same no-stomp rule as pointers.
    stored = digest({ activeDurationMs: 720_000, filesWritten: ['acceleration_core/F9/micron.md'] })
    const res = await ensureChainDigestOrch(chain(['/vault/acceleration_core/F9/micron.md']))
    expect(res?.digest.activeDurationMs).toBe(720_000)
    expect(putProjectChainDigestBlock).not.toHaveBeenCalled()
  })

  it('does NOT stomp stored pointers when the chain carries no provenance', async () => {
    // iPhone/web: no IPC to read ~/.claude, so native chains parse with no
    // touchedPaths. Good pointers written by Electron and synced via the vault
    // must survive — replacing them with [] because this device is blind is
    // the exact regression the guard prevents.
    stored = digest({ filesWritten: ['acceleration_core/F9/micron.md'] })
    const res = await ensureChainDigestOrch(chain(undefined))
    expect(res?.digest.filesWritten).toEqual(['acceleration_core/F9/micron.md'])
    expect(putProjectChainDigestBlock).not.toHaveBeenCalled()
  })
})

// A2: the failure above was never really about pointers — it was that the
// digest stores a *copy* of fields that are pure functions of the chain, and
// nothing said which copy to believe. The answer is that the chain in hand
// always wins; the stored copy is transport for devices that cannot derive one.
// These tests pin the projection, so a newly added mechanical field is covered
// without new plumbing.
describe('ensureChainDigestOrch — the chain in hand wins (A2)', () => {
  beforeEach(() => {
    stored = null
    putProjectChainDigestBlock.mockClear()
  })

  it('re-derives every mechanical field on a legacy digest in one pass', async () => {
    // The shape 462 of 469 stored digests were actually in: written before
    // pointer extraction existed, matching their own inputHash forever.
    stored = digest({ filesWritten: [], activeDurationMs: 0 })
    const res = await ensureChainDigestOrch(
      chain(['/vault/acceleration_core/F9/micron.md'], 900_000),
    )
    expect(res?.digest.filesWritten).toEqual(['acceleration_core/F9/micron.md'])
    expect(res?.digest.activeDurationMs).toBe(900_000)
    // Model-derived fields are never collateral damage — that is the whole
    // point of separating what costs a provider call from what does not.
    expect(res?.digest.title).toBe('Micron thesis')
    expect(res?.digest.summary).toBe('Read the 10-K.')
    expect(putProjectChainDigestBlock).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite a digest that already agrees with its chain', async () => {
    // The steady state: the projection is free, but the write must not be
    // repeated on every read.
    stored = digest({
      filesWritten: ['acceleration_core/F9/micron.md'],
      activeDurationMs: 900_000,
    })
    await ensureChainDigestOrch(chain(['/vault/acceleration_core/F9/micron.md'], 900_000))
    expect(putProjectChainDigestBlock).not.toHaveBeenCalled()
  })

  it('re-derives the chain window when the grouping rule moved it', async () => {
    // `buildChains` changed once already (concurrent sessions now split). A
    // digest whose window disagrees with its chain is the trace that grouping
    // shifted underneath it.
    stored = digest({
      endedIso: '2026-06-02T23:59:00.000Z',
      filesWritten: ['acceleration_core/F9/micron.md'],
    })
    const res = await ensureChainDigestOrch(chain(['/vault/acceleration_core/F9/micron.md']))
    expect(res?.digest.endedIso).toBe('2026-06-02T10:30:00.000Z')
  })
})
