import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectChainDigest } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import { stringifyProjectChainDigestMarkdownBlock } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import { serializeUndertakingBlock, type UndertakingRecord } from '@/services/lego_blocks/units/aiActivityUndertakingBlock'

/**
 * The seam these tests guard: an undertaking's head is stored and its tail is
 * derived. Anything that lets the tail get written into the record is a bug —
 * that is exactly how `ranges/` went stale.
 */

class FakeVaultFS {
  readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>([''])

  seed(path: string, content: string): void {
    this.files.set(path, content)
    const parts = path.split('/')
    let cursor = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = cursor ? `${cursor}/${parts[i]}` : parts[i]
      this.dirs.add(cursor)
    }
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content == null) throw new Error(`Missing file: ${path}`)
    return content
  }

  async write(path: string, data: string): Promise<void> {
    this.seed(path, data)
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.split('/')
    let cursor = ''
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part
      this.dirs.add(cursor)
    }
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    if (!this.dirs.has(path)) throw new Error(`Missing folder: ${path}`)
    const files = new Set<string>()
    const folders = new Set<string>()
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(`${path}/`)) continue
      const rest = filePath.slice(path.length + 1)
      if (rest.includes('/')) folders.add(rest.slice(0, rest.indexOf('/')))
      else files.add(rest)
    }
    for (const dir of this.dirs) {
      if (!dir.startsWith(`${path}/`)) continue
      const rest = dir.slice(path.length + 1)
      if (!rest.includes('/')) folders.add(rest)
    }
    return { files: [...files].sort(), folders: [...folders].sort() }
  }
}

const fakeFs = new FakeVaultFS()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => fakeFs,
}))

function makeRecord(overrides: Partial<UndertakingRecord> = {}): UndertakingRecord {
  return {
    uuid: 'u-1',
    key: 'f9-und-micron',
    title: 'Micron memory cycle',
    projectId: 'F9',
    section: 'semis',
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    sortOrder: 1,
    tags: ['held'],
    proposedTags: ['machinery'],
    grewOutOf: [],
    chains: ['c-1', 'c-2'],
    alsoFedBy: [],
    files: [],
    origin: 'manual',
    head: 'HBM is the thesis.',
    ...overrides,
  }
}

function makeChain(overrides: Partial<ProjectChainDigest> = {}): ProjectChainDigest {
  return {
    projectId: 'F9',
    chainKey: 'c-1',
    date: '2026-06-02',
    title: 'Micron read',
    summary: 'Read the 10-K.',
    source: 'claude-code',
    msgCount: 20,
    durationMs: 60_000,
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T10:01:00.000Z',
    inputHash: 'h',
    generatedAt: '2026-06-02T10:05:00.000Z',
    model: 'test',
    generator: 'claude',
    filesWritten: ['vault://F9/micron.md'],
    filesRead: [],
    undertaking: '',
    ...overrides,
  }
}

