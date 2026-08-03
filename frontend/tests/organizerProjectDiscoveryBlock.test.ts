import { beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ value: [] as string[] }))
const registryFolders = vi.hoisted(() => ({ value: [] as string[] }))
const registry = vi.hoisted(() => ({ value: [] as Array<{ project: string; paths: string[] }> }))
const names = vi.hoisted(() => ({ value: {} as Record<string, string> }))

vi.mock('@/services/lego_blocks/integrations/dbBlock', () => ({
  getVaultFileIndexPaths: async () => paths.value,
}))

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    list: async (path: string) => {
      if (path === 'ai-activity/thinking-organizer') {
        return { files: [], folders: registryFolders.value }
      }
      return { files: [], folders: [] }
    },
  }),
}))

vi.mock('@/services/lego_blocks/integrations/projectRegistryLoaderBlock', () => ({
  loadProjectRegistryBlock: async () => {},
}))

// Only the caches are stubbed. `relativizeRegistryEntriesBlock` is pure and
// shared with the organizer index, so the real one is what this should exercise.
vi.mock('@/services/lego_blocks/units/projectRegistryBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/projectRegistryBlock')>()),
  readCachedProjectRegistryBlock: () => registry.value,
  readCachedProjectNamesBlock: () => names.value,
}))

vi.mock('@/services/lego_blocks/units/storageKeyBlock', () => ({
  getStoredVaultRoot: () => '',
}))

const { discoverOrganizerProjectsBlock } = await import(
  '@/services/lego_blocks/integrations/organizerProjectDiscoveryBlock'
)

beforeEach(() => {
  paths.value = []
  registryFolders.value = []
  registry.value = []
  names.value = {}
})

describe('discoverOrganizerProjectsBlock', () => {
  it('finds a registered project with a node tree, keyed on its ai-activity id', async () => {
    // The key and the folder name are allowed to differ, and here they do:
    // `lifeblood_systems/thinkingspace.ai` files its chains under
    // `Thinking-Space`. Identity comes from the registry, not from the folder.
    paths.value = [
      'lifeblood_systems/thinkingspace.ai/thinking-organizer/sections/section-vault.md',
      'lifeblood_systems/thinkingspace.ai/thinking-organizer/undertakings/und-a.md',
    ]
    registry.value = [{ project: 'Thinking-Space', paths: ['lifeblood_systems/thinkingspace.ai'] }]
    names.value = { 'Thinking-Space': 'Thinking Space' }

    expect(await discoverOrganizerProjectsBlock()).toEqual([
      {
        root: 'lifeblood_systems/thinkingspace.ai',
        name: 'Thinking Space',
        aiProjectId: 'Thinking-Space',
        hasNodeTree: true,
      },
    ])
  })

  it('falls back to the key as the display name when the project sets none', async () => {
    paths.value = ['acceleration_core/F9/thinking-organizer/programs/p.md']
    registry.value = [{ project: 'F9', paths: ['acceleration_core/F9'] }]

    const found = await discoverOrganizerProjectsBlock()
    expect(found).toHaveLength(1)
    expect(found[0].aiProjectId).toBe('F9')
    expect(found[0].name).toBe('F9')
  })

  it('ignores an organizer folder that belongs to no registered project', async () => {
    // Registration is the membership test. An unregistered folder with organizer
    // markdown is a stray, and listing it would put a project in the switcher
    // that nothing else in the app agrees exists.
    paths.value = ['scratch/thinking-organizer/notes/n.md']

    expect(await discoverOrganizerProjectsBlock()).toEqual([])
  })

  it('does not list a registered project that has no organizer evidence at all', async () => {
    // Most registered projects never grow a node tree. Listing every one of them
    // would bury the few that have.
    registry.value = [{ project: 'sfbooks', paths: ['lifeblood_systems/sfbooks'] }]

    expect(await discoverOrganizerProjectsBlock()).toEqual([])
  })

  it('surfaces a registry directory as a project with no node tree yet', async () => {
    registryFolders.value = ['Some-New-Project']

    expect(await discoverOrganizerProjectsBlock()).toEqual([
      {
        root: 'ai-activity/thinking-organizer/Some-New-Project',
        name: 'Some New Project',
        aiProjectId: 'Some-New-Project',
        hasNodeTree: false,
      },
    ])
  })

  it('does not list a project twice when it has both a node tree and a registry entry', async () => {
    paths.value = ['lifeblood_systems/thinkingspace.ai/thinking-organizer/sections/s.md']
    registry.value = [{ project: 'Thinking-Space', paths: ['lifeblood_systems/thinkingspace.ai'] }]
    names.value = { 'Thinking-Space': 'Thinking Space' }
    registryFolders.value = ['Thinking-Space']

    const found = await discoverOrganizerProjectsBlock()
    expect(found).toHaveLength(1)
    // The node-tree root wins: it is the richer record.
    expect(found[0].root).toBe('lifeblood_systems/thinkingspace.ai')
    expect(found[0].hasNodeTree).toBe(true)
  })

  it('never treats the registry itself as a project root', async () => {
    paths.value = ['ai-activity/thinking-organizer/Thinking-Space/undertakings/und-a.md']

    expect(await discoverOrganizerProjectsBlock()).toEqual([])
  })
})
