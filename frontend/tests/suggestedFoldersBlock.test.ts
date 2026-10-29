import { describe, it, expect } from 'vitest'

import { suggestedFoldersBlock } from '@/services/lego_blocks/units/noteComposerBlock'

describe('suggestedFoldersBlock', () => {
  it('leads with the current folder and never repeats one', () => {
    expect(suggestedFoldersBlock({
      current: 'thoughts',
      recent: ['thoughts', 'a', 'b'],
      mostUsed: ['thoughts', 'b', 'a'],
      browsed: ['a'],
    })).toEqual(['thoughts', 'a', 'b'])
  })

  it('ranks a folder that is both recent and frequent above one that is only either', () => {
    expect(suggestedFoldersBlock({
      current: '',
      recent: ['only-recent', 'both', 'r'],
      mostUsed: ['only-used', 'both', 'u'],
      browsed: [],
    })[0]).toBe('both')
  })

  it('caps the list', () => {
    expect(suggestedFoldersBlock({
      current: 'x', recent: ['a', 'b', 'c', 'd', 'e', 'f'], mostUsed: [], browsed: [], limit: 5,
    })).toHaveLength(5)
  })
})