function seedChain(digest: ProjectChainDigest, name = `${digest.chainKey}.md`): void {
  fakeFs.seed(
    `ai-activity/chains/${digest.projectId}/${digest.date}/${name.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
    stringifyProjectChainDigestMarkdownBlock(digest),
  )
}

function seedRecord(record: UndertakingRecord): void {
  fakeFs.seed(
    `ai-activity/thinking-organizer/${record.projectId}/undertakings/${record.key}.md`,
    serializeUndertakingBlock(record),
  )
}

beforeEach(() => {
  fakeFs.files.clear()
})

describe('collapseChainWindowsBlock', () => {
  it('keeps only the longest window per session, so duration is not double-counted', async () => {
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      { ...makeChain({ chainKey: 'c-1#w1', durationMs: 60_000 }), path: 'a' },
      { ...makeChain({ chainKey: 'c-1#w2', durationMs: 90_000 }), path: 'b' },
    ])

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].durationMs).toBe(90_000)
  })

  it('leaves distinct sessions alone', async () => {
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      { ...makeChain({ chainKey: 'c-1#w1', startedIso: '2026-06-02T10:00:00.000Z' }), path: 'a' },
      { ...makeChain({ chainKey: 'c-2#w1', startedIso: '2026-06-03T10:00:00.000Z' }), path: 'b' },
    ])

    expect(collapsed.map(c => c.chainKey)).toEqual(['c-1#w1', 'c-2#w1'])
  })
})

describe('listUndertakingsOrch', () => {
  it('derives the tail from chains rather than from the record', async () => {
    seedRecord(makeRecord())
    seedChain(makeChain({ chainKey: 'c-1', date: '2026-06-02', durationMs: 60_000 }))
    seedChain(makeChain({
      chainKey: 'c-2',
      date: '2026-06-03',
      durationMs: 120_000,
      startedIso: '2026-06-03T10:00:00.000Z',
      filesWritten: ['vault://F9/hbm.md'],
    }))

    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const views = await listUndertakingsOrch('F9')

    expect(views).toHaveLength(1)
    expect(views[0].tail).toMatchObject({
      chainCount: 2,
      durationMs: 180_000,
      dayCount: 2,
      firstDate: '2026-06-02',
      lastDate: '2026-06-03',
      files: ['vault://F9/hbm.md', 'vault://F9/micron.md'],
    })
  })

  it('picks up chains that name the undertaking even when the record does not list them', async () => {
    seedRecord(makeRecord({ chains: [] }))
    seedChain(makeChain({ chainKey: 'c-9', undertaking: 'f9-und-micron' }))

    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const views = await listUndertakingsOrch('F9')

    expect(views[0].tail.chainCount).toBe(1)
  })

  it('filters to a section', async () => {
    seedRecord(makeRecord({ key: 'a', section: 'semis' }))
    seedRecord(makeRecord({ key: 'b', section: 'grid', sortOrder: 2 }))

    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const views = await listUndertakingsOrch('F9', 'grid')

    expect(views.map(v => v.record.key)).toEqual(['b'])
  })

  it('returns an empty list for a project with no store rather than throwing', async () => {
    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(listUndertakingsOrch('Nonexistent')).resolves.toEqual([])
  })

  it('never writes the derived tail back into the record', async () => {
    seedRecord(makeRecord())
    seedChain(makeChain())

    const before = fakeFs.files.get('ai-activity/thinking-organizer/F9/undertakings/f9-und-micron.md')
    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await listUndertakingsOrch('F9')

    expect(fakeFs.files.get('ai-activity/thinking-organizer/F9/undertakings/f9-und-micron.md')).toBe(before)
  })
})

describe('updateUndertakingHeadOrch', () => {
  it('rewrites the head and moves updated_at but not created_at', async () => {
    seedRecord(makeRecord())

    const { updateUndertakingHeadOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const { record } = await updateUndertakingHeadOrch('F9', 'f9-und-micron', '  Commodity DRAM is noise.  ')

    expect(record.head).toBe('Commodity DRAM is noise.')
    expect(record.createdAt).toBe('2026-06-01')
    expect(record.updatedAt).not.toBe('2026-06-01')
  })

  it('throws on an unknown key instead of silently creating a record', async () => {
    const { updateUndertakingHeadOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(updateUndertakingHeadOrch('F9', 'nope', 'x')).rejects.toThrow(/not found/i)
  })
})

describe('tagUndertakingOrch', () => {
  function seedVocabulary(tags: string[]): void {
    fakeFs.seed('ai-activity/thinking-organizer/F9/tags.yaml', `tags:\n${tags.map(t => `  - "${t}"`).join('\n')}\n`)
  }

  it('adds a tag that exists in the vocabulary', async () => {
    seedRecord(makeRecord({ tags: [] }))
    seedVocabulary(['held', 'watchlist'])

    const { tagUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await tagUndertakingOrch('F9', 'f9-und-micron', { add: ['watchlist'] })

    expect(result.record.tags).toEqual(['watchlist'])
    expect(result.rejected).toEqual([])
  })

  it('refuses a tag outside the vocabulary, which is what stops fragmentation', async () => {
    seedRecord(makeRecord({ tags: [] }))
    seedVocabulary(['bucket 2'])

    const { tagUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await tagUndertakingOrch('F9', 'f9-und-micron', { add: ['bucket 2 - momentum phase'] })

    expect(result.record.tags).toEqual([])
    expect(result.rejected).toEqual(['bucket 2 - momentum phase'])
  })

  it('extends the vocabulary on disk when allowNew is set', async () => {
    seedRecord(makeRecord({ tags: [] }))
    seedVocabulary(['held'])

    const { tagUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await tagUndertakingOrch('F9', 'f9-und-micron', { add: ['fab-equipment'], allowNew: true })

    expect(result.added).toEqual(['fab-equipment'])
    expect(fakeFs.files.get('ai-activity/thinking-organizer/F9/tags.yaml')).toContain('fab-equipment')
  })

  it('promotes an accepted proposal out of proposedTags', async () => {
    seedRecord(makeRecord({ tags: [], proposedTags: ['machinery'] }))
    seedVocabulary(['machinery'])

    const { tagUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await tagUndertakingOrch('F9', 'f9-und-micron', { accept: ['machinery'] })

    expect(result.record.tags).toEqual(['machinery'])
    expect(result.record.proposedTags).toEqual([])
  })

  it('swaps a tag in one call, applying removals before additions', async () => {
    seedRecord(makeRecord({ tags: ['watchlist'] }))
    seedVocabulary(['watchlist', 'held'])

    const { tagUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await tagUndertakingOrch('F9', 'f9-und-micron', { remove: ['watchlist'], add: ['held'] })

    expect(result.record.tags).toEqual(['held'])
  })
})

describe('chain repair orchestrators', () => {
  it('moves the file when a chain is re-projected, since project id is a path segment', async () => {
    seedChain(makeChain({ chainKey: 'c-1', projectId: 'Thinking-Space' }))

    const { setChainProjectOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const { path } = await setChainProjectOrch('Thinking-Space', 'c-1', 'F9')

    expect(path).toBe('ai-activity/chains/F9/2026-06-02/c-1.md')
    expect(fakeFs.files.has('ai-activity/chains/Thinking-Space/2026-06-02/c-1.md')).toBe(false)
    expect(fakeFs.files.get(path)).toContain('projectId: F9')
  })

  it('backfills file pointers without disturbing the other side', async () => {
    seedChain(makeChain({ chainKey: 'c-1', filesWritten: ['vault://a.md'], filesRead: ['vault://b.md'] }))

    const { setChainFilesOrch, listChainsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await setChainFilesOrch('F9', 'c-1', { written: ['vault://c.md'] })
    const [chain] = await listChainsOrch({ projectId: 'F9' })

    expect(chain.filesWritten).toEqual(['vault://c.md'])
    expect(chain.filesRead).toEqual(['vault://b.md'])
  })

  it('throws on an unknown chain key', async () => {
    const { setChainFilesOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(setChainFilesOrch('F9', 'nope', { written: [] })).rejects.toThrow(/not found/i)
  })
})

describe('listChainsOrch', () => {
  it('bounds by date inclusively', async () => {
    seedChain(makeChain({ chainKey: 'c-1', date: '2026-06-01' }))
    seedChain(makeChain({ chainKey: 'c-2', date: '2026-06-02' }))
    seedChain(makeChain({ chainKey: 'c-3', date: '2026-06-03' }))

    const { listChainsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const chains = await listChainsOrch({ projectId: 'F9', from: '2026-06-02', to: '2026-06-03' })

    expect(chains.map(c => c.chainKey)).toEqual(['c-2', 'c-3'])
  })
})

describe('recordAssignmentOrch', () => {
  it('parks the answer under the session id, since no chain exists yet', async () => {
    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const { path } = await recordAssignmentOrch({
      sessionId: '3f3ea0fb-362b-4694-b744-cd5135c868d0',
      undertaking: 'f9-und-micron',
    })

    expect(path).toBe('ai-activity/pending-assignments/3f3ea0fb-362b-4694-b744-cd5135c868d0.json')
    const parsed = JSON.parse(fakeFs.files.get(path)!)
    expect(parsed.undertaking).toBe('f9-und-micron')
    expect(parsed.recordedAt).toBeTruthy()
  })
})
