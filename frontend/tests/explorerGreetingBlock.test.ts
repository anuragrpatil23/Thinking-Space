import { describe, expect, it } from 'vitest'
import { explorerGreetingBlock, explorerGreetingPartsBlock, greetingForHourBlock } from '@/services/lego_blocks/units/explorerGreetingBlock'

describe('explorerGreetingBlock', () => {
  const evening = new Date(2026, 9, 20, 19, 0)

  it('follows the time of day', () => {
    expect(greetingForHourBlock(8)).toBe('Good morning')
    expect(greetingForHourBlock(14)).toBe('Good afternoon')
    expect(greetingForHourBlock(20)).toBe('Good evening')
    expect(greetingForHourBlock(2)).toBe('Good evening')
  })

  it('uses the first name when there is one', () => {
    expect(explorerGreetingBlock('Anurag Patil', evening)).toBe('Good evening, Anurag')
    expect(explorerGreetingBlock('', evening)).toBe('Good evening')
    expect(explorerGreetingBlock(null, evening)).toBe('Good evening')
  })

  it('splits the greeting from the name', () => {
    expect(explorerGreetingPartsBlock('Anurag Patil', evening)).toEqual({ greeting: 'Good evening', name: 'Anurag' })
    expect(explorerGreetingPartsBlock(null, evening)).toEqual({ greeting: 'Good evening', name: '' })
  })
})
