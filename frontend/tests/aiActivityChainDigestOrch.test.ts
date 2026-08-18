import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSessionDigest } from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'

/**
 * The chain layer is now DERIVED — composed from session digests, stored at no
 * chain-shaped address.
 *
 * What this file used to test is gone: pointer backfill onto frozen digests,
 * mechanical-field healing, no-stomp guards on a device that cannot see the
 * transcript, re-derivation of a chain window when the grouping rule moved it.
 * Every one of those existed to keep a *persisted chain record* in step with a
 * chain that could be regrouped underneath it. There is no such record now, so
 * there is nothing to keep in step and nothing to heal.
 *
 * What replaces them is the property that made all of it unnecessary:
 *
 *   - a one-session chain passes its session's digest straight through, with no
 *     model call at all (64% of real chains);
 *   - a multi-session chain composes, and degrades to a labelled concatenation
 *     rather than to a lesser blended paraphrase;
 *   - nothing about the chain is written anywhere.
 */

const sessionDigests = new Map<string, ProjectSessionDigest>()
const ensureSessionDigestOrch = vi.fn(async (session: { path: string }) => {
  const digest = sessionDigests.get(session.path)
  return digest ? { digest, isAi: true } : null
})

vi.mock('@/services/orchestrators/aiActivitySessionDigestOrch', () => ({
  ensureSessionDigestOrch: (s: { path: string }) => ensureSessionDigestOrch(s),
  loadSessionDigestOrch: async (s: { path: string }) => sessionDigests.get(s.path) ?? null,
}))

vi.mock('@/services/lego_blocks/units/storageKeyBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/storageKeyBlock')>()),
  getStoredVaultRoot: () => '/vault',
  getAiActivityAiTitlesEnabled: () => true,
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/providerRegistryBlock', () => ({
  currentGenerationSourceBlock: () => 'local',
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock', () => ({
  intelligenceCacheAvailableBlock: () => true,
}))

// Typed as variadic so the recorded calls keep their arguments: with a
// zero-parameter mock, `mock.calls[0]` is the empty tuple and asserting on what
// the orchestrator actually passed is a type error.
const runContract = vi.fn(async (..._args: unknown[]) => ({
  ok: false,
  value: undefined,
  providerId: 'local',
}))
vi.mock('@/services/orchestrators/intelligenceOrch', () => ({
  availability: async () => ({ available: true }),
  runContract: (...args: unknown[]) => runContract(...(args as [])),
}))

const { ensureChainDigestOrch } = await import(
  '@/services/orchestrators/aiActivityChainDigestOrch'
)
type ActivityChain = Parameters<typeof ensureChainDigestOrch>[0]

function digest(over: Partial<ProjectSessionDigest> & { sessionId: string }): ProjectSessionDigest {
  return {
    projectId: 'F9',
    path: `native/claude/${over.sessionId}.jsonl`,
    date: '2026-06-02',
    title: 'Micron thesis',
    summary: '1. Read the 10-K.',
    source: 'claude-code',
    msgCount: 10,
    durationMs: 900_000,
    activeDurationMs: 600_000,
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T10:15:00.000Z',
    hadClear: false,
    filesWritten: [],
    filesRead: [],
    undertaking: [],
    inputHash: 'h',
    generatedAt: '2026-06-02T10:20:00.000Z',
    model: 'test',
    generator: 'local',
    ...over,
  } as ProjectSessionDigest
}

/** Register a digest and return the ParsedSession-ish stub that resolves to it. */
function seed(over: Partial<ProjectSessionDigest> & { sessionId: string }) {
  const d = digest(over)
  sessionDigests.set(d.path, d)
  return { path: d.path, startedIso: d.startedIso, endedIso: d.endedIso }
}

function chain(sessions: Array<{ path: string }>): ActivityChain {
  return {
    key: `F9::${sessions[0].path}`,
    project: 'F9',
    source: 'claude-code',
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T12:00:00.000Z',
    msgCount: 0,
    topic: 'topic',
    sessions,
  } as unknown as ActivityChain
}

beforeEach(() => {
  sessionDigests.clear()
  ensureSessionDigestOrch.mockClear()
  runContract.mockClear()
})

