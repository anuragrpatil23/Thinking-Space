import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSessionDigest } from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import type { ProjectChainRollup } from '@/services/orchestrators/aiActivityChainsOrch'
import {
  sessionDigestVaultRelPathBlock,
  stringifyProjectSessionDigestMarkdownBlock,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import { serializeUndertakingBlock, type UndertakingRecord } from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import { serializeSectionBlock, type SectionRecord } from '@/services/lego_blocks/units/aiActivitySectionBlock'
import type { Task } from '@/services/lego_blocks/units/aiActivityTaskBlock'

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

// The registry is how a project's authored records get found at all. Empty by
// default so most tests exercise only the derived half.
let registry: Array<{ project: string; paths: string[] }> = []
let taskSources: Record<string, { dir: string; label: string }> = {}

vi.mock('@/services/lego_blocks/integrations/projectRegistryLoaderBlock', () => ({
  loadProjectRegistryBlock: async () => {},
}))
// Only the caches are stubbed: `relativizeRegistryEntriesBlock` is pure and
// shared with discovery, so the real one is what these tests should exercise.
vi.mock('@/services/lego_blocks/units/projectRegistryBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/projectRegistryBlock')>()),
  readCachedProjectRegistryBlock: () => registry,
  readCachedProjectTaskSourcesBlock: () => taskSources,
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
    fedBy: [],
    produced: [],
    chains: ['c-1', 'c-2'],
    files: [],
    origin: 'manual',
    bucket: false,
    head: 'HBM is the thesis.',
    comments: [],
    ...overrides,
  }
}

/**
 * One session digest — and therefore, since chains are derived from these, one
 * sitting per fixture unless two are deliberately placed close in time.
 *
 * The hour is derived from the key's numeric suffix (`c-1` → 10:00, `c-2` →
 * 14:00) so distinct fixtures land more than `IDLE_GAP_HOURS` apart and stay
 * distinct chains. That spacing is now load-bearing in a way it never was when
 * each chain was its own file: grouping is by time, so two fixtures sharing a
 * timestamp would merge into one sitting and quietly halve every count below.
 */
function makeChain(overrides: Partial<ProjectSessionDigest> = {}): ProjectSessionDigest {
  const sessionId = overrides.sessionId ?? 'c-1'
  const ordinal = Number(/(\d+)$/.exec(sessionId)?.[1] ?? 1)
  const date = overrides.date ?? '2026-06-02'
  // Two-hour slots keep every fixture more than IDLE_GAP_HOURS from its
  // neighbours (so they stay distinct sittings) while staying a valid hour for
  // ordinals up to 10.
  const hour = String((ordinal * 2) % 22).padStart(2, '0')
  const startedIso = overrides.startedIso ?? `${date}T${hour}:00:00.000Z`
  // The window is the source of truth for duration now — a rollup derives
  // `durationMs` from its members' start and end rather than trusting a stored
  // number, so a fixture that states a duration must state a window that agrees.
  const durationMs = overrides.durationMs ?? 60_000
  return {
    projectId: 'F9',
    sessionId,
    path: `native/claude/${sessionId}.jsonl`,
    date,
    title: 'Micron read',
    summary: 'Read the 10-K.',
    source: 'claude-code',
    msgCount: 20,
    durationMs,
    activeDurationMs: 0,
    startedIso,
    endedIso: new Date(Date.parse(startedIso) + durationMs).toISOString(),
    hadClear: false,
    inputHash: 'h',
    generatedAt: `${date}T${hour}:05:00.000Z`,
    model: 'test',
    generator: 'claude',
    filesWritten: ['vault://F9/micron.md'],
    filesRead: [],
    undertaking: [],
    ...overrides,
  }
}

/** One session digest as the single-member chain rollup it derives into.
 *  `collapseChainWindowsBlock` operates on sittings, and a lone session is the
 *  smallest sitting there is. */
function rollup(digest: ProjectSessionDigest): ProjectChainRollup {
  return {
    projectId: digest.projectId,
    chainKey: `${digest.projectId}::${digest.sessionId}`,
    sessions: [digest],
    title: digest.title,
    date: digest.date,
    startedIso: digest.startedIso,
    endedIso: digest.endedIso,
    durationMs: digest.durationMs,
    activeDurationMs: digest.activeDurationMs,
    msgCount: digest.msgCount,
    filesWritten: digest.filesWritten,
    filesRead: digest.filesRead,
    undertaking: digest.undertaking,
  }
}

/** Flat, addressed by session id — the only address there is. */
function seedChain(digest: ProjectSessionDigest): void {
  fakeFs.seed(
    sessionDigestVaultRelPathBlock(digest.projectId, digest.sessionId),
    stringifyProjectSessionDigestMarkdownBlock(digest),
  )
}

function seedRecord(record: UndertakingRecord): void {
  fakeFs.seed(
    `ai-activity/thinking-organizer/${record.projectId}/undertakings/${record.key}.md`,
    serializeUndertakingBlock(record),
  )
}

function makeSection(over: Partial<SectionRecord> = {}): SectionRecord {
  return {
    uuid: 's-uuid',
    key: 'f9-sec-ideas',
    title: 'Ideas',
    projectId: 'proj-uuid',
    sortOrder: 1,
    origin: 'test',
    body: 'Section.',
    ...over,
  }
}

