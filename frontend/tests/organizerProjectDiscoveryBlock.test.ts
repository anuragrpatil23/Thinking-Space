import { beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ value: [] as string[] }))
const files = vi.hoisted(() => ({ value: {} as Record<string, string> }))
const registryFolders = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('@/services/lego_blocks/integrations/dbBlock', () => ({
  getVaultFileIndexPaths: async () => paths.value,
}))

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    read: async (path: string) => {
      const content = files.value[path]
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return content
    },
    list: async (path: string) => {
      if (path === 'ai-activity/thinking-organizer') {
        return { files: [], folders: registryFolders.value }
      }
      return { files: [], folders: [] }
    },
  }),
}))

const { discoverOrganizerProjectsBlock } = await import(
  '@/services/lego_blocks/integrations/organizerProjectDiscoveryBlock'
)

function uiState(path: string, body: Record<string, unknown>): void {
  files.value[path] = JSON.stringify(body)
}

beforeEach(() => {
  paths.value = []
  files.value = {}
  registryFolders.value = []
})

describe('discoverOrganizerProjectsBlock', () => {
  it('finds a project whose ui-state names it, keyed on its ai-activity id', async () => {
    // The index holds markdown only. A discovery that looked the JSON up in the
    // index directly found nothing, always — this is the regression guard.
    paths.value = [
      'lifeblood_systems/thinkingspace.ai/thinking-organizer/sections/section-vault.md',
      'lifeblood_systems/thinkingspace.ai/thinking-organizer/undertakings/und-a.md',
    ]
    uiState('lifeblood_systems/thinkingspace.ai/thinking-organizer/organizer-ui-state.json', {
      projectName: 'Thinking Space',
      aiProjectId: 'Thinking-Space',
    })

    expect(await discoverOrganizerProjectsBlock()).toEqual([
      {
        root: 'lifeblood_systems/thinkingspace.ai',
        name: 'Thinking Space',
        aiProjectId: 'Thinking-Space',
        hasNodeTree: true,
      },
    ])
  })

  it('falls back to the root basename when no ai id is stored', async () => {
    paths.value = ['acceleration_core/F9/thinking-organizer/programs/p.md']
    uiState('acceleration_core/F9/thinking-organizer/organizer-ui-state.json', {
      projectName: 'F9',
    })

    const found = await discoverOrganizerProjectsBlock()
    expect(found).toHaveLength(1)
    expect(found[0].aiProjectId).toBe('F9')
  })

  it('ignores organizer folders whose ui-state has no project name', async () => {
    paths.value = ['scratch/thinking-organizer/notes/n.md']
    uiState('scratch/thinking-organizer/organizer-ui-state.json', { presetTags: [] })

    expect(await discoverOrganizerProjectsBlock()).toEqual([])
  })

  it('ignores an organizer folder with no ui-state at all', async () => {
    paths.value = ['scratch/thinking-organizer/notes/n.md']

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
    uiState('lifeblood_systems/thinkingspace.ai/thinking-organizer/organizer-ui-state.json', {
      projectName: 'Thinking Space',
      aiProjectId: 'Thinking-Space',
    })
    registryFolders.value = ['Thinking-Space']

    const found = await discoverOrganizerProjectsBlock()
    expect(found).toHaveLength(1)
    // The node-tree root wins: it is where the ui-state lives.
    expect(found[0].root).toBe('lifeblood_systems/thinkingspace.ai')
    expect(found[0].hasNodeTree).toBe(true)
  })

  it('never treats the registry itself as a project root', async () => {
    paths.value = ['ai-activity/thinking-organizer/Thinking-Space/undertakings/und-a.md']

    expect(await discoverOrganizerProjectsBlock()).toEqual([])
  })
})
