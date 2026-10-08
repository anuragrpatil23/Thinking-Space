import { describe, expect, it } from 'vitest'
import { nextPinchZoomFactorBlock } from '../src/services/lego_blocks/units/webviewPinchZoomBlock'

describe('nextPinchZoomFactorBlock', () => {
  it('zooms in when fingers move apart (negative delta) and out when they close', () => {
    expect(nextPinchZoomFactorBlock(1, -10)).toBeGreaterThan(1)
    expect(nextPinchZoomFactorBlock(1, 10)).toBeLessThan(1)
  })

  it('is symmetric: the same pinch back returns to where it started', () => {
    expect(nextPinchZoomFactorBlock(nextPinchZoomFactorBlock(1, -30), 30)).toBeCloseTo(1, 1)
  })

  it('stays within 50% and 300%', () => {
    expect(nextPinchZoomFactorBlock(2.9, -500)).toBe(3)
    expect(nextPinchZoomFactorBlock(0.6, 500)).toBe(0.5)
  })

  it('ignores a pinch that carries no movement or nonsense', () => {
    expect(nextPinchZoomFactorBlock(1.25, 0)).toBe(1.25)
    expect(nextPinchZoomFactorBlock(1.25, Number.NaN)).toBe(1.25)
    expect(nextPinchZoomFactorBlock(Number.NaN, -10)).toBe(1)
  })
})
