import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodePostingsBlock,
  encodePostingsBlock,
  fullTextShardKeyBlock,
  tokenizeFullTextBlock,
} from '@/services/lego_blocks/units/fullTextTokenizeBlock'

const mem = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  records: [] as { path: string; mtime: number; size: number }[],
}))

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  isElectron: () => true,
  getVaultFS: () => ({
    read: async (p: string) => {
      const v = mem.files.get(p)
      if (v === undefined) throw new Error(`missing ${p}`)
      return v
    },
    write: async (p: string, d: string) => { mem.files.set(p, d) },
    exists: async (p: string) => mem.dirs.has(p) || mem.files.has(p),
    mkdir: async (p: string) => { mem.dirs.add(p) },
    delete: async (p: string) => { mem.files.delete(p) },
    list: async (dir: string) => ({
      folders: [],
      files: [...mem.files.keys()]
        .filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map(p => p.slice(dir.length + 1)),
    }),
  }),
}))
vi.mock('@/services/lego_blocks/integrations/dbBlock', () => ({
  getVaultFileIndexRecords: async () => mem.records,
}))

import { lookupFullTextOrch, resetFullTextReaderOrch, startFullTextIndexerOrch } from '@/services/orchestrators/fullTextIndexOrch'
import { notifyVaultIndexChangedBlock } from '@/services/lego_blocks/units/vaultIndexChangedBlock'

function note(path: string, text: string, mtime = 1) {
  mem.files.set(path, text)
  const i = mem.records.findIndex(r => r.path === path)
  const rec = { path, mtime, size: text.length }
  if (i >= 0) mem.records[i] = rec
  else mem.records.push(rec)
}

async function runIndexer(first: boolean) {
  vi.useFakeTimers()
  const stop = startFullTextIndexerOrch()
  if (!first) notifyVaultIndexChangedBlock()
  await vi.advanceTimersByTimeAsync(first ? 60_000 : 15_000)
  await vi.runAllTimersAsync()
  stop()
  vi.useRealTimers()
  resetFullTextReaderOrch()
}

const found = async (token: string) => [...(await lookupFullTextOrch([token])).get(token) ?? []].sort()

describe('full-text vocabulary', () => {
  it('splits words, drops stopwords, short words and long digit runs', () => {
    expect(tokenizeFullTextBlock('The Idea-Factory, 2024 and 1700000000 x Bell Labs!'))
      .toEqual(['idea', 'factory', '2024', 'bell', 'labs'])
  })
  it('round-trips postings and shards by first character', () => {
    expect(decodePostingsBlock(encodePostingsBlock([0, 3, 40, 41]))).toEqual([0, 3, 40, 41])
    expect(fullTextShardKeyBlock('factory')).toBe('f')
    expect(fullTextShardKeyBlock('über')).toBe('_')
  })
})

describe('full-text index writer + reader', () => {
  beforeEach(() => {
    mem.files.clear(); mem.dirs.clear(); mem.records.length = 0
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      clear: () => store.clear(),
    })
    resetFullTextReaderOrch()
  })

  it('builds a base, finds whole words and prefixes, skips app data', async () => {
    note('reading/bell.md', 'Notes about the Bell Labs transistor and invention')
    note('notes/other.md', 'Nothing relevant here at all')
    note('ai-activity/sessions/x.md', 'transistor transistor')
    await runIndexer(true)

    expect(await found('transistor')).toEqual(['reading/bell.md'])
    expect(await found('transis')).toEqual(['reading/bell.md'])
    expect(await found('bell-labs')).toEqual(['reading/bell.md'])
    expect(await found('zzz')).toEqual([])
  })

  it('re-indexes an edited note through a small delta, without touching shards', async () => {
    note('reading/bell.md', 'Bell Labs transistor')
    await runIndexer(true)
    const shardsBefore = [...mem.files.keys()].filter(p => p.includes('/shards/')).sort()

    note('reading/bell.md', 'Shannon information theory', 2)
    note('new/idea.md', 'information wants to be free', 2)
    await runIndexer(false)

    expect([...mem.files.keys()].filter(p => p.includes('/shards/')).sort()).toEqual(shardsBefore)
    expect([...mem.files.keys()].filter(p => p.includes('/delta/'))).toHaveLength(2)
    expect(await found('information')).toEqual(['new/idea.md', 'reading/bell.md'])
    // The old word no longer points at the edited note.
    expect(await found('transistor')).toEqual([])
  })

  it('leaves an index written by another install alone', async () => {
    note('a.md', 'alpha')
    await runIndexer(true)
    localStorage.clear()  // now this install is a stranger to the index
    note('a.md', 'beta', 2)
    await runIndexer(false)
    expect(await found('beta')).toEqual([])
    expect(await found('alpha')).toEqual(['a.md'])
  })
})
