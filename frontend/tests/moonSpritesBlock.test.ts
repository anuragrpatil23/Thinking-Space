import { describe, expect, it } from 'vitest'
import { PALETTE, spritePathsBlock } from '@/services/lego_blocks/units/moonSpritesBlock'

describe('spritePathsBlock', () => {
  it('merges same-coloured runs and skips transparent pixels', () => {
    const paths = spritePathsBlock(['WW.O', '.WWW'])
    expect(paths).toEqual([
      { color: PALETTE.W, d: 'M0 0h2v1h-2zM1 1h3v1h-3z' },
      { color: PALETTE.O, d: 'M3 0h1v1h-1z' },
    ])
  })

  it('draws nothing for an empty sprite', () => {
    expect(spritePathsBlock(['....'])).toEqual([])
  })
})
