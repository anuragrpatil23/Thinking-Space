import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectChainDigest } from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import {
  chainDigestVaultRelPathBlock,
  parseProjectChainDigestMarkdownBlock,
  stringifyProjectChainDigestMarkdownBlock,
} from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import {
  parseUndertakingBlock,
  serializeUndertakingBlock,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import { parseVerdictLogBlock } from '@/services/lego_blocks/units/assignmentVerdictBlock'
import { parseProposalLogBlock } from '@/services/lego_blocks/units/assignmentProposalBlock'

/**
 * What these guard is the contract, not the plumbing:
 *
 *   - a chain is never left merely unassigned; "not an undertaking" is a
 *     recorded verdict that lands somewhere;
 *   - minting is a human path, and an attach to a key that does not exist is
 *     held rather than created;
 *   - stamping is a union, so a repeat pass after a chain rebuild is a no-op;
 *   - every disposition is logged, including the ones nobody proposed for.
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

  reset(): void {
    this.files.clear()
    this.dirs.clear()
    this.dirs.add('')
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

const {
  createUndertakingOrch,
  detachChainOrch,
  disposeChainsOrch,
  ensureBucketUndertakingOrch,
  getAssignmentCalibrationOrch,
  getAssignmentQueueOrch,
  listRecentAutoAppliedOrch,
  listUndisposedChainsOrch,
  proposeAssignmentsOrch,
} = await import('@/services/orchestrators/assignmentQueueOrch')

const { writeUndertakingBlock } = await import(
  '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
)

function makeChain(overrides: Partial<ProjectChainDigest> = {}): ProjectChainDigest {
  const chainKey = overrides.chainKey ?? overrides.chainId ?? 'c-1'
  return {
    projectId: 'F9',
    chainId: chainKey,
    sessions: [chainKey],
    chainKey,
    date: '2026-06-02',
    title: 'Micron read',
    summary: 'Read the 10-K.',
    source: 'claude-code',
    msgCount: 20,
    durationMs: 60_000,
    activeDurationMs: 1_800_000,
    startedIso: '2026-06-02T10:00:00.000Z',
    endedIso: '2026-06-02T10:01:00.000Z',
    inputHash: 'h',
    generatedAt: '2026-06-02T10:05:00.000Z',
    model: 'test',
    generator: 'claude',
    filesWritten: [],
    filesRead: [],
    undertaking: [],
    ...overrides,
  }
}

function seedChain(digest: ProjectChainDigest): void {
  fakeFs.seed(
    chainDigestVaultRelPathBlock(digest.projectId, digest.chainId),
    stringifyProjectChainDigestMarkdownBlock(digest),
  )
}

function readChain(projectId: string, chainId: string): ProjectChainDigest | null {
  const raw = fakeFs.files.get(chainDigestVaultRelPathBlock(projectId, chainId))
  return raw ? parseProjectChainDigestMarkdownBlock(raw) : null
}

function makeRecord(overrides: Partial<UndertakingRecord> = {}): UndertakingRecord {
  return {
    uuid: 'u-1',
    key: 'f9-und-micron',
    title: 'Micron memory cycle',
    projectId: 'proj-uuid',
    section: 'f9-sec-semis',
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    sortOrder: 1,
    tags: [],
    proposedTags: [],
    grewOutOf: [],
    fedBy: [],
    produced: [],
    chains: [],
    files: [],
    origin: 'manual',
    bucket: false,
    head: 'HBM is the thesis.',
    comments: [],
    ...overrides,
  }
}

/** Seeded under the *import's* filename convention, not the derived one — that
 *  mismatch is real in this vault and is what the write-path fix addresses. */
function seedRecord(projectId: string, record: UndertakingRecord, fileName?: string): void {
  fakeFs.seed(
    `ai-activity/thinking-organizer/${projectId}/undertakings/${fileName ?? `${record.key}.md`}`,
    serializeUndertakingBlock(record),
  )
}

function readVerdicts() {
  const out = []
  for (const [path, content] of fakeFs.files) {
    if (path.startsWith('ai-activity/assignment-log/')) out.push(...parseVerdictLogBlock(content))
  }
  return out
}

function listRecords(projectId: string): UndertakingRecord[] {
  const dir = `ai-activity/thinking-organizer/${projectId}/undertakings`
  const out: UndertakingRecord[] = []
  for (const [path, content] of fakeFs.files) {
    if (!path.startsWith(`${dir}/`)) continue
    const record = parseUndertakingBlock(content)
    if (record) out.push(record)
  }
  return out
}

beforeEach(() => {
  fakeFs.reset()
})

describe('listUndisposedChainsOrch', () => {
  it('counts a chain with no undertaking and skips one that has any', () => {
    seedChain(makeChain({ chainId: 'c-1' }))
    seedChain(makeChain({ chainId: 'c-2', undertaking: ['f9-und-micron'] }))
    return expect(
      listUndisposedChainsOrch('F9').then(chains => chains.map(c => c.chainId)),
    ).resolves.toEqual(['c-1'])
  })

  it('sweeps every project on disk when given none, including unadopted keys', async () => {
    seedChain(makeChain({ chainId: 'c-1', projectId: 'F9' }))
    seedChain(makeChain({ chainId: 'c-2', projectId: 'unknown-cwd' }))
    const chains = await listUndisposedChainsOrch()
    expect(chains.map(c => c.projectId).sort()).toEqual(['F9', 'unknown-cwd'])
  })

  it('treats a chain stamped with only whitespace as still owing a disposition', async () => {
    seedChain(makeChain({ chainId: 'c-1', undertaking: ['   '] }))
    expect(await listUndisposedChainsOrch('F9')).toHaveLength(1)
  })
})

describe('getAssignmentQueueOrch', () => {
  it('groups proposals and separates the chains nothing has proposed for', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))
    seedChain(makeChain({ chainId: 'c-2' }))
    seedChain(makeChain({ chainId: 'c-3' }))
    await proposeAssignmentsOrch([
      { chainId: 'c-1', projectId: 'F9', target: { kind: 'existing', key: 'f9-und-micron' }, confidence: 0.9, rationale: 'same 10-K', proposedBy: 'kai' },
      { chainId: 'c-2', projectId: 'F9', target: { kind: 'existing', key: 'f9-und-micron' }, confidence: 0.8, rationale: 'same 10-K', proposedBy: 'kai' },
    ])

    const queue = await getAssignmentQueueOrch('F9')
    expect(queue.items).toHaveLength(1)
    expect(queue.items[0].chains.map(c => c.chainId)).toEqual(['c-1', 'c-2'])
    // The row shows the undertaking's title, not the bare key it points at.
    expect(queue.items[0].targetTitle).toBe('Micron memory cycle')
    expect(queue.unproposed.map(c => c.chainId)).toEqual(['c-3'])
    expect(queue.undisposedCount).toBe(3)
  })

  it('drops a proposal whose chain has since been disposed of', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1', undertaking: ['f9-und-micron'] }))
    await proposeAssignmentsOrch([
      { chainId: 'c-1', projectId: 'F9', target: { kind: 'bucket' }, confidence: 0.9, rationale: 'noise', proposedBy: 'kai' },
    ])
    const queue = await getAssignmentQueueOrch('F9')
    expect(queue.items).toEqual([])
    expect(queue.undisposedCount).toBe(0)
  })
})

