import { beforeEach, describe, expect, it, vi } from 'vitest'

// What this file pins: the local two-stage range pipeline used to degrade
// silently to the deterministic fallback once a range held more chains than the
// labeler could emit assignment lines for. The cascade spans four functions, so
// it is asserted end-to-end here:
//
//   labeler output clipped  →  unassigned chains default to 'Misc'
//   →  Misc absorbs most of the range's duration
//   →  every surviving theme falls under MISC_MIN_FRAC
//   →  arcCandidates is empty  →  buildFallbackSummary
//
// On real vault data that showed up as a cliff: every range with 35+ chains
// produced `fallback-titles`, every range with 10-34 produced
// `local-two-stage`. The fix batches stage 1 so no single response has to be
// long. The fake below models the ceiling rather than a hand-picked cutoff —
// it emits at most LINE_CEILING assignment lines per call, whatever it was
// asked about, which is what a token-capped model does.

const LINE_CEILING = 34

const runContract = vi.fn()
const putProjectRangeSummaryBlock = vi.fn(async (..._args: unknown[]) => {})
const getProjectRangeSummaryBlock = vi.fn(async (..._args: unknown[]) => null)

vi.mock('@/services/orchestrators/intelligenceOrch', () => ({
  runContract: (...args: unknown[]) => runContract(...args),
}))

vi.mock('@/services/lego_blocks/integrations/aiActivityRangeSummaryStoreBlock', () => ({
  getProjectRangeSummaryBlock: (...args: unknown[]) => getProjectRangeSummaryBlock(...args),
  putProjectRangeSummaryBlock: (...args: unknown[]) => putProjectRangeSummaryBlock(...args),
}))

const { ensureRangeSummaryOrch } = await import(
  '@/services/orchestrators/aiActivityRangeSummaryOrch'
)
type EnsureInput = Parameters<typeof ensureRangeSummaryOrch>[0]
type LabelInput = {
  chains: Array<{ shortKey: string }>
  existingThemes?: string[]
}

/** N chains, one per day, each an hour long — so no single chain dominates and
 *  the Misc/arc split turns purely on how many chains got assigned. */
function makeChains(n: number): EnsureInput['chains'] {
  return Array.from({ length: n }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, '0')
    return {
      chainKey: `chain-${i + 1}`,
      date: `2026-06-${day}`,
      startedIso: `2026-06-${day}T09:00:00.000Z`,
      endedIso: `2026-06-${day}T10:00:00.000Z`,
      title: `Session ${i + 1} title`,
      summary: `1. Did work item ${i + 1}.`,
      durationMs: 60 * 60_000,
      msgCount: 40,
    }
  })
}

function input(chains: EnsureInput['chains']): EnsureInput {
  return {
    projectId: 'F9',
    projectLabel: 'Thinking Space',
    rangeStartDate: '2026-06-01',
    rangeEndDate: '2026-06-28',
    chains,
    providerOverride: 'local',
    refresh: true,
  }
}

const THEMES = ['Editor work', 'iOS memory', 'Organizer']

const NARRATE_REPLY = {
  ok: true,
  value: { body: '## Narrated\n\nThe model ran.' },
  model: 'local-test',
  meta: { model: 'local-test' },
}

const labelCalls: LabelInput[] = []

/** Install a labeler that answers about the chains it was given, but stops
 *  after `ceiling` assignment lines — the token cap, expressed behaviorally. */
function installLabeler(ceiling = LINE_CEILING) {
  labelCalls.length = 0
  runContract.mockImplementation(async (contract: { id: string }, contractInput: LabelInput) => {
    if (contract.id !== 'range-summary-label') return NARRATE_REPLY
    labelCalls.push(contractInput)
    const assignments: Record<string, number> = {}
    contractInput.chains.slice(0, ceiling).forEach((c, i) => {
      assignments[c.shortKey] = (i % THEMES.length) + 1
    })
    return {
      ok: true,
      value: { themes: THEMES, assignments },
      model: 'local-test',
      meta: { model: 'local-test' },
    }
  })
}

describe('ensureRangeSummaryOrch — local two-stage stage-1 batching', () => {
  beforeEach(() => {
    runContract.mockReset()
    putProjectRangeSummaryBlock.mockClear()
    getProjectRangeSummaryBlock.mockClear()
  })

  it('narrates a small range', async () => {
    installLabeler()
    const result = await ensureRangeSummaryOrch(input(makeChains(12)))
    expect(result.provider).toBe('local-two-stage')
    expect(labelCalls).toHaveLength(1)
  })

  it('narrates past the old ~34-chain cliff by batching stage 1', async () => {
    installLabeler()
    const result = await ensureRangeSummaryOrch(input(makeChains(50)))
    expect(result.provider).toBe('local-two-stage')
    expect(result.body).toContain('Narrated')
    // 50 chains at a 24-chain batch size — every batch is short enough that
    // the ceiling never bites, so no chain silently becomes 'Misc'.
    expect(labelCalls).toHaveLength(3)
    expect(labelCalls.every(c => c.chains.length <= LINE_CEILING)).toBe(true)
  })

  it('handles a month-sized range that a single call could never label', async () => {
    installLabeler()
    const result = await ensureRangeSummaryOrch(input(makeChains(259)))
    expect(result.provider).toBe('local-two-stage')
    expect(labelCalls).toHaveLength(11)
  })

  it('carries established theme names into later batches', async () => {
    installLabeler()
    await ensureRangeSummaryOrch(input(makeChains(50)))
    expect(labelCalls[0].existingThemes).toEqual([])
    // The second batch is told what the first batch already named, so a
    // workstream spanning both comes back under one label instead of two
    // near-synonyms that cluster apart.
    expect(labelCalls[1].existingThemes).toEqual(THEMES)
  })

  it('parks a single failed batch as Misc and still narrates', async () => {
    installLabeler()
    const real = runContract.getMockImplementation()!
    let labelCallCount = 0
    runContract.mockImplementation(async (contract: { id: string }, ci: LabelInput) => {
      if (contract.id === 'range-summary-label' && labelCallCount++ === 1) {
        return { ok: false, value: undefined }
      }
      return real(contract, ci)
    })
    const result = await ensureRangeSummaryOrch(input(makeChains(50)))
    expect(result.provider).toBe('local-two-stage')
  })

  it('falls back when every batch fails', async () => {
    runContract.mockImplementation(async (contract: { id: string }) => {
      if (contract.id === 'range-summary-label') return { ok: false, value: undefined }
      return NARRATE_REPLY
    })
    const result = await ensureRangeSummaryOrch(input(makeChains(50)))
    expect(result.provider).toBe('fallback-titles')
  })

  it('still falls back when the labeler answers but assigns nothing', async () => {
    // The downstream cascade is intact as a safety net: no assignments means
    // everything is Misc, Misc is excluded from arcs, and an empty arc set
    // must not produce an empty summary.
    installLabeler(0)
    const result = await ensureRangeSummaryOrch(input(makeChains(50)))
    expect(result.provider).toBe('fallback-titles')
  })
})
