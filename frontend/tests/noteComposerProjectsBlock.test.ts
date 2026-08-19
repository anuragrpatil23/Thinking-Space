import { describe, expect, it } from 'vitest'
import {
  noteKindShortcutIdBlock,
  numberedFilenameBlock,
  projectDestinationsBlock,
  projectForSegmentsBlock,
  unreachableQuickDestinationPathsBlock,
  vaultRelativeProjectRootBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'

/** Shaped like the real `.thinking-space/projects.json`, including the two
 *  cases that are projects but not destinations. */
const PROJECTS = [
  { key: 'sfdl', name: 'sfdl', group: 'lifeblood_systems', roots: ['lifeblood_systems/sfdl'] },
  { key: 'sfw', name: 'sfw', group: 'operations', roots: ['operations/sfw'] },
  {
    key: 'Thinking-Space',
    name: 'Thinking-Space',
    group: 'lifeblood_systems',
    // Vault folder first, code checkout second — both are roots for activity.
    roots: ['lifeblood_systems/thinkingspace.ai', '/Volumes/Personal/Thinking-Space'],
  },
  // Rooted entirely outside the vault: real project, impossible destination.
  { key: 'MountSinaiGit', name: 'Mount Sinai', group: '', roots: ['/Users/x/Documents/MountSinaiGit'] },
  // The vault itself, with no roots at all.
  { key: 'Long-Term-Memory-iCloud', name: 'Vault', group: '', roots: [] },
]

describe('noteComposerBlock — projects as destinations', () => {
  it('keeps only projects with a vault-relative root', () => {
    expect(projectDestinationsBlock(PROJECTS).map(d => d.key)).toEqual([
      'sfdl',
      'sfw',
      'Thinking-Space',
    ])
  })

  it('prefers the vault-relative root over an absolute checkout', () => {
    expect(vaultRelativeProjectRootBlock(['/Users/x/code', 'lifeblood_systems/sfdl']))
      .toEqual(['lifeblood_systems', 'sfdl'])
  })

  it('has no root when every candidate is absolute', () => {
    expect(vaultRelativeProjectRootBlock(['/Users/x/code'])).toBeNull()
    expect(vaultRelativeProjectRootBlock([])).toBeNull()
  })

  it('resolves a sub-area deep inside a project back to that project', () => {
    const destinations = projectDestinationsBlock(PROJECTS)
    const match = projectForSegmentsBlock(destinations, ['operations', 'sfw', 'airms', 'meetings'])
    expect(match?.key).toBe('sfw')
  })

  it('resolves nothing at the vault root or outside every project', () => {
    const destinations = projectDestinationsBlock(PROJECTS)
    expect(projectForSegmentsBlock(destinations, [])).toBeNull()
    expect(projectForSegmentsBlock(destinations, ['inbox'])).toBeNull()
  })
})

describe('noteComposerBlock — note kind seeds the folder', () => {
  it('maps each kind to its built-in folder shortcut', () => {
    expect(noteKindShortcutIdBlock('thought')).toBe('thoughts')
    expect(noteKindShortcutIdBlock('meeting')).toBe('meetings')
    expect(noteKindShortcutIdBlock('todo')).toBe('todo')
  })

  it('seeds nothing for None — untagged is not unfiled', () => {
    expect(noteKindShortcutIdBlock('none')).toBeNull()
  })
})

describe('noteComposerBlock — quick destination retirement', () => {
  const destinations = projectDestinationsBlock(PROJECTS)

  it('drops the ones the project + type picker reproduces', () => {
    const quick = [
      { pathSegments: ['lifeblood_systems', 'sfdl', 'thoughts'] },
      { pathSegments: ['operations', 'sfw', 'meetings'] },
      { pathSegments: ['lifeblood_systems', 'sfdl'] },
    ]
    expect(unreachableQuickDestinationPathsBlock(quick, destinations)).toEqual([])
  })

  it('keeps a sub-area inside a project, which no project row can name', () => {
    const quick = [{ pathSegments: ['operations', 'sfw', 'airms', 'meetings'] }]
    expect(unreachableQuickDestinationPathsBlock(quick, destinations))
      .toEqual(['operations/sfw/airms/meetings'])
  })

  it('keeps a folder belonging to no project at all', () => {
    const quick = [{ pathSegments: ['archive', '2024'] }]
    expect(unreachableQuickDestinationPathsBlock(quick, destinations))
      .toEqual(['archive/2024'])
  })

  it('deduplicates and ignores empty entries', () => {
    const quick = [
      { pathSegments: ['archive', '2024'] },
      { pathSegments: ['archive/2024'] },
      { pathSegments: [] },
    ]
    expect(unreachableQuickDestinationPathsBlock(quick, destinations))
      .toEqual(['archive/2024'])
  })
})

describe('noteComposerBlock — new note file names', () => {
  it('keeps the plain name on the first attempt', () => {
    expect(numberedFilenameBlock('2026-08-19.md', 1)).toBe('2026-08-19.md')
    expect(numberedFilenameBlock('2026-08-19.md', 0)).toBe('2026-08-19.md')
  })

  it('suffixes the stem, never the extension', () => {
    expect(numberedFilenameBlock('2026-08-19.md', 2)).toBe('2026-08-19-2.md')
    expect(numberedFilenameBlock('2026-08-19.md', 11)).toBe('2026-08-19-11.md')
  })

  it('adds the extension when the caller left it off', () => {
    expect(numberedFilenameBlock('notes', 3)).toBe('notes-3.md')
  })
})
