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

  // The v1 `id` is the value canvas surfaces already stored as their binding, so
  // the upgrade has to carry it across verbatim — minting a fresh uuid here
  // would silently unbind every canvas pointing at this project.
  it('reads the legacy id as the uuid', () => {
    const project = normalizeProjectsFileBlock(V1_FILE)!.projects[0]
    expect(project.uuid).toBe('8bf4d342-df75-4df2-93ec-c35327f1016f')
  })

  it('defaults the v3 fields on an upgraded record', () => {
    const project = normalizeProjectsFileBlock(V1_FILE)!.projects[0]
    expect(project.key).toBe('')
    expect(project.description).toBe('')
    expect(project.roots).toEqual([])
    expect(project.group).toBe('')
    expect(project.aliases).toEqual([])
    expect(project.color).toBe('')
  })

  // v2's one folder becomes the first root; `organizerEnabled` had no readers
  // and a registry entry existing is the opt-in it was trying to express.
  it("promotes v2's vaultPath to a root and drops organizerEnabled", () => {
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
    expect(project.roots).toEqual(['acceleration_core/F9'])
    expect(project).not.toHaveProperty('organizerEnabled')
  })

  it('keeps explicit roots and ignores vaultPath once they exist', () => {
    const file = normalizeProjectsFileBlock({
      version: 3,
      projects: [
        {
          uuid: 'a',
          name: 'F9',
          mission: '',
          vaultPath: 'acceleration_core/F9',
          roots: ['acceleration_core/F9', '/Users/me/code/f9'],
        },
      ],
    })
    expect(file!.projects[0].roots).toEqual(['acceleration_core/F9', '/Users/me/code/f9'])
  })

  // A key is an address: hundreds of chains and organizer records are filed
  // under it, so both spellings this schema has used must survive a read.
  it('accepts both the key and the short-lived slug spelling', () => {
    const read = (project: Record<string, unknown>) =>
      normalizeProjectsFileBlock({ version: 3, projects: [project] })!.projects[0]
    expect(read({ uuid: 'a', name: 'F9', mission: '', key: 'F9' }).key).toBe('F9')
    expect(read({ uuid: 'a', name: 'F9', mission: '', slug: 'F9' }).key).toBe('F9')
  })

  // An unusable key becomes '' — "no on-disk home yet" — rather than being
  // rewritten into a *different* address that nothing is filed under.
  it('drops an unusable key instead of sanitizing it', () => {
    const file = normalizeProjectsFileBlock({
      version: 3,
      projects: [{ uuid: 'a', name: 'F9', mission: '', key: 'a/b' }],
    })
    expect(file!.projects[0].key).toBe('')
  })

  // This vault's counterexample: 17 chain digests carry
  // `projectId: Understanding Myself`. The key is the canonical project string,
  // not a directory name — the digest path sanitizes that separately — so a
  // space must stay valid or the project vanishes from the registry.
  it('keeps a key with a space, as the chain digests already have', () => {
    const file = normalizeProjectsFileBlock({
      version: 3,
      projects: [{ uuid: 'a', name: 'Understanding Myself', mission: '', key: 'Understanding Myself' }],
    })
    expect(file!.projects[0].key).toBe('Understanding Myself')
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