describe('disposeChainsOrch', () => {
  it('stamps the group and logs an accept when it lands where proposed', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))
    seedChain(makeChain({ chainId: 'c-2' }))

    const target = { kind: 'existing', key: 'f9-und-micron' } as const
    const result = await disposeChainsOrch({
      chainIds: ['c-1', 'c-2'],
      projectId: 'F9',
      proposed: target,
      confidence: 0.9,
      target,
    })

    expect(result.verdict).toBe('accept')
    expect(result.stamped.sort()).toEqual(['c-1', 'c-2'])
    expect(readChain('F9', 'c-1')?.undertaking).toEqual(['f9-und-micron'])
    expect(readVerdicts().every(v => v.verdict === 'accept')).toBe(true)
  })

  it('logs a modify — with both sides — when the human retargets', async () => {
    seedRecord('F9', makeRecord())
    seedRecord('F9', makeRecord({ uuid: 'u-2', key: 'f9-und-hbm', title: 'HBM', sortOrder: 2 }))
    seedChain(makeChain({ chainId: 'c-1' }))

    const result = await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: { kind: 'existing', key: 'f9-und-micron' },
      confidence: 0.9,
      target: { kind: 'existing', key: 'f9-und-hbm' },
    })

    expect(result.verdict).toBe('modify')
    const [verdict] = readVerdicts()
    expect(verdict.proposed).toEqual({ kind: 'existing', key: 'f9-und-micron' })
    expect(verdict.correctedTo).toEqual({ kind: 'existing', key: 'f9-und-hbm' })
  })

  it('leaves a rejected chain undisposed but records that it was judged', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))

    const result = await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: { kind: 'existing', key: 'f9-und-micron' },
      confidence: 0.5,
      target: null,
    })

    expect(result.verdict).toBe('reject')
    expect(readChain('F9', 'c-1')?.undertaking).toEqual([])
    expect(await listUndisposedChainsOrch('F9')).toHaveLength(1)
    expect(readVerdicts()).toHaveLength(1)
  })

  it('stamps as a union, so a chain can feed two undertakings and a re-run is a no-op', async () => {
    seedRecord('F9', makeRecord())
    seedRecord('F9', makeRecord({ uuid: 'u-2', key: 'f9-und-hbm', title: 'HBM', sortOrder: 2 }))
    seedChain(makeChain({ chainId: 'c-1', undertaking: ['f9-und-micron'] }))

    await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: null,
      confidence: 0,
      target: { kind: 'existing', key: 'f9-und-hbm' },
    })
    expect(readChain('F9', 'c-1')?.undertaking).toEqual(['f9-und-micron', 'f9-und-hbm'])

    const again = await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: null,
      confidence: 0,
      target: { kind: 'existing', key: 'f9-und-hbm' },
    })
    expect(again.stamped).toEqual([])
    expect(readChain('F9', 'c-1')?.undertaking).toEqual(['f9-und-micron', 'f9-und-hbm'])
  })

  it('holds an attach to a key that does not exist rather than minting it', async () => {
    seedChain(makeChain({ chainId: 'c-1' }))
    await expect(
      disposeChainsOrch({
        chainIds: ['c-1'],
        projectId: 'F9',
        proposed: null,
        confidence: 0,
        target: { kind: 'existing', key: 'f9-und-typoo' },
      }),
    ).rejects.toThrow(/Unknown undertaking/)
    expect(listRecords('F9')).toHaveLength(0)
    expect(readChain('F9', 'c-1')?.undertaking).toEqual([])
  })

  it('files a bucket verdict into a real record, so the chain is disposed of and not blank', async () => {
    seedChain(makeChain({ chainId: 'c-1' }))

    const result = await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: { kind: 'bucket' },
      confidence: 0.9,
      target: { kind: 'bucket' },
    })

    const bucket = listRecords('F9').find(r => r.bucket)
    expect(bucket).toBeDefined()
    expect(result.undertaking).toBe(bucket!.key)
    expect(readChain('F9', 'c-1')?.undertaking).toEqual([bucket!.key])
    expect(await listUndisposedChainsOrch('F9')).toHaveLength(0)
  })

  it('logs a disposition even when no proposal was on the table', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))
    await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: null,
      confidence: 0,
      target: { kind: 'existing', key: 'f9-und-micron' },
    })
    const [verdict] = readVerdicts()
    expect(verdict.proposed).toBeNull()
    expect(verdict.verdict).toBe('modify')
  })

  it('records where a mint actually landed, not the title that was typed', async () => {
    seedChain(makeChain({ chainId: 'c-1' }))
    const result = await disposeChainsOrch({
      chainIds: ['c-1'],
      projectId: 'F9',
      proposed: { kind: 'new', title: 'Ghost sessions' },
      confidence: 0.7,
      target: { kind: 'new', title: 'Ghost sessions' },
    })
    expect(result.verdict).toBe('accept')
    expect(result.undertaking).toBe('f9-und-ghost-sessions')
    expect(readVerdicts()[0].correctedTo).toEqual({ kind: 'existing', key: 'f9-und-ghost-sessions' })
  })
})

