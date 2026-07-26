import { describe, expect, it } from 'vitest'
import {
  PROJECTS_SCHEMA_VERSION_BLOCK,
  normalizeProjectsFileBlock,
  normalizeVaultPathBlock,
} from '@/services/lego_blocks/units/projectBlock'

// The real v1 file shipped in the vault before the registry work.
const V1_FILE = {
  version: 1,
  projects: [
    {
      id: '8bf4d342-df75-4df2-93ec-c35327f1016f',
      name: 'F9',
      mission: 'Be early on development in technology and overall technological development.',
    },
  ],
}

describe('projectBlock schema migration', () => {
  // A dropped project here is a destroyed one: readProjectsBlock would return
  // [] and the next mutation persists that over the user's real list.
  it('carries v1 projects forward instead of rejecting the file', () => {
    const file = normalizeProjectsFileBlock(V1_FILE)
    expect(file).not.toBeNull()
    expect(file!.projects).toHaveLength(1)
    expect(file!.projects[0].name).toBe('F9')
    expect(file!.version).toBe(PROJECTS_SCHEMA_VERSION_BLOCK)
  })

  it('defaults the v2 fields on an upgraded record', () => {
    const project = normalizeProjectsFileBlock(V1_FILE)!.projects[0]
    expect(project.vaultPath).toBe('')
    expect(project.organizerEnabled).toBe(false)
  })

  it('preserves v2 fields on a round trip', () => {
    const file = normalizeProjectsFileBlock({
      version: 2,
      projects: [
        {
          id: 'a',
          name: 'F9',
          mission: '',
          vaultPath: 'acceleration_core/F9',
          organizerEnabled: true,
        },
      ],
    })
    const project = file!.projects[0]
    expect(project.vaultPath).toBe('acceleration_core/F9')
    expect(project.organizerEnabled).toBe(true)
  })

  // Another device on a newer app version can write a higher schema through
  // iCloud. Returning null makes the storage layer refuse to write rather than
  // overwrite it with a downgraded list.
  it('rejects a file from a future schema version', () => {
    const file = normalizeProjectsFileBlock({
      version: PROJECTS_SCHEMA_VERSION_BLOCK + 1,
      projects: [{ id: 'a', name: 'F9', mission: '' }],
    })
    expect(file).toBeNull()
  })

  it('rejects a file with no version rather than guessing', () => {
    expect(normalizeProjectsFileBlock({ projects: [] })).toBeNull()
  })

})

describe('normalizeVaultPathBlock', () => {
  it('strips slashes and normalizes separators', () => {
    expect(normalizeVaultPathBlock('/acceleration_core/F9/')).toBe('acceleration_core/F9')
    expect(normalizeVaultPathBlock('acceleration_core\\F9')).toBe('acceleration_core/F9')
  })

  it('returns empty for missing or non-string input', () => {
    expect(normalizeVaultPathBlock(undefined)).toBe('')
    expect(normalizeVaultPathBlock(null)).toBe('')
    expect(normalizeVaultPathBlock('   ')).toBe('')
  })
})
