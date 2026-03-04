import { describe, expect, it } from 'vitest'
import {
  sanitizeWorkspaceRouteForSpaceBlock,
  sanitizeWorkspaceTabsForSpaceBlock,
  type SpaceRouteSafetyDepsBlock,
  type VaultPathKindForSpaceRouteBlock,
} from '@/services/lego_blocks/units/spaceRouteSafetyBlock'

function createDeps(
  map: Record<string, VaultPathKindForSpaceRouteBlock>,
): SpaceRouteSafetyDepsBlock {
  return {
    getVaultPathKind: async (path: string) => map[path] ?? 'missing',
  }
}

describe('spaceRouteSafetyBlock', () => {
  it('drops stale thinking-space file routes when file is missing', async () => {
    const route = await sanitizeWorkspaceRouteForSpaceBlock(
      '/thinking-space?file=notes%2Fmissing.md',
      createDeps({}),
    )

    expect(route).toBe('/thinking-space')
  })

  it('preserves thinking-space file route when target file exists', async () => {
    const route = await sanitizeWorkspaceRouteForSpaceBlock(
      '/thinking-space?file=notes%2Factive.md',
      createDeps({ 'notes/active.md': 'file' }),
    )

    expect(route).toBe('/thinking-space?file=notes%2Factive.md')
  })

  it('drops stale organizer projectRoot and selectedNode when folder is missing', async () => {
    const route = await sanitizeWorkspaceRouteForSpaceBlock(
      '/thinking-organizer?tab=backlog&projectRoot=projects%2Falpha&selectedNode=node-123',
      createDeps({}),
    )

    expect(route).toBe('/thinking-organizer?tab=backlog')
  })

  it('preserves organizer route when projectRoot folder exists', async () => {
    const route = await sanitizeWorkspaceRouteForSpaceBlock(
      '/thinking-organizer?tab=backlog&projectRoot=projects%2Falpha',
      createDeps({ 'projects/alpha': 'folder' }),
    )

    expect(route).toBe('/thinking-organizer?tab=backlog&projectRoot=projects%2Falpha')
  })

  it('sanitizes workspace tab routes in bulk', async () => {
    const tabs = [
      { id: '1', route: '/thinking-space?file=notes%2Fmissing.md' },
      { id: '2', route: '/thinking-space?file=notes%2Factive.md' },
      { id: '3', route: '/thinking-organizer?projectRoot=projects%2Falpha&selectedNode=node-123' },
    ]

    const sanitized = await sanitizeWorkspaceTabsForSpaceBlock(
      tabs,
      createDeps({
        'notes/active.md': 'file',
      }),
    )

    expect(sanitized).toEqual([
      { id: '1', route: '/thinking-space' },
      { id: '2', route: '/thinking-space?file=notes%2Factive.md' },
      { id: '3', route: '/thinking-organizer' },
    ])
  })
})
