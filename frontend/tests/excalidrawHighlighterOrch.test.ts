import { describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '../src/services/lego_blocks/integrations/fsBlock'
import {
  EXCALIDRAW_HIGHLIGHTER_PRESETS_ORCH,
  loadExcalidrawHighlighterPresetsOrch,
} from '../src/services/orchestrators/excalidrawHighlighterOrch'

function createFsMock(readImpl: (path: string) => Promise<string>): VaultFS {
  return {
    read: readImpl,
    write: async () => {},
    create: async () => {},
    list: async (): Promise<ListedFiles> => ({ files: [], folders: [] }),
    walkVault: async (): Promise<VaultEntry[]> => [],
    stat: async (): Promise<VaultStat> => ({ size: 0, mtime: 0, ctime: 0, isDirectory: false }),
    exists: async () => false,
    mkdir: async () => {},
    process: async () => {},
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => {},
    delete: async () => {},
  }
}

describe('excalidrawHighlighterOrch', () => {
  it('loads highlighter presets from Obsidian plugin customPens', async () => {
    const fs = createFsMock(async () => JSON.stringify({
      customPens: [
        {
          type: 'default',
          strokeColor: '#000000',
          backgroundColor: 'transparent',
          strokeWidth: 1,
          penOptions: {
            highlighter: false,
          },
        },
        {
          type: 'highlighter',
          strokeColor: '#fff',
          backgroundColor: '#fff9db',
          strokeWidth: 2.6,
          penOptions: {
            highlighter: true,
            constantPressure: true,
            hasOutline: true,
            outlineWidth: 4,
          },
        },
      ],
    }))

    const presets = await loadExcalidrawHighlighterPresetsOrch({ fs })
    expect(presets).toHaveLength(2)
    expect(presets[0]?.label).toBe('Default')
    expect(presets[0]?.strokeOptions.highlighter).toBe(false)
    expect(presets[1]?.label).toBe('Highlighter')
    expect(presets[1]?.strokeColor).toBe('#fff9db')
  })

  it('falls back to built-in presets when plugin settings are unavailable', async () => {
    const fs = createFsMock(async () => {
      throw new Error('ENOENT')
    })

    const presets = await loadExcalidrawHighlighterPresetsOrch({ fs })
    expect(presets).toEqual(EXCALIDRAW_HIGHLIGHTER_PRESETS_ORCH)
  })
})