function seedSectionRecord(record: SectionRecord): void {
  fakeFs.seed(
    `ai-activity/thinking-organizer/F9/sections/${record.key.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`,
    serializeSectionBlock(record),
  )
}

function seedAsk(projectRoot: string, key: string, title: string, createdAt: string): void {
  fakeFs.seed(
    `${projectRoot}/thinking-organizer/epics/${key}.md`,
    `---\nkey: ${key}\ntitle: "${title}"\ntype: epic\nrecord_kind: epic\ncreated_at: "${createdAt}"\n---\n\nAsk.\n`,
  )
}

function seedSection(projectId: string, key: string, title: string, sortOrder: number): void {
  fakeFs.seed(
    `ai-activity/thinking-organizer/${projectId}/sections/${key}.md`,
    `---\nkey: ${key}\ntitle: "${title}"\nrecord_kind: section\nsort_order: ${sortOrder}\n---\n\nSection.\n`,
  )
}

beforeEach(() => {
  fakeFs.files.clear()
  registry = []
})

describe('collapseChainWindowsBlock', () => {
  it('keeps the longest of two overlapping windows, so duration is not double-counted', async () => {
    // PreCompact and SessionEnd both firing on one sitting: same session id,
    // same clock. This is the case the collapse exists for.
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      rollup(makeChain({
          sessionId: 'c-1#w1',
          durationMs: 60_000,
          startedIso: '2026-06-02T10:00:00.000Z',
          endedIso: '2026-06-02T10:01:00.000Z',
        })),
      rollup(makeChain({
          sessionId: 'c-1#w2',
          durationMs: 90_000,
          startedIso: '2026-06-02T10:00:00.000Z',
          endedIso: '2026-06-02T10:01:30.000Z',
        })),
    ])

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].durationMs).toBe(90_000)
  })

  it('keeps disjoint windows of the same session — they are separate sittings', async () => {
    // The `#w` suffix comes from idle-gap splitting, not from duplicate hook
    // fires. Two windows days apart are two days of work, and collapsing them
    // to the longer one silently deleted the other from every tail.
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      rollup(makeChain({
          sessionId: 'c-1',
          date: '2026-06-19',
          durationMs: 4_849_749,
          startedIso: '2026-06-19T20:43:59.000Z',
          endedIso: '2026-06-19T22:04:49.000Z',
        })),
      rollup(makeChain({
          sessionId: 'c-1#w2',
          date: '2026-06-23',
          durationMs: 7_785_561,
          startedIso: '2026-06-23T00:18:24.000Z',
          endedIso: '2026-06-23T02:28:10.000Z',
        })),
    ])

    expect(collapsed.map(c => c.chainKey)).toEqual(['F9::c-1', 'F9::c-1#w2'])
  })

  it('chains a run of overlapping windows into one sitting', async () => {
    // A overlaps B, B overlaps C, A and C do not touch. All three are one
    // sitting, so the cluster end has to be a high-water mark.
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      rollup(makeChain({
          sessionId: 'c-1#w1',
          durationMs: 60_000,
          startedIso: '2026-06-02T10:00:00.000Z',
          endedIso: '2026-06-02T10:01:00.000Z',
        })),
      rollup(makeChain({
          sessionId: 'c-1#w2',
          durationMs: 120_000,
          startedIso: '2026-06-02T10:00:30.000Z',
          endedIso: '2026-06-02T10:02:30.000Z',
        })),
      rollup(makeChain({
          sessionId: 'c-1#w3',
          durationMs: 30_000,
          startedIso: '2026-06-02T10:02:00.000Z',
          endedIso: '2026-06-02T10:02:30.000Z',
        })),
    ])

    expect(collapsed.map(c => c.chainKey)).toEqual(['F9::c-1#w2'])
  })

  it('leaves distinct sessions alone', async () => {
    const { collapseChainWindowsBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const collapsed = collapseChainWindowsBlock([
      rollup(makeChain({ sessionId: 'c-1#w1', startedIso: '2026-06-02T10:00:00.000Z' })),
      rollup(makeChain({ sessionId: 'c-2#w1', startedIso: '2026-06-03T10:00:00.000Z' })),
    ])

    expect(collapsed.map(c => c.chainKey)).toEqual(['F9::c-1#w1', 'F9::c-2#w1'])
  })
})

