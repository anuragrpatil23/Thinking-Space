import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const data = files.get(path)
      if (data === undefined) throw new Error('missing')
      return data
    },
    write: async (path: string, data: string) => {
      files.set(path, data)
    },
    mkdir: async () => undefined,
  }),
}))

import {
  PROJECTS_FILE_PATH_BLOCK,
  PROJECTS_MIRROR_PATH_BLOCK,
  reconcileProjectsFromDiskBlock,
} from '@/services/lego_blocks/integrations/projectsStorageBlock'

function registry(name: string): string {
  return JSON.stringify({
    version: 3,
    projects: [{ uuid: 'u-1', key: 'alpha', name, mission: '', roots: [] }],
  })
}

describe('reconcileProjectsFromDiskBlock', () => {
  beforeEach(() => files.clear())

  it('regenerates the mirror from a JSON edited outside the app', async () => {
    files.set(PROJECTS_FILE_PATH_BLOCK, registry('Old name'))
    await reconcileProjectsFromDiskBlock()
    expect(files.get(PROJECTS_MIRROR_PATH_BLOCK)).toContain('Old name')

    files.set(PROJECTS_FILE_PATH_BLOCK, registry('Renamed by hand'))
    await reconcileProjectsFromDiskBlock()
    const mirror = files.get(PROJECTS_MIRROR_PATH_BLOCK) ?? ''
    expect(mirror).toContain('Renamed by hand')
    expect(mirror).not.toContain('Old name')
  })

  it('leaves the mirror alone when the JSON cannot be parsed', async () => {
    files.set(PROJECTS_MIRROR_PATH_BLOCK, 'previous mirror')
    files.set(PROJECTS_FILE_PATH_BLOCK, '{ not json')
    await reconcileProjectsFromDiskBlock()
    expect(files.get(PROJECTS_MIRROR_PATH_BLOCK)).toBe('previous mirror')
  })

  it('never rewrites the JSON itself', async () => {
    const raw = registry('Untouched')
    files.set(PROJECTS_FILE_PATH_BLOCK, raw)
    await reconcileProjectsFromDiskBlock()
    expect(files.get(PROJECTS_FILE_PATH_BLOCK)).toBe(raw)
  })
})
