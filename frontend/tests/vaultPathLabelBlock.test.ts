import { describe, expect, it } from 'vitest'
import {
  commonVaultFolderBlock,
  vaultPathLabelBlock,
} from '@/services/lego_blocks/units/vaultPathLabelBlock'

describe('vaultPathLabelBlock', () => {
  it('leads with the file name and drops the extension', () => {
    expect(vaultPathLabelBlock('acceleration_core/F9/AI Synthesis/Interconnect.md')).toEqual({
      name: 'Interconnect',
      folder: 'acceleration_core/F9/AI Synthesis',
    })
  })

  it('strips a shared prefix from the folder', () => {
    // What made the list unreadable: every row opened with the project folder.
    expect(vaultPathLabelBlock('acceleration_core/F9/AI Synthesis/Optics.md', 'acceleration_core/F9'))
      .toEqual({ name: 'Optics', folder: 'AI Synthesis' })
  })

  it('empties the folder when the file sits directly in the shared prefix', () => {
    expect(vaultPathLabelBlock('a/b/Notes.md', 'a/b')).toEqual({ name: 'Notes', folder: '' })
  })

  it('leaves a non-matching prefix alone', () => {
    // A path from outside the shared root must not be silently re-rooted.
    expect(vaultPathLabelBlock('other/place/Notes.md', 'a/b')).toEqual({
      name: 'Notes',
      folder: 'other/place',
    })
  })

  it('handles a bare file name', () => {
    expect(vaultPathLabelBlock('README.md')).toEqual({ name: 'README', folder: '' })
  })
})

describe('commonVaultFolderBlock', () => {
  it('returns the deepest folder every path shares', () => {
    expect(
      commonVaultFolderBlock([
        'acceleration_core/F9/AI Synthesis/a.md',
        'acceleration_core/F9/F9-execution/b.md',
      ]),
    ).toBe('acceleration_core/F9')
  })

  it('returns the whole folder when the files sit together', () => {
    expect(commonVaultFolderBlock(['a/b/one.md', 'a/b/two.md'])).toBe('a/b')
  })

  it('returns empty when the paths share no root', () => {
    expect(commonVaultFolderBlock(['a/one.md', 'b/two.md'])).toBe('')
  })

  it('returns empty for a single path', () => {
    // Nothing to compare against — stripping would hide its whole location.
    expect(commonVaultFolderBlock(['a/b/one.md'])).toBe('')
  })
})