describe('listUndertakingsOrch', () => {
  it('derives the tail from chains rather than from the record', async () => {
    seedRecord(makeRecord())
    seedChain(makeChain({ sessionId: 'c-1', date: '2026-06-02', durationMs: 60_000 }))
    seedChain(makeChain({
      sessionId: 'c-2',
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

  it('sums active duration for the sparkline, falling back to wall-clock per un-healed chain', async () => {
    seedRecord(makeRecord())
    // c-1: healed — 30m wall-clock but only 5m of active work (long pauses).
    seedChain(makeChain({ sessionId: 'c-1', date: '2026-06-02', durationMs: 1_800_000, activeDurationMs: 300_000 }))
    // c-2: pre-field digest (activeDurationMs 0) → falls back to its wall-clock.
    seedChain(makeChain({
      sessionId: 'c-2',
      date: '2026-06-03',
      durationMs: 600_000,
      activeDurationMs: 0,
      startedIso: '2026-06-03T10:00:00.000Z',
    }))

    const { listUndertakingsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const views = await listUndertakingsOrch('F9')

    expect(views[0].tail.durationMs).toBe(2_400_000) // wall-clock unchanged
    expect(views[0].tail.activeDurationMs).toBe(900_000) // 300k active + 600k fallback
    const byDate = Object.fromEntries(views[0].tail.density.map(d => [d.date, d.activeDurationMs]))
    expect(byDate['2026-06-02']).toBe(300_000)
    expect(byDate['2026-06-03']).toBe(600_000)
  })

  it('picks up chains that name the undertaking even when the record does not list them', async () => {
    seedRecord(makeRecord({ chains: [] }))
    seedChain(makeChain({ sessionId: 'c-9', undertaking: ['f9-und-micron'] }))

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
})

describe('buildTaskSeamBlock', () => {
  const ask = (key: string, title: string, categoryCode: string, openedDate: string): Task => ({
    key,
    title,
    categoryCode,
    category: categoryCode,
    openedDate,
    tags: [],
    ticket: key.toUpperCase(),
    disposition: '',
  })
  const NOW = Date.parse('2026-07-30T00:00:00.000Z')

  it('migrates a Question that fed an undertaking out of its section, keeps a standing Idea in place with a link', async () => {
    const tasks = [
      ask('f9-ide-e-534', 'MU hits $100B revenue', 'IDE', '2026-04-01'),
      ask('f9-ic-e-499', 'LAM Research — learn more', 'IC', '2026-03-01'),
      ask('f9-qt-e-672', 'What are TSMC margins?', 'QT', '2026-02-20'),
    ]
    // fed_by holds both tasks and chain keys; the chain key must be ignored.
    const records = [
      makeRecord({ key: 'u-micron', title: 'Micron — the memory cycle', fedBy: ['F9-IDE-E-534', 'F9::native/claude/x.jsonl'] }),
      makeRecord({ key: 'u-tide', title: 'The Cognition Tide', fedBy: ['F9-QT-E-672'] }),
    ]

    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, records, NOW)

    // The Question that fed an undertaking migrated: subline under it, gone from sections.
    expect(seam.fedTasks.get('u-tide')?.[0].title).toBe('What are TSMC margins?')
    expect(seam.taskSections.some(s => s.code === 'QT')).toBe(false)
    // The Idea is standing: it stays in its section, carrying a link, not a subline.
    expect(seam.fedTasks.has('u-micron')).toBe(false)
    const ideas = seam.taskSections.find(s => s.code === 'IDE')
    expect(ideas?.tasks[0].fedInto?.title).toBe('Micron — the memory cycle')
    // The untouched company task is just present, no link.
    const companies = seam.taskSections.find(s => s.code === 'IC')
    expect(companies?.tasks[0].fedInto).toBeUndefined()
  })

  it('joins fed_by edges to slugged task keys via the ticket (shows title, not the raw ticket)', async () => {
    const tasks: Task[] = [{
      key: 'f9-qt-e-541-history-of-silicon-chips',
      title: 'History of silicon chips',
      categoryCode: 'QT',
      category: 'Questions to research',
      openedDate: '2026-03-01',
      tags: [],
      ticket: 'F9-QT-E-541',
      disposition: '',
    }]
    const records = [makeRecord({ key: 'u-tsmc', title: 'TSMC study', fedBy: ['F9-QT-E-541'] })]
    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, records, NOW)

    // The subline shows the task's title (join succeeded), not the raw ticket.
    expect(seam.fedTasks.get('u-tsmc')?.[0].title).toBe('History of silicon chips')
    // And the migrating QT actually left its section.
    expect(seam.taskSections.some(s => s.code === 'QT')).toBe(false)
  })

  it('orders task kinds by their oldest task', async () => {
    const tasks = [
      ask('f9-ide-e-1', 'newer idea', 'IDE', '2026-06-01'),
      ask('f9-mide-e-1', 'older missed idea', 'MIDE', '2026-02-01'),
    ]
    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, [], NOW)

    // Missed Ideas lead — their oldest task predates Ideas'.
    expect(seam.taskSections.map(s => s.code)).toEqual(['MIDE', 'IDE'])
  })

  it('orders the rows inside a kind newest first, undated last', async () => {
    const tasks = [
      ask('f9-ide-e-1', 'oldest', 'IDE', '2026-01-01'),
      ask('f9-ide-e-2', 'undated', 'IDE', ''),
      ask('f9-ide-e-3', 'newest', 'IDE', '2026-06-01'),
    ]
    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, [], NOW)

    // The composer sits at the head of the block, so what you just wrote has to
    // land next to it — not at the far end of the list.
    expect(seam.taskSections[0].tasks.map(t => t.task.title)).toEqual(['newest', 'oldest', 'undated'])
  })

  it('keeps kinds ordered by their oldest task even though the rows run newest first', async () => {
    const tasks = [
      // Ideas hold both the newest task overall and the oldest task overall.
      ask('f9-ide-e-1', 'idea, oldest overall', 'IDE', '2026-01-01'),
      ask('f9-ide-e-2', 'idea, newest overall', 'IDE', '2026-09-01'),
      ask('f9-mide-e-1', 'missed idea', 'MIDE', '2026-05-01'),
    ]
    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, [], NOW)

    // Reading the block's first row (now the newest) would put Ideas last.
    expect(seam.taskSections.map(s => s.code)).toEqual(['IDE', 'MIDE'])
  })

  it('migrates an Interesting-company task that fed a study, and back-links a produced task', async () => {
    const tasks = [
      ask('f9-ic-e-499', 'LAM Research — learn more', 'IC', '2026-03-01'),
      ask('f9-el-e-412', 'exit above the round number', 'EL', '2026-06-20'),
    ]
    const records = [
      makeRecord({ key: 'u-lam', title: 'LAM — the study', fedBy: ['F9-IC-E-499'] }),
      makeRecord({ key: 'u-review', title: 'June review', produced: ['F9-EL-E-412'] }),
    ]
    const { buildTaskSeamBlock } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const seam = buildTaskSeamBlock(tasks, records, NOW)

    // IC now migrates: the studied company leaves its section, tucks under the study.
    expect(seam.fedTasks.get('u-lam')?.[0].title).toBe('LAM Research — learn more')
    expect(seam.taskSections.some(s => s.code === 'IC')).toBe(false)
    // The produced learning stays in its section with a back-link to its source.
    const learnings = seam.taskSections.find(s => s.code === 'EL')
    expect(learnings?.tasks[0].producedBy?.title).toBe('June review')
  })
})

describe('getUndertakingOrch', () => {
  it('resolves the tail via the chain-directory id, not the record projectId (UUID)', async () => {
    // Production shape: the record lives under the directory id `F9`, but its
    // `projectId` frontmatter is the project's stable UUID. Chains live under
    // `chains/F9/`. Reading chains by `record.projectId` looks in
    // `chains/<uuid>/`, finds nothing, and every detail page shows 0 sessions.
    const record = makeRecord({ projectId: '8bf4d342-uuid', chains: ['c-1'] })
    fakeFs.seed(
      `ai-activity/thinking-organizer/F9/undertakings/${record.key}.md`,
      serializeUndertakingBlock(record),
    )
    seedChain(makeChain({ sessionId: 'c-1', date: '2026-06-03', durationMs: 90_000 }))

    const { getUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const view = await getUndertakingOrch('F9', record.key)

    expect(view).not.toBeNull()
    expect(view!.tail.chainCount).toBe(1)
    expect((view!.chains ?? []).map(c => c.chainKey)).toEqual(['F9::c-1'])
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

describe('undertaking comments', () => {
  it('adds a dated comment newest-first and persists it to the body', async () => {
    seedRecord(makeRecord())
    const { addUndertakingCommentOrch, getUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    await addUndertakingCommentOrch('F9', 'f9-und-micron', '  first comment  ')
    const { record } = await addUndertakingCommentOrch('F9', 'f9-und-micron', 'second comment')

    expect(record.comments).toHaveLength(2)
    expect(record.comments[0].text).toBe('second comment') // newest first
    expect(record.comments[1].text).toBe('first comment') // trimmed
    expect(record.comments[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Round-trips through the store, not just the returned object.
    const reread = await getUndertakingOrch('F9', 'f9-und-micron')
    expect(reread!.record.comments.map(n => n.text)).toEqual(['second comment', 'first comment'])
  })

  it('rejects an empty comment', async () => {
    seedRecord(makeRecord())
    const { addUndertakingCommentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(addUndertakingCommentOrch('F9', 'f9-und-micron', '   ')).rejects.toThrow(/empty/i)
  })

  it('removes a comment by its position in the newest-first list', async () => {
    seedRecord(makeRecord({ comments: [
      { date: '2026-07-31', author: '', text: 'newest' },
      { date: '2026-06-02', author: '', text: 'oldest' },
    ] }))
    const { removeUndertakingCommentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    const { record } = await removeUndertakingCommentOrch('F9', 'f9-und-micron', 0)
    expect(record.comments.map(n => n.text)).toEqual(['oldest'])
  })

  it('throws on an out-of-range comment index rather than silently no-op', async () => {
    seedRecord(makeRecord())
    const { removeUndertakingCommentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(removeUndertakingCommentOrch('F9', 'f9-und-micron', 3)).rejects.toThrow(/no comment/i)
  })
})

describe('updateUndertakingFieldsOrch', () => {
  it('patches title, section, and grew_out_of, moving updated_at', async () => {
    seedRecord(makeRecord())
    const { updateUndertakingFieldsOrch, getUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    await updateUndertakingFieldsOrch('F9', 'f9-und-micron', {
      title: '  Micron — the cycle turns  ',
      section: 'f9-sec-ideas',
      grewOutOf: ['f9-und-tsmc'],
    })

    const { record } = (await getUndertakingOrch('F9', 'f9-und-micron'))!
    expect(record.title).toBe('Micron — the cycle turns') // trimmed
    expect(record.section).toBe('f9-sec-ideas')
    expect(record.grewOutOf).toEqual(['f9-und-tsmc'])
    expect(record.updatedAt).not.toBe('2026-06-01')
  })

  it('leaves untouched fields alone', async () => {
    seedRecord(makeRecord({ tags: ['held'], head: 'Original head.' }))
    const { updateUndertakingFieldsOrch, getUndertakingOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await updateUndertakingFieldsOrch('F9', 'f9-und-micron', { section: 'f9-sec-ideas' })
    const { record } = (await getUndertakingOrch('F9', 'f9-und-micron'))!
    expect(record.tags).toEqual(['held'])
    expect(record.head).toBe('Original head.')
  })

  it('refuses an empty title rather than blanking it', async () => {
    seedRecord(makeRecord())
    const { updateUndertakingFieldsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(updateUndertakingFieldsOrch('F9', 'f9-und-micron', { title: '   ' })).rejects.toThrow(/empty/i)
  })
})

describe('section management', () => {
  it('creates a section with a slugged key and next sort order', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-ideas', sortOrder: 1 }))
    const { createSectionOrch, listManagedSectionsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    const { record } = await createSectionOrch('F9', '  Company Studies  ')
    expect(record.key).toBe('f9-sec-company-studies')
    expect(record.title).toBe('Company Studies')
    expect(record.sortOrder).toBe(2)

    const managed = await listManagedSectionsOrch('F9')
    expect(managed.map(m => m.title)).toContain('Company Studies')
  })

  it('de-duplicates a colliding section key', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-ideas', title: 'Ideas' }))
    const { createSectionOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const { record } = await createSectionOrch('F9', 'Ideas')
    expect(record.key).toBe('f9-sec-ideas-2')
  })

  it('renames a section', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-ideas', title: 'Ideas' }))
    const { renameSectionOrch, listManagedSectionsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await renameSectionOrch('F9', 'f9-sec-ideas', 'Theses')
    const managed = await listManagedSectionsOrch('F9')
    expect(managed.find(m => m.key === 'f9-sec-ideas')!.title).toBe('Theses')
  })

  it('reorders by renumbering sort_order', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-a', title: 'A', sortOrder: 1 }))
    seedSectionRecord(makeSection({ key: 'f9-sec-b', title: 'B', sortOrder: 2 }))
    const { reorderSectionOrch, listManagedSectionsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    await reorderSectionOrch('F9', 'f9-sec-b', 'up')
    const managed = await listManagedSectionsOrch('F9')
    expect(managed.map(m => m.key)).toEqual(['f9-sec-b', 'f9-sec-a'])
  })

  it('counts undertakings per section and blocks deleting a non-empty one', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-ideas' }))
    seedRecord(makeRecord({ key: 'u-1', section: 'f9-sec-ideas' }))
    const { deleteSectionOrch, listManagedSectionsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')

    expect((await listManagedSectionsOrch('F9')).find(m => m.key === 'f9-sec-ideas')!.count).toBe(1)
    await expect(deleteSectionOrch('F9', 'f9-sec-ideas')).rejects.toThrow(/move them first/i)
  })

  it('deletes an empty section', async () => {
    seedSectionRecord(makeSection({ key: 'f9-sec-empty', title: 'Empty' }))
    const { deleteSectionOrch, listManagedSectionsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await deleteSectionOrch('F9', 'f9-sec-empty')
    expect((await listManagedSectionsOrch('F9')).some(m => m.key === 'f9-sec-empty')).toBe(false)
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

/**
 * The `chain repair orchestrators` block that used to sit here is gone with the
 * thing it repaired.
 *
 * `chain.set_files` backfilled file pointers onto chains written before
 * extraction existed; pointers are now recomputed from the transcript on every
 * read, so there is no frozen copy left to backfill. `chain.set_project` moved a
 * chain file between project directories; the equivalent is
 * `setSessionProjectOrch`, covered where the session store is tested. Neither
 * capability's *purpose* was dropped — the class of staleness they existed to
 * repair was.
 */

describe('listChainsOrch', () => {
  it('bounds by date inclusively', async () => {
    seedChain(makeChain({ sessionId: 'c-1', date: '2026-06-01' }))
    seedChain(makeChain({ sessionId: 'c-2', date: '2026-06-02' }))
    seedChain(makeChain({ sessionId: 'c-3', date: '2026-06-03' }))

    const { listChainsOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const chains = await listChainsOrch({ projectId: 'F9', from: '2026-06-02', to: '2026-06-03' })

    // Newest sitting first — the order every surface renders in.
    expect(chains.map(c => c.chainKey)).toEqual(['F9::c-3', 'F9::c-2'])
  })

})

describe('getUndertakingIndexOrch', () => {
  it('groups by section in section order and buckets every strip over one shared window', async () => {
    seedSection('F9', 'sec-b', 'Execution', 2)
    seedSection('F9', 'sec-a', 'Company Studies', 1)
    // sec-a: one undertaking active early June. sec-b: one active late June.
    seedRecord(makeRecord({ key: 'u-a', section: 'sec-a', sortOrder: 1, chains: ['c-a'] }))
    seedRecord(makeRecord({ key: 'u-b', section: 'sec-b', sortOrder: 1, chains: ['c-b'] }))
    seedChain(makeChain({ sessionId: 'c-a', date: '2026-06-01', durationMs: 60_000, activeDurationMs: 60_000, startedIso: '2026-06-01T10:00:00.000Z' }))
    seedChain(makeChain({ sessionId: 'c-b', date: '2026-06-30', durationMs: 60_000, activeDurationMs: 60_000, startedIso: '2026-06-30T10:00:00.000Z' }))

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('F9', { buckets: 10 })

    // Section order follows sort_order, not insertion order.
    expect(index.sections.map(s => s.title)).toEqual(['Company Studies', 'Execution'])
    expect(index.windowStart).toBe('2026-06-01')
    expect(index.windowEnd).toBe('2026-06-30')

    // Both strips span the same window and the same bucket count, so they are
    // comparable: u-a's work is in the first bucket, u-b's in the last.
    const stripA = index.sections[0].rows[0].buckets
    const stripB = index.sections[1].rows[0].buckets
    expect(stripA).toHaveLength(10)
    expect(stripB).toHaveLength(10)
    expect(stripA[0].chains).toBe(1)
    expect(stripA[9].chains).toBe(0)
    expect(stripB[0].chains).toBe(0)
    expect(stripB[9].chains).toBe(1)
  })

  it('orders rows within a section by most recently worked, with never-worked last', async () => {
    seedSection('F9', 'sec-a', 'Company Studies', 1)
    // Seeded deliberately out of order, and with sortOrder that would disagree,
    // so a pass-through of insertion or sort_order would fail this.
    seedRecord(makeRecord({ key: 'u-old', section: 'sec-a', sortOrder: 1, chains: ['c-old'] }))
    seedRecord(makeRecord({ key: 'u-never', section: 'sec-a', sortOrder: 2, chains: [] }))
    seedRecord(makeRecord({ key: 'u-recent', section: 'sec-a', sortOrder: 3, chains: ['c-recent'] }))
    seedChain(makeChain({ sessionId: 'c-old', date: '2026-06-01', durationMs: 60_000, activeDurationMs: 60_000, startedIso: '2026-06-01T10:00:00.000Z' }))
    seedChain(makeChain({ sessionId: 'c-recent', date: '2026-06-30', durationMs: 60_000, activeDurationMs: 60_000, startedIso: '2026-06-30T10:00:00.000Z' }))

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('F9')

    expect(index.sections[0].rows.map(r => r.record.key)).toEqual(['u-recent', 'u-old', 'u-never'])
  })

  it('keeps an undertaking whose section the project does not declare, under Unfiled', async () => {
    seedSection('F9', 'sec-a', 'Company Studies', 1)
    seedRecord(makeRecord({ key: 'u-a', section: 'sec-a', chains: [] }))
    seedRecord(makeRecord({ key: 'u-orphan', section: 'sec-gone', chains: [] }))

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('F9')

    expect(index.sections.map(s => s.title)).toEqual(['Company Studies', 'sec-gone'])
    expect(index.sections[1].rows[0].record.key).toBe('u-orphan')
  })
})

describe('getOpenTasksOrch', () => {
  it('returns tasks no undertaking fed on, oldest first, case-insensitive on keys', () => {
    seedAsk('acceleration_core/F9', 'f9-qt-e-318', 'history of silicon chips?', '2026-03-17')
    seedAsk('acceleration_core/F9', 'f9-ic-e-499', 'learn more about LAM Research', '2026-03-01')
    seedAsk('acceleration_core/F9', 'f9-ide-e-800', 'wafer supply short', '2026-03-18')
    // An undertaking fed on the silicon-chips task (display-case key).
    seedRecord(makeRecord({ key: 'u-phys', fedBy: ['F9-QT-E-318'] }))

    return import('@/services/orchestrators/aiActivityUndertakingOrch').then(async m => {
      const result = await m.getOpenTasksOrch({ projectId: 'F9', projectRoot: 'acceleration_core/F9' })
      // f9-qt-e-318 was fed on → not open. The other two remain, oldest first.
      expect(result.open.map(a => a.key)).toEqual(['f9-ic-e-499', 'f9-ide-e-800'])
      expect(result.answeredCount).toBe(1)
      expect(result.totalTasks).toBe(3)
    })
  })

  it('returns everything open when nothing fed on', async () => {
    seedAsk('acceleration_core/F9', 'f9-mi-e-503', 'rare earths bottleneck', '2026-02-26')
    seedRecord(makeRecord({ key: 'u-x', fedBy: [] }))
    const { getOpenTasksOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await getOpenTasksOrch({ projectId: 'F9', projectRoot: 'acceleration_core/F9' })
    expect(result.open).toHaveLength(1)
    expect(result.answeredCount).toBe(0)
  })
})

describe('recordAssignmentOrch', () => {
  const SESSION = '3f3ea0fb-362b-4694-b744-cd5135c868d0'

  const readProposals = () =>
    (fakeFs.files.get('ai-activity/proposals/F9.jsonl') ?? '')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))

  it('writes a proposal into the one log, not a private parked file', async () => {
    // The whole point of the collapse: an in-session answer used to land in
    // `pending-assignments/`, which had a writer and no reader, so it reached
    // no queue, index or count. It is the same claim a sweep makes — only the
    // provenance differs — so it goes in the proposal log as `in-session`.
    seedRecord(makeRecord({ key: 'f9-und-micron' }))
    seedRecord(makeRecord({ uuid: 'u-2', key: 'f9-und-semiconductor-physics', title: 'Transistors' }))

    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await recordAssignmentOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-micron', 'f9-und-semiconductor-physics'],
      head: 'HBM capacity is the whole thesis.',
    })

    expect(result.path).toBe('ai-activity/proposals/F9.jsonl')
    expect(fakeFs.files.has('ai-activity/pending-assignments/' + SESSION + '.json')).toBe(false)

    const written = readProposals()
    expect(written).toHaveLength(2)
    expect(written.every(p => p.sessionId === SESSION && p.proposedBy === 'in-session')).toBe(true)
    // Confidence 1.0 is a statement about provenance, not permission to skip
    // the human — the queue still holds it for a verdict.
    expect(written.every(p => p.confidence === 1)).toBe(true)
    expect(written.map(p => p.target)).toEqual([
      { kind: 'existing', key: 'f9-und-micron' },
      { kind: 'existing', key: 'f9-und-semiconductor-physics' },
    ])
    // The head rides on the primary undertaking only, and on an `existing`
    // target — which a proposal could not carry before this change.
    expect(written[0].head).toBe('HBM capacity is the whole thesis.')
    expect(written[1].head).toBeUndefined()
  })

  it('refuses a key that names no undertaking, rather than minting from a typo', async () => {
    seedRecord(makeRecord({ key: 'f9-und-micron' }))
    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await recordAssignmentOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-micron', 'f9-und-mircon-typo'],
    })

    expect(result.written).toBe(1)
    expect(result.rejected).toEqual([
      {
        key: 'f9-und-mircon-typo',
        reason: 'no undertaking with this key in F9 — pass --newTitle to mint one, or fix the key',
      },
    ])
    expect(readProposals()).toHaveLength(1)
  })

  it('throws rather than half-recording when every key is refused', async () => {
    seedRecord(makeRecord({ key: 'f9-und-micron' }))
    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    await expect(
      recordAssignmentOrch({ sessionId: SESSION, projectId: 'F9', undertakings: ['nope'] }),
    ).rejects.toThrow(/Nothing recorded/)
    expect(fakeFs.files.has('ai-activity/proposals/F9.jsonl')).toBe(false)
  })

  it('mints only with a newTitle, and carries the resemblance to what already exists', async () => {
    // The guard the capability path never had: an agent mid-session cannot see
    // the 30 undertakings it might be duplicating. Advisory, never a block.
    seedRecord(makeRecord({ key: 'f9-und-the-cognition-tide', title: 'The Cognition Tide — AI and where value goes' }))
    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await recordAssignmentOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-cognition-tide-value'],
      newTitle: 'The Cognition Tide — where value actually goes',
      section: 'f9-sec-worldly-understanding',
      head: 'Value accrues to whoever holds the bottleneck.',
    })

    expect(result.similar).toEqual([
      { key: 'f9-und-the-cognition-tide', title: 'The Cognition Tide — AI and where value goes' },
    ])
    const [proposal] = readProposals()
    expect(proposal.target).toEqual({
      kind: 'new',
      title: 'The Cognition Tide — where value actually goes',
      section: 'f9-sec-worldly-understanding',
      head: 'Value accrues to whoever holds the bottleneck.',
    })
    // The resemblance travels with the claim, so it is on the row at the moment
    // the mint is being decided rather than in a log nobody reads.
    expect(proposal.similar).toEqual(result.similar)
  })

  it('previews without writing, and previews exactly what it would write', async () => {
    // The preview shares its resolution with the write on purpose: a dry run
    // computing its own answer would eventually reassure an agent about a
    // write that then behaved differently.
    seedRecord(makeRecord({ key: 'f9-und-micron' }))
    const { previewAssignmentRecordOrch, recordAssignmentOrch } = await import(
      '@/services/orchestrators/aiActivityUndertakingOrch'
    )
    const args = {
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-micron', 'f9-und-typo'],
    }

    const preview = await previewAssignmentRecordOrch(args)
    expect(preview.dryRun).toBe(true)
    expect(preview.written).toBe(1)
    expect(preview.rejected).toHaveLength(1)
    expect(preview.path).toBe('ai-activity/proposals/F9.jsonl')
    expect(fakeFs.files.has('ai-activity/proposals/F9.jsonl')).toBe(false)

    const real = await recordAssignmentOrch(args)
    expect(real.dryRun).toBe(false)
    expect(real.written).toBe(preview.written)
    expect(real.rejected).toEqual(preview.rejected)
  })

  it('reports which other sessions already fed the strand being joined', async () => {
    // The question an agent mid-session cannot answer for itself: am I adding
    // to the right strand? The head and a few recent sittings settle it.
    seedRecord(makeRecord({ key: 'f9-und-micron', head: 'HBM is the thesis.' }))
    seedChain(makeChain({ sessionId: 'c-1', title: 'Micron Q3 teardown', date: '2026-07-01', undertaking: ['f9-und-micron'] }))
    seedChain(makeChain({ sessionId: 'c-2', title: 'DRAM pricing check', date: '2026-08-02', undertaking: ['f9-und-micron'] }))
    seedChain(makeChain({ sessionId: 'c-3', title: 'Unrelated', date: '2026-08-03', undertaking: ['f9-und-other'] }))

    const { previewAssignmentRecordOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const preview = await previewAssignmentRecordOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-micron'],
    })

    expect(preview.context).toHaveLength(1)
    const [context] = preview.context
    expect(context.head).toBe('HBM is the thesis.')
    expect(context.sessionCount).toBe(2)
    // Newest first, so the most recognisable sitting is the one read first.
    expect(context.recentSessions.map(s => s.title)).toEqual(['DRAM pricing check', 'Micron Q3 teardown'])
  })

  it('does not count the asking session as context for itself', async () => {
    seedRecord(makeRecord({ key: 'f9-und-micron' }))
    seedChain(makeChain({ sessionId: SESSION, title: 'This very session', date: '2026-08-17', undertaking: ['f9-und-micron'] }))
    const { previewAssignmentRecordOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const preview = await previewAssignmentRecordOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['f9-und-micron'],
    })
    expect(preview.context[0].sessionCount).toBe(0)
  })

  it('reports no context for a mint, which by definition joins nothing', async () => {
    const { previewAssignmentRecordOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const preview = await previewAssignmentRecordOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['brand-new'],
      newTitle: 'A genuinely new strand',
    })
    expect(preview.context).toEqual([])
  })

  it('spends newTitle on one key only, since it describes one mint', async () => {
    const { recordAssignmentOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const result = await recordAssignmentOrch({
      sessionId: SESSION,
      projectId: 'F9',
      undertakings: ['brand-new-one', 'brand-new-two'],
      newTitle: 'Only one of these has a title',
    })
    expect(result.written).toBe(1)
    expect(result.rejected).toEqual([
      {
        key: 'brand-new-two',
        reason: 'newTitle describes only one new undertaking, and it is already spoken for',
      },
    ])
  })
})

describe('resolving a project to its authored records', () => {
  // The failure this guards is silent: nothing errors, the pane just renders no
  // task rows at all, which looks like "this project has none".
  const seedTaskFile = (root: string, dir: string, name: string, key: string, title: string) => {
    fakeFs.seed(
      `${root}/thinking-organizer/${dir}/${name}`,
      `---\nkey: ${key}\nrecord_kind: task\ntitle: ${title}\ncreated_at: '2026-03-01'\n---\n`,
    )
  }

  it('matches on the registry key, not the folder basename', async () => {
    // Thinking Space: records under `lifeblood_systems/thinkingspace.ai`,
    // chains under `Thinking-Space`. Basename matching found nothing and the
    // pane came up empty with nothing to say why. The registry key *is* the id
    // chains are filed under, so one comparison resolves it.
    registry = [{ project: 'Thinking-Space', paths: ['lifeblood_systems/thinkingspace.ai'] }]
    taskSources = { 'Thinking-Space': { dir: 'tasks', label: 'Tasks' } }
    seedTaskFile('lifeblood_systems/thinkingspace.ai', 'tasks', 'task-ts-1.md', 'ts-1', 'Live row')
    // The stale directory this project also carries must not be the one read.
    seedTaskFile('lifeblood_systems/thinkingspace.ai', 'epics', 'epic-dev-9.md', 'dev-9', 'Stale DEV item')

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('Thinking-Space')

    const titles = index.taskSections.flatMap(section => section.tasks.map(entry => entry.task.title))
    expect(titles).toEqual(['Live row'])
    // No kinds in this corpus, so one flat section named for the corpus.
    expect(index.taskSections.map(section => section.title)).toEqual(['Tasks'])
    expect(index.taskLabel).toBe('Tasks')
  })

  it('defaults to epics/ and "Tasks" for a project that configures neither', async () => {
    registry = [{ project: 'F9', paths: ['acceleration_core/F9'] }]
    seedTaskFile('acceleration_core/F9', 'epics', 'epic-f9-ide-e-1.md', 'f9-ide-e-1', 'MSFT is value')

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('F9')

    expect(index.taskSections.map(section => section.title)).toEqual(['Ideas'])
    expect(index.taskLabel).toBe('Tasks')
  })

  it("heads the authored half with the project's own word for it", async () => {
    // F9's records are Ideas, Questions to research, Key things. Heading that
    // half "Tasks" mislabels every row under it, so F9 names it itself.
    registry = [{ project: 'F9', paths: ['acceleration_core/F9'] }]
    taskSources = { F9: { dir: '', label: 'Thinking' } }
    seedTaskFile('acceleration_core/F9', 'epics', 'epic-f9-ide-e-1.md', 'f9-ide-e-1', 'MSFT is value')

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('F9')

    expect(index.taskLabel).toBe('Thinking')
    // The kind sections underneath are untouched — the label names the half.
    expect(index.taskSections.map(section => section.title)).toEqual(['Ideas'])
  })

  it('resolves nothing when the id is not a registered key', async () => {
    registry = [{ project: 'F9', paths: ['acceleration_core/F9'] }]
    seedTaskFile('acceleration_core/F9', 'epics', 'epic-f9-ide-e-1.md', 'f9-ide-e-1', 'MSFT is value')

    const { getUndertakingIndexOrch } = await import('@/services/orchestrators/aiActivityUndertakingOrch')
    const index = await getUndertakingIndexOrch('acceleration_core')

    expect(index.taskSections).toEqual([])
  })
})
