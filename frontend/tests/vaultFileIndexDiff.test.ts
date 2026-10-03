// replaceVaultFileIndex runs after every vault sync, and sync runs on every
// focus and watcher event. It must write only what changed: the old
// clear + bulkAdd of every record put ~50 MB through LevelDB per call on a
// 13.5k-file vault, changed or not (137 GB overnight, 2026-10-03).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(async () => {
  const fakeIdb = await import('fake-indexeddb')
  globalThis.indexedDB = fakeIdb.default
  globalThis.IDBKeyRange = fakeIdb.IDBKeyRange as any
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { deleteDb } = await import('@/services/lego_blocks/integrations/dbBlock')
  await deleteDb()
})

async function load() {
  const dbBlock = await import('@/services/lego_blocks/integrations/dbBlock')
  // Count writes where they land: on the IndexedDB object store itself.
  const { IDBObjectStore } = await import('fake-indexeddb')
  const store = IDBObjectStore.prototype as any
  const spyWrites = () => ({
    put: vi.spyOn(store, 'put'),
    add: vi.spyOn(store, 'add'),
    del: vi.spyOn(store, 'delete'),
    clear: vi.spyOn(store, 'clear'),
  })
  return { dbBlock, spyWrites }
}

const a = { path: 'a.md', mtime: 100, size: 10 }
const b = { path: 'b.md', mtime: 200, size: 20 }
const c = { path: 'c.md', mtime: 300, size: 30 }

describe('replaceVaultFileIndex', () => {
  it('writes nothing when the walk matches the index', async () => {
    const { dbBlock, spyWrites } = await load()
    await dbBlock.replaceVaultFileIndex([a, b, c])

    const w = spyWrites()
    await dbBlock.replaceVaultFileIndex([{ ...a }, { ...b }, { ...c }])

    expect(w.put).not.toHaveBeenCalled()
    expect(w.add).not.toHaveBeenCalled()
    expect(w.del).not.toHaveBeenCalled()
    expect(w.clear).not.toHaveBeenCalled()
    expect(await dbBlock.getVaultFileIndexRecords()).toHaveLength(3)
  })

  it('writes only the added, changed and removed records', async () => {
    const { dbBlock, spyWrites } = await load()
    await dbBlock.replaceVaultFileIndex([a, b, c])

    const w = spyWrites()
    const bChanged = { ...b, mtime: 250 }
    const d = { path: 'd.md', mtime: 400, size: 40 }
    await dbBlock.replaceVaultFileIndex([a, bChanged, d])

    // b (changed) and d (new) are written; a is left alone; c is removed.
    expect(w.put.mock.calls.length + w.add.mock.calls.length).toBe(2)
    expect(w.del).toHaveBeenCalledTimes(1)
    expect(w.clear).not.toHaveBeenCalled()

    const after = await dbBlock.getVaultFileIndexRecords()
    expect(after.sort((x, y) => x.path.localeCompare(y.path))).toEqual([a, bChanged, d])
  })

  it('treats a size-only change as a change', async () => {
    const { dbBlock } = await load()
    await dbBlock.replaceVaultFileIndex([a])
    await dbBlock.replaceVaultFileIndex([{ ...a, size: 11 }])
    expect(await dbBlock.getVaultFileIndexRecords()).toEqual([{ ...a, size: 11 }])
  })

  it('empties the index for an empty walk', async () => {
    const { dbBlock } = await load()
    await dbBlock.replaceVaultFileIndex([a, b])
    await dbBlock.replaceVaultFileIndex([])
    expect(await dbBlock.getVaultFileIndexRecords()).toEqual([])
  })
})
