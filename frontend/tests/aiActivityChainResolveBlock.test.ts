import { describe, expect, it } from 'vitest'
import { resolveChainDigestsBlock } from '@/services/lego_blocks/units/aiActivityChainResolveBlock'

// A chain's key is the grouping rule's opinion about which session sorts first.
// Its digest is addressed by a frozen id. These tests pin the cases where those
// two disagree — every one of which used to strand a record and cost a fresh
// provider call for a title that was already on disk.

const chain = (key: string, sessions: string[]) => ({ key, sessions })
const digest = (chainId: string, sessions?: string[]) => ({ chainId, sessions })

describe('resolveChainDigestsBlock', () => {
  it('matches on exact id when the grouping has not moved', () => {
    const map = resolveChainDigestsBlock(
      [chain('F9::a', ['a', 'b'])],
      [digest('F9::a', ['a', 'b'])],
    )
    expect(map.get('F9::a')?.chainId).toBe('F9::a')
  })

  it('matches a pre-v4 digest, which has no sessions to overlap on', () => {
    // Its id still equals its key, so pass 1 is the only path it can take —
    // and the only one it needs.
    const map = resolveChainDigestsBlock([chain('F9::a', ['a'])], [digest('F9::a', undefined)])
    expect(map.get('F9::a')?.chainId).toBe('F9::a')
  })

  it('finds the digest when an earlier session moves the key', () => {
    // The orphaning case: same work, but a session discovered before the old
    // head renamed the chain. Membership says it is the same chain.
    const map = resolveChainDigestsBlock(
      [chain('F9::a', ['a', 'b', 'c'])],
      [digest('F9::b', ['b', 'c'])],
    )
    expect(map.get('F9::a')?.chainId).toBe('F9::b')
  })

  it('gives a split chain its digest to the piece with the most members', () => {
    // Regrouping breaks [a,b,c] into [a,b] and [c]. The digest describes the
    // work in [a,b], so that piece keeps it and [c] starts fresh rather than
    // inheriting a summary about work it did not do.
    const map = resolveChainDigestsBlock(
      [chain('F9::a', ['a', 'b']), chain('F9::c', ['c'])],
      [digest('F9::old', ['a', 'b', 'c'])],
    )
    expect(map.get('F9::a')?.chainId).toBe('F9::old')
    expect(map.has('F9::c')).toBe(false)
  })

  it('never hands one digest to two chains', () => {
    const map = resolveChainDigestsBlock(
      [chain('F9::a', ['a']), chain('F9::b', ['b'])],
      [digest('F9::old', ['a', 'b'])],
    )
    const claimed = [...map.values()].map(d => d.chainId)
    expect(claimed).toHaveLength(1)
  })

  it('settles a merge on the surviving head rather than by overlap', () => {
    // Chains [a] and [b] merge into [a,b], keyed on a. Both old digests overlap
    // it equally; the exact-id pass makes the answer deterministic.
    const map = resolveChainDigestsBlock(
      [chain('F9::a', ['a', 'b'])],
      [digest('F9::b', ['b']), digest('F9::a', ['a'])],
    )
    expect(map.get('F9::a')?.chainId).toBe('F9::a')
  })

  it('leaves a chain unmatched when nothing overlaps, rather than guessing', () => {
    const map = resolveChainDigestsBlock(
      [chain('F9::new', ['x'])],
      [digest('F9::old', ['a', 'b'])],
    )
    expect(map.size).toBe(0)
  })

  it('is order-independent — the same inputs shuffled give the same answer', () => {
    // Identity that depends on iteration order is the defect one layer down
    // (chain keys once depended on readdir order). It must not reappear here.
    const chains = [chain('F9::a', ['a', 'b']), chain('F9::c', ['c', 'd'])]
    const stored = [digest('F9::x', ['b']), digest('F9::y', ['d'])]

    const forward = resolveChainDigestsBlock(chains, stored)
    const reversed = resolveChainDigestsBlock([...chains].reverse(), [...stored].reverse())

    expect(forward.get('F9::a')?.chainId).toBe(reversed.get('F9::a')?.chainId)
    expect(forward.get('F9::c')?.chainId).toBe(reversed.get('F9::c')?.chainId)
  })

  it('prefers the stronger overlap when two chains compete for one digest', () => {
    const map = resolveChainDigestsBlock(
      [chain('F9::weak', ['c']), chain('F9::strong', ['a', 'b', 'c'])],
      [digest('F9::old', ['a', 'b', 'c'])],
    )
    expect(map.get('F9::strong')?.chainId).toBe('F9::old')
    expect(map.has('F9::weak')).toBe(false)
  })

  it('returns empty for empty inputs without throwing', () => {
    expect(resolveChainDigestsBlock([], []).size).toBe(0)
    expect(resolveChainDigestsBlock([chain('F9::a', ['a'])], []).size).toBe(0)
    expect(resolveChainDigestsBlock([], [digest('F9::a', ['a'])]).size).toBe(0)
  })
})
