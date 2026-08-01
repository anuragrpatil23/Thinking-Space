import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectChainDigest } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'

// The organizer reaches chains through `listChainsBlock`, which parses stored
// digests straight off disk — so the undertaking drawer rendered whatever was
// frozen at first write, which for 462 of 469 records meant no file pointers at
// all, while the provenance sat in the session cache the whole time.
//
// The fix is not a repair pass. Mechanical fields are recomputed from the live
// chain on every read, and the stored copy is demoted to transport for devices
// that cannot derive chains. These tests pin that: the returned value comes from
// the chain, and the on-disk write is a side effect nothing depends on.

let storedChains: Array<ProjectChainDigest & { path: string }> = []
const listChainsBlock = vi.fn(async () => storedChains)

vi.mock('@/services/lego_blocks/integrations/aiActivityChainIndexBlock', () => ({
  listChainsBlock: (q: unknown) => listChainsBlock(q as never),
  listChainDatesBlock: async () => ['2026-07-14'],
}))

const put = vi.fn(async () => undefined)
vi.mock('@/services/lego_blocks/integrations/aiActivityChainDigestStoreBlock', () => ({
  getProjectChainDigestBlock: async () => null,
  putProjectChainDigestBlock: (d: unknown) => put(d as never),
}))

vi.mock('@/services/lego_blocks/units/storageKeyBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/storageKeyBlock')>()),
  getStoredVaultRoot: () => '/vault',
}))

// The sessions the canonical derivation will chain. Shaped like the reported
// bug: one chain, two study pages written, no digest that knows about them.
let rawSessions: unknown[] = []
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({ list: async () => ({ folders: ['F9'], files: [] }) }),
}))
vi.mock('@/services/lego_blocks/integrations/aiActivityCacheBlock', () => ({
  loadAiActivity: async () => ({ sessions: rawSessions }),
}))
vi.mock('@/services/lego_blocks/integrations/projectRegistryLoaderBlock', () => ({
  loadProjectRegistryBlock: async () => undefined,
}))
vi.mock('@/services/lego_blocks/units/aiActivityMappingBlock', () => ({
  resolveCanonicalProjectBlock: (project: string) => project,
}))

const { listProjectChainsOrch } = await import(
  '@/services/orchestrators/aiActivityChainReconcileOrch'
)

const WRITTEN = [
  'acceleration_core/F9/F9-execution/watchlist/cohr/cohr-study.md',
  'acceleration_core/F9/F9-execution/watchlist/lite/lite-study.md',
]

function digest(over: Partial<ProjectChainDigest> = {}): ProjectChainDigest & { path: string } {
  return {
    projectId: 'F9',
    chainId: 'F9::s-1',
    sessions: ['s-1'],
    chainKey: 'F9::s-1',
    date: '2026-07-14',
    title: 'Coherent vs Lumentum',
    summary: 'Built a 2028 P&L.',
    source: 'claude-code',
    msgCount: 48,
    durationMs: 17_964_974,
    activeDurationMs: 0,
    startedIso: '2026-07-14T18:17:46.088Z',
    endedIso: '2026-07-14T23:17:11.062Z',
    inputHash: 'oay4ju',
    generatedAt: '2026-07-14T23:40:41.477Z',
    model: 'unknown',
    generator: 'local',
    filesWritten: [],
    filesRead: [],
    undertaking: [],
    path: 'ai-activity/chains/F9/2026-07-14/s-1.md',
    ...over,
  }
}

function session() {
  return {
    id: 's-1',
    path: 's-1',
    project: 'F9',
    source: 'claude-code',
    startedIso: '2026-07-14T18:17:46.088Z',
    endedIso: '2026-07-14T23:17:11.062Z',
    msgCount: 48,
    topic: 'lumentum and coherent. both together',
    touchedPaths: WRITTEN.map(p => `/vault/${p}`),
    activeDurationMs: 17_964_974,
  }
}

describe('listProjectChainsOrch', () => {
  beforeEach(async () => {
    // The refresh write is fire-and-forget, so let any straggler from the
    // previous test land before clearing — otherwise it is counted here.
    await new Promise(r => setTimeout(r, 0))
    put.mockClear()
    listChainsBlock.mockClear()
    rawSessions = [session()]
  })

  it('returns pointers from the live chain even though the stored digest has none', async () => {
    // The reported bug in miniature. Nothing was migrated; the frozen record is
    // simply not what the reader trusts.
    storedChains = [digest()]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.filesWritten).toEqual(WRITTEN)
    expect(chain.activeDurationMs).toBe(17_964_974)
    expect(chain.path).toBe('ai-activity/chains/F9/2026-07-14/s-1.md')
  })

  it('refreshes the stored copy so devices that cannot derive get the pointers too', async () => {
    storedChains = [digest()]
    await listProjectChainsOrch('F9')
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  })

  it('attributes the writes to the session that made them, not just to the chain', async () => {
    // A chain groups by time and can hold two topics; only the per-session
    // breakdown can say which of them wrote what. Derived here, so it is right
    // on every read regardless of what the stored copy says.
    storedChains = [digest()]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.filesBySession).toEqual([{ session: 's-1', files: [...WRITTEN].sort() }])
  })

  it('does not write when the stored copy already matches the chain', async () => {
    storedChains = [
      digest({
        filesWritten: WRITTEN,
        filesBySession: [{ session: 's-1', files: [...WRITTEN].sort() }],
        activeDurationMs: 17_964_974,
      }),
    ]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.filesWritten).toEqual(WRITTEN)
    await new Promise(r => setTimeout(r, 0))
    expect(put).not.toHaveBeenCalled()
  })

  it('leaves a digest alone when no chain resolves its key', async () => {
    // Debris from a chaining-rule change — but far more often a chain this
    // device cannot see. The stored copy is exactly the transport for that case.
    storedChains = [
      digest({
        chainId: 'F9::vanished',
        chainKey: 'F9::vanished',
        sessions: ['gone'],
        filesWritten: ['kept.md'],
      }),
    ]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.filesWritten).toEqual(['kept.md'])
    await new Promise(r => setTimeout(r, 0))
    expect(put).not.toHaveBeenCalled()
  })

  it('finds a digest whose key moved, instead of stranding it', async () => {
    // The orphaning case end to end: the record was written when this chain
    // was keyed on a different head session. Membership says it is the same
    // chain, so its title survives and its pointers still refresh.
    storedChains = [
      digest({
        chainId: 'F9::older-head',
        chainKey: 'F9::older-head',
        sessions: ['s-1'],
        title: 'Title that cost a provider call',
      }),
    ]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.title).toBe('Title that cost a provider call')
    expect(chain.filesWritten).toEqual(WRITTEN)
    // The id is the address and is never reassigned — that is what makes the
    // record findable next time.
    expect(chain.chainId).toBe('F9::older-head')
    // The handle tracks the current grouping.
    expect(chain.chainKey).toBe('F9::s-1')
  })

  it('degrades to the stored copy when the chain derivation throws', async () => {
    // Deriving is an enhancement, never a precondition for reading.
    rawSessions = null as never
    storedChains = [digest({ filesWritten: ['transport.md'] })]
    const [chain] = await listProjectChainsOrch('F9')

    expect(chain.filesWritten).toEqual(['transport.md'])
  })
})
