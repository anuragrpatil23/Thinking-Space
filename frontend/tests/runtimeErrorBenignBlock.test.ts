import { describe, expect, it } from 'vitest'
import { isBenignWindowErrorBlock } from '@/services/lego_blocks/units/runtimeErrorBlock'

const errorEvent = (message: string) => ({ type: 'error', message }) as unknown as Event

describe('isBenignWindowErrorBlock', () => {
  it('ignores the ResizeObserver loop notices', () => {
    expect(isBenignWindowErrorBlock(errorEvent('ResizeObserver loop completed with undelivered notifications.'))).toBe(true)
    expect(isBenignWindowErrorBlock(errorEvent('ResizeObserver loop limit exceeded'))).toBe(true)
  })

  it('keeps real errors', () => {
    expect(isBenignWindowErrorBlock(errorEvent("TypeError: Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })
})
