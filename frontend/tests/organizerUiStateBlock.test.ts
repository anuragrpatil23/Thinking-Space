import { describe, expect, it } from 'vitest'
import {
  organizerUiStatePathBlock,
  readOrganizerUiStateBlock,
  writeOrganizerUiStateBlock,
} from '@/services/lego_blocks/integrations/organizerUiStateBlock'
import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'

interface MockVaultFsState {
  files: Map<string, string>
  mkdirs: string[]
}

function makeMockVaultFs(initialFiles?: Record<string, string>): {
  fs: VaultFS
  state: MockVaultFsState
} {
  const files = new Map<string, string>(Object.entries(initialFiles ?? {}))
  const mkdirs: string[] = []
  const fs = {
    read: async (path: string) => {
      const value = files.get(path)
      if (value == null) throw new Error(`Missing file: ${path}`)
      return value
    },
    write: async (path: string, data: string) => {
      files.set(path, data)
    },
    create: async (path: string, data: string) => {
      files.set(path, data)
    },
    list: async () => ({ files: [], folders: [] }),
    walkVault: async () => [],
    stat: async () => ({ size: 0, mtime: 0, ctime: 0 }),
    exists: async (path: string) => files.has(path),
    mkdir: async (path: string) => {
      mkdirs.push(path)
    },
    process: async () => {},
  } as unknown as VaultFS

  return { fs, state: { files, mkdirs } }
}

describe('organizerUiStateBlock', () => {
  it('resolves project UI state path inside project thinking-organizer folder', () => {
    expect(organizerUiStatePathBlock('projects/demo')).toBe(
      'projects/demo/thinking-organizer/organizer-ui-state.json',
    )
  })

  it('writes and reads normalized project UI settings', async () => {
    const { fs, state } = makeMockVaultFs()
    const projectRoot = 'projects/demo'

    const written = await writeOrganizerUiStateBlock(projectRoot, {
      schemaVersion: 999,
      updatedAt: '1999-01-01T00:00:00.000Z',
      projectName: '  Demo Project  ',
      presetTags: ['alpha', 'Alpha', 'beta'],
      tagColors: {
        Alpha: '#123456',
        BETA: 'invalid',
        gamma: '#abcdef',
      },
      programGroups: [
        { id: 'grp-1', name: '  Group 1  ', programIds: ['p-1', 'p-1', 'p-2'] },
        { id: 'grp-1', name: 'Duplicate', programIds: ['p-3'] },
      ],
    }, fs)

    expect(state.mkdirs).toContain('projects/demo/thinking-organizer')
    // Writes always stamp the current schema version, ignoring the caller's value.
    expect(written.schemaVersion).toBe(3)
    expect(written.projectName).toBe('Demo Project')
    expect(written.presetTags).toEqual(['alpha', 'beta'])
    expect(written.tagColors).toEqual({
      alpha: '#123456',
      gamma: '#abcdef',
    })
    expect(written.programGroups).toEqual([
      { id: 'grp-1', name: 'Group 1', programIds: ['p-1', 'p-2'], collapsed: false },
    ])

    const readBack = await readOrganizerUiStateBlock(projectRoot, fs)
    expect(readBack).toEqual(written)
  })

  it('returns null when state file is missing or invalid', async () => {
    const empty = makeMockVaultFs().fs
    await expect(readOrganizerUiStateBlock('projects/demo', empty)).resolves.toBeNull()

    const invalid = makeMockVaultFs({
      'projects/demo/thinking-organizer/organizer-ui-state.json': '{bad json}',
    }).fs
    await expect(readOrganizerUiStateBlock('projects/demo', invalid)).resolves.toBeNull()
  })

  it('carries taskDir through, so a project can name its own records directory', async () => {
    // Not sniffable: Thinking Space has both `tasks/` (live) and `epics/`
    // (stale DEV-era), so a probe that takes whichever exists reads the wrong
    // corpus and the pane looks populated with the wrong 34 rows.
    const { fs } = makeMockVaultFs({
      'projects/demo/thinking-organizer/organizer-ui-state.json': JSON.stringify({
        schemaVersion: 3,
        taskDir: '  tasks  ',
      }),
    })
    const state = await readOrganizerUiStateBlock('projects/demo', fs)
    expect(state?.taskDir).toBe('tasks')
  })

  it('leaves taskDir undefined when the project never set one', async () => {
    const { fs } = makeMockVaultFs({
      'projects/demo/thinking-organizer/organizer-ui-state.json': JSON.stringify({ schemaVersion: 3 }),
    })
    const state = await readOrganizerUiStateBlock('projects/demo', fs)
    expect(state?.taskDir).toBeUndefined()
  })
})