describe('createUndertakingOrch', () => {
  it('mints a key from the title and files it under the first section', async () => {
    fakeFs.seed(
      'ai-activity/thinking-organizer/F9/sections/section-semis.md',
      ['---', 'uuid: s-1', 'key: f9-sec-semis', 'title: Semis', 'record_kind: section', 'sort_order: 1', '---', ''].join('\n'),
    )
    const { record } = await createUndertakingOrch('F9', { title: 'Ghost sessions' })
    expect(record.key).toBe('f9-und-ghost-sessions')
    expect(record.section).toBe('f9-sec-semis')
    expect(record.bucket).toBe(false)
  })

  it('gives a colliding title its own address rather than one shared file', async () => {
    seedRecord('F9', makeRecord({ key: 'f9-und-micron' }))
    const { record } = await createUndertakingOrch('F9', { title: 'Micron' })
    expect(record.key).toBe('f9-und-micron-2')
  })
})

describe('ensureBucketUndertakingOrch', () => {
  it('creates the pile once and reuses it after', async () => {
    const first = await ensureBucketUndertakingOrch('F9')
    const second = await ensureBucketUndertakingOrch('F9')
    expect(second.key).toBe(first.key)
    expect(listRecords('F9').filter(r => r.bucket)).toHaveLength(1)
  })

  it('matches on the flag, so renaming the pile does not mint a second one', async () => {
    const created = await ensureBucketUndertakingOrch('F9')
    seedRecord('F9', { ...created, title: 'Junk drawer' })
    const again = await ensureBucketUndertakingOrch('F9')
    expect(again.key).toBe(created.key)
    expect(listRecords('F9').filter(r => r.bucket)).toHaveLength(1)
  })
})

