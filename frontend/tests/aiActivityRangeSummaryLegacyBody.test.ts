import { describe, expect, it } from 'vitest'
import {
  parseRangeSummaryJsonBlock,
  parseRangeSummaryMarkdownBlock,
  stringifyRangeSummaryJsonBlock,
  type ProjectRangeSummary,
} from '@/services/lego_blocks/units/aiActivityRangeSummaryBlock'

/**
 * A record has TWO stores, and renaming a field only checked one.
 *
 * `ProjectRangeSummary.body` became `.summary` on the reasoning that the prose
 * is the markdown body on disk — read positionally, so the rename was free.
 * That was true of the vault mirror and false of the intelligence-cache
 * sidecar, which serializes field *names*. Every cached record still said
 * `body`, so `.summary` came back undefined and the home route crashed on it.
 *
 * The same two-store shape had already bitten once that day (deleting session
 * digest files did nothing because the cache answered first). One store is
 * never the whole story.
 */

function record(over: Partial<ProjectRangeSummary> = {}): ProjectRangeSummary {
  return {
    schemaVersion: 1,
    projectId: 'F9',
    rangeStartDate: '2026-07-13',
    rangeEndDate: '2026-07-17',
    summary: '1. Did the work.',
    provider: 'local-two-stage',
    model: 'qwen',
    chainKeys: ['c-1'],
    totalDurationMs: 60_000,
    inputHash: 'h',
    contentFingerprint: 'f',
    generatedAt: '2026-07-17T10:00:00.000Z',
    ...over,
  } as ProjectRangeSummary
}

describe('the JSON sidecar', () => {
  it('reads a legacy record whose prose is still under `body`', () => {
    const legacy = { ...record(), body: '1. Legacy prose.' } as Record<string, unknown>
    delete legacy.summary

    const parsed = parseRangeSummaryJsonBlock(JSON.stringify(legacy))

    expect(parsed).not.toBeNull()
    // The regression: this was `undefined`, and the renderer read `.length`
    // off it and took down the whole route.
    expect(parsed!.summary).toBe('1. Legacy prose.')
  })

  it('prefers `summary` when both keys are present', () => {
    const both = { ...record({ summary: 'current' }), body: 'stale' }
    expect(parseRangeSummaryJsonBlock(JSON.stringify(both))!.summary).toBe('current')
  })

  it('rejects a record carrying neither, rather than returning one with undefined prose', () => {
    const neither = { ...record() } as Record<string, unknown>
    delete neither.summary
    expect(parseRangeSummaryJsonBlock(JSON.stringify(neither))).toBeNull()
  })

  it('round-trips a current record', () => {
    const parsed = parseRangeSummaryJsonBlock(stringifyRangeSummaryJsonBlock(record()))
    expect(parsed!.summary).toBe('1. Did the work.')
  })
})

describe('the vault mirror', () => {
  it('was genuinely unaffected — the prose is positional there', () => {
    // Frontmatter keys plus the body after them. No field name to rename, which
    // is what made the rename look free.
    const md = [
      '---',
      'schemaVersion: 1',
      'projectId: F9',
      'rangeStartDate: 2026-07-13',
      'rangeEndDate: 2026-07-17',
      'provider: local-two-stage',
      'model: qwen',
      'inputHash: h',
      'generatedAt: 2026-07-17T10:00:00.000Z',
      '---',
      '1. Prose that was never keyed.',
    ].join('\n')

    const parsed = parseRangeSummaryMarkdownBlock(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.summary).toContain('never keyed')
  })
})
