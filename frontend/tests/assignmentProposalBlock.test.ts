import { describe, expect, it } from 'vitest'
import {
  buildQueueGroupsBlock,
  confidenceBandBlock,
  isAutoApplicableBlock,
  latestProposalsBlock,
  parseProposalLogBlock,
  serializeProposalBlock,
  targetIdBlock,
  type AssignmentProposalBlock,
  type ConfidenceBandBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'

/**
 * What these guard: the two rules that make the queue safe to clear fast.
 * A group is only as trustworthy as its weakest chain, and a mint is never
 * auto-applicable no matter how sure the model claims to be.
 */

function makeProposal(overrides: Partial<AssignmentProposalBlock> = {}): AssignmentProposalBlock {
  return {
    sessionId: 'c-1',
    projectId: 'F9',
    target: { kind: 'existing', key: 'f9-und-micron' },
    confidence: 0.9,
    rationale: 'Read the same 10-K.',
    proposedBy: 'kai',
    proposedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('confidence bands', () => {
  it('splits at the documented boundaries', () => {
    expect(confidenceBandBlock(0.85)).toBe('high')
    expect(confidenceBandBlock(0.84)).toBe('medium')
    expect(confidenceBandBlock(0.6)).toBe('medium')
    expect(confidenceBandBlock(0.59)).toBe('low')
  })
})

describe('auto-applicability', () => {
  const allBands = new Set<ConfidenceBandBlock>(['high', 'medium', 'low'])

  it('never auto-applies a mint, even at full confidence', () => {
    const proposal = makeProposal({ target: { kind: 'new', title: 'Something' }, confidence: 1 })
    expect(isAutoApplicableBlock(proposal, allBands)).toBe(false)
  })

  it('auto-applies an attach only when its band is trusted', () => {
    const high = makeProposal({ confidence: 0.9 })
    expect(isAutoApplicableBlock(high, new Set(['high']))).toBe(true)
    expect(isAutoApplicableBlock(high, new Set(['medium']))).toBe(false)
  })

  it('trusts nothing by default', () => {
    expect(isAutoApplicableBlock(makeProposal({ confidence: 1 }), new Set())).toBe(false)
  })

  it('treats the bucket as the reversible attach it is', () => {
    const bucket = makeProposal({ target: { kind: 'bucket' }, confidence: 0.9 })
    expect(isAutoApplicableBlock(bucket, new Set(['high']))).toBe(true)
  })
})

describe('latestProposalsBlock', () => {
  it('lets a re-proposal supersede the earlier one', () => {
    const latest = latestProposalsBlock([
      makeProposal({ target: { kind: 'bucket' }, proposedAt: '2026-08-02T10:00:00.000Z' }),
      makeProposal({
        target: { kind: 'existing', key: 'f9-und-hbm' },
        proposedAt: '2026-08-02T11:00:00.000Z',
      }),
    ])
    expect(latest).toHaveLength(1)
    expect(latest[0].target).toEqual({ kind: 'existing', key: 'f9-und-hbm' })
  })

  it('keeps every target in one batch, since a session can feed several strands', () => {
    // The bug this replaced: collapsing to one line per session dropped all but
    // the last target, so a session that named two undertakings had one of them
    // silently deleted between the log and the queue.
    const batch = '2026-08-17T23:43:34.457Z'
    const latest = latestProposalsBlock([
      makeProposal({ proposedBy: 'in-session', proposedAt: batch, target: { kind: 'existing', key: 'f9-und-micron' } }),
      makeProposal({ proposedBy: 'in-session', proposedAt: batch, target: { kind: 'new', title: 'How prices form' } }),
    ])
    expect(latest).toHaveLength(2)
  })

  it('supersedes per author, so a later batch replaces only that author', () => {
    const latest = latestProposalsBlock([
      makeProposal({ proposedBy: 'kai', proposedAt: '2026-08-02T10:00:00.000Z', target: { kind: 'bucket' } }),
      makeProposal({ proposedBy: 'kai', proposedAt: '2026-08-02T12:00:00.000Z', target: { kind: 'existing', key: 'f9-und-hbm' } }),
      makeProposal({ proposedBy: 'in-session', proposedAt: '2026-08-02T11:00:00.000Z', target: { kind: 'existing', key: 'f9-und-micron' } }),
    ])
    // Two live claims, one per author. A human should see that the sweep and
    // the agent disagreed rather than have one quietly overwrite the other.
    expect(latest).toHaveLength(2)
    expect(latest.map(p => p.proposedBy).sort()).toEqual(['in-session', 'kai'])
    expect(latest.find(p => p.proposedBy === 'kai')?.target).toEqual({ kind: 'existing', key: 'f9-und-hbm' })
  })

  it('does not merge sessions that merely share an author', () => {
    const latest = latestProposalsBlock([
      makeProposal({ sessionId: 'c-1', proposedAt: '2026-08-02T10:00:00.000Z' }),
      makeProposal({ sessionId: 'c-2', proposedAt: '2026-08-02T11:00:00.000Z' }),
    ])
    expect(latest).toHaveLength(2)
  })
})

describe('buildQueueGroupsBlock', () => {
  it('groups chains proposed for the same target', () => {
    const groups = buildQueueGroupsBlock([
      makeProposal({ sessionId: 'c-1' }),
      makeProposal({ sessionId: 'c-2' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].proposals.map(p => p.sessionId)).toEqual(['c-1', 'c-2'])
  })

  it('takes the weakest member as the group confidence, not the average', () => {
    const groups = buildQueueGroupsBlock([
      makeProposal({ sessionId: 'c-1', confidence: 0.95 }),
      makeProposal({ sessionId: 'c-2', confidence: 0.4 }),
    ])
    expect(groups[0].confidence).toBe(0.4)
  })

  it('never groups across projects, even for an identical target', () => {
    const groups = buildQueueGroupsBlock([
      makeProposal({ sessionId: 'c-1', projectId: 'F9' }),
      makeProposal({ sessionId: 'c-2', projectId: 'Thinking-Space' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('orders by confidence descending so the cheapest calls come first', () => {
    const groups = buildQueueGroupsBlock([
      makeProposal({ sessionId: 'c-1', target: { kind: 'bucket' }, confidence: 0.3 }),
      makeProposal({ sessionId: 'c-2', confidence: 0.99 }),
      makeProposal({ sessionId: 'c-3', target: { kind: 'new', title: 'New thing' }, confidence: 0.7 }),
    ])
    expect(groups.map(g => g.confidence)).toEqual([0.99, 0.7, 0.3])
  })

  it('breaks ties stably, so the list does not reshuffle under the cursor', () => {
    const build = () =>
      buildQueueGroupsBlock([
        makeProposal({ sessionId: 'c-1', target: { kind: 'existing', key: 'b' } }),
        makeProposal({ sessionId: 'c-2', target: { kind: 'existing', key: 'a' } }),
      ]).map(g => g.targetId)
    expect(build()).toEqual(build())
    expect(build()).toEqual(['existing:a', 'existing:b'])
  })

  it('groups two proposals of the same new title as one mint', () => {
    const groups = buildQueueGroupsBlock([
      makeProposal({ sessionId: 'c-1', target: { kind: 'new', title: 'Ghost sessions' } }),
      makeProposal({ sessionId: 'c-2', target: { kind: 'new', title: 'ghost sessions' } }),
    ])
    expect(groups).toHaveLength(1)
    expect(targetIdBlock(groups[0].target)).toBe('new:ghost sessions')
  })
})

describe('JSONL transport', () => {
  it('round-trips every target kind', () => {
    const originals = [
      makeProposal({ sessionId: 'c-1' }),
      makeProposal({ sessionId: 'c-2', target: { kind: 'new', title: 'T', section: 's', head: 'h' } }),
      makeProposal({ sessionId: 'c-3', target: { kind: 'bucket' } }),
    ]
    const parsed = parseProposalLogBlock(originals.map(serializeProposalBlock).join('\n'))
    expect(parsed.proposals).toEqual(originals)
    expect(parsed.skipped).toBe(0)
  })

  it('skips a corrupt line rather than losing the file', () => {
    const good = serializeProposalBlock(makeProposal())
    const parsed = parseProposalLogBlock(`${good}\n{"sessionId":\nnot json at all\n${good}`)
    expect(parsed.proposals).toHaveLength(2)
    // The count is the point: a silent skip here is what rendered an empty
    // queue over a full log after the chainId → sessionId rekey.
    expect(parsed.skipped).toBe(2)
    expect(parsed.samples).toHaveLength(2)
  })

  it('drops a line missing the fields that make it addressable', () => {
    expect(parseProposalLogBlock('{"projectId":"F9","target":{"kind":"bucket"}}')).toEqual({
      proposals: [],
      skipped: 1,
      samples: ['{"projectId":"F9","target":{"kind":"bucket"}}'],
    })
    expect(parseProposalLogBlock('{"sessionId":"c-1","projectId":"F9"}').proposals).toEqual([])
  })

  it('clamps a confidence outside 0–1 instead of trusting it', () => {
    const parsed = parseProposalLogBlock(
      '{"sessionId":"c-1","projectId":"F9","target":{"kind":"bucket"},"confidence":7}',
    )
    expect(parsed.proposals[0].confidence).toBe(1)
  })
})
