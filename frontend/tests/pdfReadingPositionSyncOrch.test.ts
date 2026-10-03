import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    exists: async (path: string) =>
      [...files.keys()].some((name) => name === path || name.startsWith(`${path}/`)),
    list: async (dir: string) => ({
      files: [...files.keys()]
        .filter((name) => name.startsWith(`${dir}/`))
        .map((name) => name.slice(dir.length + 1)),
      folders: [],
    }),
    read: async (path: string) => {
      const data = files.get(path)
      if (data === undefined) throw new Error('missing')
      return data
    },
  }),
}))

import { readRoamedPdfReadingPositionOrch } from '@/services/orchestrators/pdfReadingPositionSyncOrch'

const DIR = '.thinking-space/reading-positions'

describe('pdfReadingPositionSyncOrch', () => {
  beforeEach(() => files.clear())

  it('returns nothing when no device has published positions', async () => {
    expect(await readRoamedPdfReadingPositionOrch('books/a.pdf')).toBeNull()
  })

  it('takes the most recently read position across every device file', async () => {
    files.set(`${DIR}/aaaaaa.json`, JSON.stringify({
      'books/a.pdf': { page: 30, offset: 0.7, at: 1000 },
      'books/b.pdf': { page: 4, offset: 0, at: 5000 },
    }))
    files.set(`${DIR}/bbbbbb.json`, JSON.stringify({
      'books/a.pdf': { page: 50, offset: 0.2, at: 2000 },
    }))

    expect(await readRoamedPdfReadingPositionOrch('books/a.pdf'))
      .toEqual({ page: 50, offset: 0.2, at: 2000 })
    expect(await readRoamedPdfReadingPositionOrch('books/b.pdf'))
      .toEqual({ page: 4, offset: 0, at: 5000 })
    expect(await readRoamedPdfReadingPositionOrch('books/unread.pdf')).toBeNull()
  })

  it('survives a corrupt or foreign file beside the good ones', async () => {
    files.set(`${DIR}/aaaaaa.json`, '{ not json')
    files.set(`${DIR}/notes.txt`, 'hello')
    files.set(`${DIR}/cccccc.json`, JSON.stringify({
      'books/a.pdf': { page: 9, offset: 0.5, at: 300 },
    }))

    expect(await readRoamedPdfReadingPositionOrch('books/a.pdf'))
      .toEqual({ page: 9, offset: 0.5, at: 300 })
  })
})