describe('a single-session chain is a pass-through', () => {
  it('returns the session digest verbatim and never calls the model', async () => {
    const s = seed({ sessionId: 's1', title: 'Read the Micron 10-K', summary: '1. Skimmed it.' })
    const result = await ensureChainDigestOrch(chain([s]))

    expect(result?.digest.title).toBe('Read the Micron 10-K')
    expect(result?.digest.summary).toBe('1. Skimmed it.')
    // The whole economic argument for this layer: the common case is free.
    expect(runContract).not.toHaveBeenCalled()
    expect(result?.digest.stitched).toBe(false)
  })

  it('rolls up the member as the chain aggregates', async () => {
    const s = seed({ sessionId: 's1', msgCount: 12, filesWritten: ['a.md'] })
    const result = await ensureChainDigestOrch(chain([s]))

    expect(result?.digest.msgCount).toBe(12)
    expect(result?.digest.filesWritten).toEqual(['a.md'])
    expect(result?.digest.sessions).toHaveLength(1)
  })
})

describe('a multi-session chain composes', () => {
  it('asks the model once, over the member summaries', async () => {
    const a = seed({ sessionId: 's1', title: 'A', summary: '1. First.' })
    const b = seed({
      sessionId: 's2',
      title: 'B',
      summary: '1. Second.',
      startedIso: '2026-06-02T11:00:00.000Z',
      endedIso: '2026-06-02T11:30:00.000Z',
    })
    runContract.mockResolvedValueOnce({
      ok: true,
      value: { title: 'Composed title here', summary: '1. Merged.' },
      providerId: 'local',
    } as never)

    const result = await ensureChainDigestOrch(chain([a, b]))

    expect(runContract).toHaveBeenCalledTimes(1)
    // The contract input is summaries, never transcripts — that is what makes
    // this layer cheap and what stops it re-reading raw material per grouping.
    const input = runContract.mock.calls[0][1] as { sessions: Array<{ title: string }> }
    expect(input.sessions.map(s => s.title)).toEqual(['A', 'B'])
    expect(result?.digest.title).toBe('Composed title here')
    expect(result?.digest.stitched).toBe(true)
  })

  it('degrades to a labelled concatenation when the stitch fails', async () => {
    const a = seed({ sessionId: 's1', title: 'A', summary: '1. First.' })
    const b = seed({
      sessionId: 's2',
      title: 'B',
      summary: '1. Second.',
      startedIso: '2026-06-02T11:00:00.000Z',
      endedIso: '2026-06-02T11:30:00.000Z',
    })
    // runContract default is { ok: false } — the failure path.
    const result = await ensureChainDigestOrch(chain([a, b]))

    // Honest rather than lesser: both summaries survive intact, and the result
    // is not marked stitched, so nothing downstream can mistake a concatenation
    // for a composition the model actually reasoned about.
    expect(result?.digest.summary).toContain('1. First.')
    expect(result?.digest.summary).toContain('1. Second.')
    expect(result?.digest.stitched).toBe(false)
  })

  it('sums the members rather than trusting any one of them', async () => {
    const a = seed({ sessionId: 's1', msgCount: 10, activeDurationMs: 600_000, filesWritten: ['a.md'] })
    const b = seed({
      sessionId: 's2',
      msgCount: 5,
      activeDurationMs: 300_000,
      filesWritten: ['b.md'],
      startedIso: '2026-06-02T11:00:00.000Z',
      endedIso: '2026-06-02T11:30:00.000Z',
    })
    const result = await ensureChainDigestOrch(chain([a, b]))

    expect(result?.digest.msgCount).toBe(15)
    expect(result?.digest.activeDurationMs).toBe(900_000)
    expect(result?.digest.filesWritten).toEqual(['a.md', 'b.md'])
  })

  it('unions the members undertakings rather than picking the first', async () => {
    // A chain groups by time, so it can span two topics. Its assignment set is
    // therefore the union — the authoritative per-sitting binding stays below.
    const a = seed({ sessionId: 's1', undertaking: ['u-broadcom'] })
    const b = seed({
      sessionId: 's2',
      undertaking: ['u-personalities'],
      startedIso: '2026-06-02T11:00:00.000Z',
      endedIso: '2026-06-02T11:30:00.000Z',
    })
    const result = await ensureChainDigestOrch(chain([a, b]))

    expect(result?.digest.undertaking).toEqual(['u-broadcom', 'u-personalities'])
    expect(result?.digest.sessions.map(s => s.undertaking)).toEqual([
      ['u-broadcom'],
      ['u-personalities'],
    ])
  })
})

describe('a chain with no generated members', () => {
  it('returns null rather than inventing a chain out of nothing', async () => {
    expect(await ensureChainDigestOrch(chain([{ path: 'native/claude/absent.jsonl' }]))).toBeNull()
  })
})