describe('detachChainOrch', () => {
  it('puts a chain back in the queue rather than losing it', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1', undertaking: ['f9-und-micron'] }))
    await detachChainOrch('F9', 'c-1', 'f9-und-micron')
    expect(readChain('F9', 'c-1')?.undertaking).toEqual([])
    expect(await listUndisposedChainsOrch('F9')).toHaveLength(1)
  })

  it('is a no-op when the chain was never stamped with that key', async () => {
    seedChain(makeChain({ chainId: 'c-1' }))
    expect(await detachChainOrch('F9', 'c-1', 'f9-und-micron')).toBeNull()
  })
})

describe('calibration', () => {
  it('grades only human verdicts, so an auto-applied band cannot confirm itself', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))
    seedChain(makeChain({ chainId: 'c-2' }))
    const target = { kind: 'existing', key: 'f9-und-micron' } as const

    await disposeChainsOrch({ chainIds: ['c-1'], projectId: 'F9', proposed: target, confidence: 0.9, target, decidedBy: 'auto' })
    await disposeChainsOrch({ chainIds: ['c-2'], projectId: 'F9', proposed: target, confidence: 0.9, target })

    const high = (await getAssignmentCalibrationOrch()).find(row => row.band === 'high')!
    expect(high.total).toBe(1)
    expect(high.acceptRate).toBe(1)
  })

  it('reports an untried band as unearned rather than perfect', async () => {
    const low = (await getAssignmentCalibrationOrch()).find(row => row.band === 'low')!
    expect(low.total).toBe(0)
    expect(low.acceptRate).toBe(0)
  })

  it('surfaces auto-applied stamps so none of them is invisible', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1' }))
    const target = { kind: 'existing', key: 'f9-und-micron' } as const
    await disposeChainsOrch({ chainIds: ['c-1'], projectId: 'F9', proposed: target, confidence: 0.9, target, decidedBy: 'auto' })
    const recent = await listRecentAutoAppliedOrch()
    expect(recent).toHaveLength(1)
    expect(recent[0].chainId).toBe('c-1')
  })
})

describe('the proposal log', () => {
  it('appends rather than replacing, keeping what the model used to think', async () => {
    await proposeAssignmentsOrch([
      { chainId: 'c-1', projectId: 'F9', target: { kind: 'bucket' }, confidence: 0.4, rationale: 'noise', proposedBy: 'kai' },
    ])
    await proposeAssignmentsOrch([
      { chainId: 'c-1', projectId: 'F9', target: { kind: 'new', title: 'Real work' }, confidence: 0.8, rationale: 'second look', proposedBy: 'kai' },
    ])
    const lines = parseProposalLogBlock(fakeFs.files.get('ai-activity/proposals/F9.jsonl')!)
    expect(lines).toHaveLength(2)
    expect(lines[1].target).toEqual({ kind: 'new', title: 'Real work' })
  })
})

describe('the undertaking write path', () => {
  it('rewrites the file a key already lives in instead of forking the record', async () => {
    // Every record in this vault is named by the import's convention, which is
    // not what `undertakingPathBlock` derives. Writing to the derived path would
    // leave two files carrying one key, and the index would show it twice.
    seedRecord('F9', makeRecord(), 'undertaking-micron.md')
    const path = await writeUndertakingBlock('F9', makeRecord({ title: 'Renamed' }))
    expect(path).toBe('ai-activity/thinking-organizer/F9/undertakings/undertaking-micron.md')
    const found = listRecords('F9').filter(r => r.key === 'f9-und-micron')
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('Renamed')
  })

  it('mints a derived path for a key nothing is filed under yet', async () => {
    const path = await writeUndertakingBlock('F9', makeRecord({ key: 'f9-und-new' }))
    expect(path).toBe('ai-activity/thinking-organizer/F9/undertakings/f9-und-new.md')
  })
})

describe('a proposal that matches no chain', () => {
  it('is surfaced as an orphan, not silently dropped', async () => {
    seedChain(makeChain({ chainId: 'c-1' }))
    await proposeAssignmentsOrch([
      { chainId: 'truncated-id', projectId: 'F9', target: { kind: 'bucket' }, confidence: 0.9, rationale: 'x', proposedBy: 'kai' },
    ])
    const queue = await getAssignmentQueueOrch('F9')
    expect(queue.items).toEqual([])
    expect(queue.orphanedProposals).toEqual([
      { chainId: 'truncated-id', projectId: 'F9', proposedBy: 'kai' },
    ])
  })

  it('does not confuse an answered proposal with a mistyped one', async () => {
    seedRecord('F9', makeRecord())
    seedChain(makeChain({ chainId: 'c-1', undertaking: ['f9-und-micron'] }))
    await proposeAssignmentsOrch([
      { chainId: 'c-1', projectId: 'F9', target: { kind: 'bucket' }, confidence: 0.9, rationale: 'x', proposedBy: 'kai' },
    ])
    const queue = await getAssignmentQueueOrch('F9')
    expect(queue.items).toEqual([])
    expect(queue.orphanedProposals).toEqual([])
  })
})
