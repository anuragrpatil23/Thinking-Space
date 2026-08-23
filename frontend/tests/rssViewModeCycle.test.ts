import { describe, expect, it } from 'vitest'
import { nextRssViewModeBlock, type RssViewModeBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

describe('nextRssViewModeBlock', () => {
  it('cycles compact -> timeline -> reels -> compact on a phone', () => {
    expect(nextRssViewModeBlock('compact', true)).toBe('timeline')
    expect(nextRssViewModeBlock('timeline', true)).toBe('reels')
    expect(nextRssViewModeBlock('reels', true)).toBe('compact')
  })

  it('skips reels where the surface cannot give a card the whole viewport', () => {
    expect(nextRssViewModeBlock('compact', false)).toBe('timeline')
    expect(nextRssViewModeBlock('timeline', false)).toBe('compact')
  })

  it('leaves reels even when it is unavailable, so the toggle never traps', () => {
    expect(nextRssViewModeBlock('reels', false)).toBe('compact')
  })

  it('returns to the start after one full cycle in both surfaces', () => {
    for (const available of [true, false]) {
      let mode: RssViewModeBlock = 'compact'
      const seen = new Set<RssViewModeBlock>([mode])
      for (let step = 0; step < 4; step++) {
        mode = nextRssViewModeBlock(mode, available)
        if (mode === 'compact') break
        seen.add(mode)
      }
      expect(mode).toBe('compact')
      expect(seen.has('reels')).toBe(available)
    }
  })
})
