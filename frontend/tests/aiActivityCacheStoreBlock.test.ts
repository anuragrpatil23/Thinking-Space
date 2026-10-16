import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/lego_blocks/integrations/aiActivitySnapshotStoreBlock', () => ({
  readPersistedDiskCacheMirrorBlock: async () => null,
  writePersistedDiskCacheMirrorBlock: async () => undefined,
}))

import {
  readAiActivityCacheStoreBlock,
  resetAiActivityCacheStoreBlock,
  writeAiActivityCacheStoreBlock,
} from '@/services/lego_blocks/integrations/aiActivityCacheStoreBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'

const files = new Map<string, { text: string; mtime: number }>()
const dirs = new Set<string>()
const writes: string[] = []
let clock = 1

const fs = {
  read: async (p: string) => {
    const f = files.get(p)
    if (!f) throw new Error(`missing ${p}`)
    return f.text
  },
  write: async (p: string, text: string) => { files.set(p, { text, mtime: clock++ }); writes.push(p) },
  exists: async (p: string) => dirs.has(p) || files.has(p),
  mkdir: async (p: string) => { dirs.add(p) },
  delete: async (p: string) => { files.delete(p) },
  stat: async (p: string) => {
    const f = files.get(p)
    if (!f) throw new Error('missing')
    return { mtime: f.mtime, size: f.text.length, isDirectory: false }
  },
  list: async (dir: string) => ({
    folders: [],
    files: [...files.keys()].filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1)),
  }),
} as unknown as VaultFS

const s = (path: string, startedIso: string, extra: Partial<ParsedSession> = {}) =>
  ({ path, startedIso, endedIso: startedIso, topic: path, source: 'claude', mtime: 1, ...extra }) as unknown as ParsedSession

function cacheOf(list: ParsedSession[], updatedAt = 100) {
  return { version: 22, updatedAt, sessions: Object.fromEntries(list.map(x => [x.path, x])) }
}

describe('aiActivityCacheStoreBlock', () => {
  beforeEach(() => {
    files.clear(); dirs.clear(); writes.length = 0; clock = 1
    resetAiActivityCacheStoreBlock()
  })

  it('writes one file per month and reads the whole cache back', async () => {
    const all = [s('a', '2026-09-03T10:00:00Z'), s('b', '2026-10-01T10:00:00Z'), s('c', '2026-10-15T10:00:00Z')]
    await writeAiActivityCacheStoreBlock(fs, cacheOf(all), '/vault')
    expect([...files.keys()].sort()).toEqual([
      '.thinking-space/ai-activity-cache/v22.2026-09.json',
      '.thinking-space/ai-activity-cache/v22.2026-10.json',
    ])
    resetAiActivityCacheStoreBlock()
    const back = await readAiActivityCacheStoreBlock(fs, 22, '/vault', true)
    expect(Object.keys(back!.sessions).sort()).toEqual(['a', 'b', 'c'])
  })

  it('rewrites only the month that changed — not on a new timestamp or key order', async () => {
    await writeAiActivityCacheStoreBlock(fs, cacheOf([s('a', '2026-09-03'), s('b', '2026-10-01')]), '/vault')
    writes.length = 0
    // Same content, new updatedAt, different insertion order: nothing to write.
    await writeAiActivityCacheStoreBlock(fs, cacheOf([s('b', '2026-10-01'), s('a', '2026-09-03')], 200), '/vault')
    expect(writes).toEqual([])
    // A session in October changes: only October is rewritten.
    await writeAiActivityCacheStoreBlock(fs, cacheOf([s('a', '2026-09-03'), s('b', '2026-10-01', { topic: 'new' })], 300), '/vault')
    expect(writes).toEqual(['.thinking-space/ai-activity-cache/v22.2026-10.json'])
  })

  it('migrates from the legacy single file and leaves it in place', async () => {
    files.set('.thinking-space/ai-activity-cache.json', { text: JSON.stringify(cacheOf([s('old', '2025-01-02')])), mtime: 1 })
    const legacy = await readAiActivityCacheStoreBlock(fs, 22, '/vault', true)
    expect(Object.keys(legacy!.sessions)).toEqual(['old'])
    await writeAiActivityCacheStoreBlock(fs, legacy!, '/vault')
    expect(files.has('.thinking-space/ai-activity-cache/v22.2025-01.json')).toBe(true)
    expect(files.has('.thinking-space/ai-activity-cache.json')).toBe(true)
  })

  it('drops emptied months and other versions, and treats an unreadable month as no cache', async () => {
    files.set('.thinking-space/ai-activity-cache/v21.2026-01.json', { text: '{}', mtime: 1 })
    await writeAiActivityCacheStoreBlock(fs, cacheOf([s('a', '2026-09-03'), s('b', '2026-10-01')]), '/vault')
    await writeAiActivityCacheStoreBlock(fs, cacheOf([s('a', '2026-09-03')]), '/vault')
    expect([...files.keys()]).toEqual(['.thinking-space/ai-activity-cache/v22.2026-09.json'])

    files.set('.thinking-space/ai-activity-cache/v22.2026-09.json', { text: 'not json', mtime: 99 })
    resetAiActivityCacheStoreBlock()
    expect(await readAiActivityCacheStoreBlock(fs, 22, '/vault', true)).toBeNull()
  })
})
