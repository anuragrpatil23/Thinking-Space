import { describe, expect, it } from 'vitest'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'

describe('a result remembered across mounts', () => {
  it('computes once per input snapshot, and again for a new one', () => {
    let runs = 0
    const snapshot = [1, 2, 3]
    const compute = () => { runs += 1; return snapshot.length }
    expect(identityMemoBlock('t', [snapshot], compute)).toBe(3)
    expect(identityMemoBlock('t', [snapshot], compute)).toBe(3)
    expect(runs).toBe(1)
    expect(identityMemoBlock('t', [[...snapshot]], compute)).toBe(3)
    expect(runs).toBe(2)
  })
})
