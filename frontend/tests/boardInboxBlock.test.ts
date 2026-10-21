import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    mkdir: async () => {},
    write: async (path: string, data: string) => { files.set(path, data) },
    read: async (path: string) => {
      const data = files.get(path)
      if (data === undefined) throw new Error(`missing ${path}`)
      return data
    },
    exists: async (path: string) => [...files.keys()].some(key => key === path || key.startsWith(`${path}/`)),
    list: async (dir: string) => ({
      files: [...files.keys()].filter(key => key.startsWith(`${dir}/`)).map(key => key.slice(dir.length + 1)),
      folders: [],
    }),
    delete: async (path: string) => {
      if (!files.delete(path)) throw new Error(`missing ${path}`)
    },
  }),
}))

const {
  addBoardInboxNoteBlock,
  readBoardInboxBlock,
  removeBoardInboxNotesBlock,
  BOARD_INBOX_DIR_BLOCK,
} = await import('@/services/lego_blocks/integrations/boardInboxBlock')

describe('boardInboxBlock', () => {
  beforeEach(() => files.clear())

  it('keeps each note in its own file and reads them oldest first', async () => {
    const first = await addBoardInboxNoteBlock('first thought')
    const second = await addBoardInboxNoteBlock('second thought')
    expect(first.id).not.toBe(second.id)
    expect(files.size).toBe(2)
    const notes = await readBoardInboxBlock()
    expect(notes.map(n => n.text)).toEqual(['first thought', 'second thought'])
  })

  it('skips a file that will not parse instead of deleting it (an iCloud download in flight)', async () => {
    await addBoardInboxNoteBlock('ok')
    files.set(`${BOARD_INBOX_DIR_BLOCK}/half.json`, '{"id":')
    expect((await readBoardInboxBlock()).map(n => n.text)).toEqual(['ok'])
    expect(files.has(`${BOARD_INBOX_DIR_BLOCK}/half.json`)).toBe(true)
  })

  it('removes only the notes it is given, and tolerates one already gone', async () => {
    const keep = await addBoardInboxNoteBlock('keep')
    const done = await addBoardInboxNoteBlock('done')
    await removeBoardInboxNotesBlock([done.id, 'tile-already-gone'])
    expect((await readBoardInboxBlock()).map(n => n.id)).toEqual([keep.id])
  })

  it('reads nothing when no note was ever jotted', async () => {
    expect(await readBoardInboxBlock()).toEqual([])
  })
})
