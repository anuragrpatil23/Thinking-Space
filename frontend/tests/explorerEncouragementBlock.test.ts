import { describe, expect, it } from 'vitest'
import { EXPLORER_ENCOURAGEMENTS_BLOCK, encouragementAtBlock } from '@/services/lego_blocks/units/explorerEncouragementBlock'

describe('encouragementAtBlock', () => {
  it('starts with a hello and wraps around', () => {
    expect(encouragementAtBlock(0)).toBe('hello!')
    expect(encouragementAtBlock(EXPLORER_ENCOURAGEMENTS_BLOCK.length)).toBe('hello!')
  })

  it('never repeats a line back to back', () => {
    for (let i = 0; i < EXPLORER_ENCOURAGEMENTS_BLOCK.length * 2; i += 1) {
      expect(encouragementAtBlock(i)).not.toBe(encouragementAtBlock(i + 1))
    }
  })
})
