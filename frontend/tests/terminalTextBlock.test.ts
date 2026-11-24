import { describe, expect, it } from 'vitest'
import { terminalTextBlock } from '@/services/lego_blocks/units/terminalTextBlock'

describe('terminalTextBlock', () => {
  it('keeps the last state of a redrawn line and drops colour codes', () => {
    const log = 'start\nLoading:   0%|  | 0/760\rLoading:  50%|# | 380/760\rLoading: 100%|##| 760/760\n\u001b[33mwarning\u001b[0m done\r\n'
    expect(terminalTextBlock(log)).toBe('start\nLoading: 100%|##| 760/760\nwarning done\n')
  })
})
