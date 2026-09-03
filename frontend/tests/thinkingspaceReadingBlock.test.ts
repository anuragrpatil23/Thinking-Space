import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ThinkingspaceReadingRecord } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

// The write gate lives in main-process persistence; allow writes by default and
// let one test deny them.
let writesAllowed = true
vi.mock('@/services/lego_blocks/units/vaultWritePrefsBlock', () => ({
  getVaultWriteAiActivityAnyEnabled: async () => writesAllowed,
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
})

const files = new Map<string, string>()
const dirs = new Set<string>()

const fakeVaultFS = {
  async write(path: string, data: string) { files.set(path, data) },
  async read(path: string) {
    const v = files.get(path)
    if (v === undefined) throw new Error(`missing: ${path}`)
    return v
  },
  async exists(path: string) { return files.has(path) || dirs.has(path) },
  async mkdir(path: string) { dirs.add(path) },
  async list(path: string) {
    const prefix = `${path}/`
    const names: string[] = []
    for (const key of files.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        names.push(key.slice(prefix.length))
      }
    }
    return { files: names, folders: [] }
  },
} as unknown as VaultFS

const {
  appendReadingSpan,
  editThinkingspaceReadingRecord,
  loadThinkingspaceReadingSessions,
  readingDayKeyBlock,
  resetReadingDayCacheBlock,
} = await import('@/services/lego_blocks/integrations/thinkingspaceReadingBlock')

const DIR = 'ai-activity/raw-sessions/thinkingspace/reading'

/** Local noon, so the day key is unambiguous whatever the runner's timezone. */
function localNoon(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime()
}

function span(startMs: number, overrides: Partial<ThinkingspaceReadingRecord> = {}): ThinkingspaceReadingRecord {
  const source = overrides.source ?? 'reading-md'
  const filePath = overrides.filePath ?? 'notes/foo.md'
  return {
    key: `${source}|${filePath}|${startMs}`,
    source,
    filePath,
    title: 'foo',
    method: 'measured',
    startMs,
    endMs: startMs + 40 * 60_000,
    activeMs: 25 * 60_000,
    recordedAt: startMs + 40 * 60_000,
    ...overrides,
  }
}

function installedFileNames(): string[] {
  return [...files.keys()].filter(k => k.startsWith(`${DIR}/`)).map(k => k.slice(DIR.length + 1))
}

describe('thinkingspaceReadingBlock', () => {
  beforeEach(() => {
    files.clear()
    dirs.clear()
    store.clear()
    resetReadingDayCacheBlock()
    writesAllowed = true
  })

  it('files a span under its own local day', async () => {
    const start = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(start))
    const names = installedFileNames()
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^2026-08-30\.[0-9a-f]{6}\.jsonl$/)
  })

  // The whole reason for per-day files: yesterday's is never rewritten, so a
  // day's cost is its own rows rather than all of history.
  it('never touches a sealed day when appending to a new one', async () => {
    const day1 = localNoon(2026, 8, 29)
    const day2 = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(day1))
    const sealedName = installedFileNames()[0]
    const sealed = files.get(`${DIR}/${sealedName}`)

    await appendReadingSpan(fakeVaultFS, span(day2))
    expect(installedFileNames()).toHaveLength(2)
    expect(files.get(`${DIR}/${sealedName}`)).toBe(sealed)
  })

  it('appends multiple sittings of the same day to one file', async () => {
    const start = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(start))
    await appendReadingSpan(fakeVaultFS, span(start + 3 * 3_600_000, { filePath: 'notes/bar.md' }))
    expect(installedFileNames()).toHaveLength(1)
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS)
    expect(sessions).toHaveLength(2)
  })

  it('is idempotent for a repeated emit of the same sitting', async () => {
    const start = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(start))
    await appendReadingSpan(fakeVaultFS, span(start))
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS)
    expect(sessions).toHaveLength(1)
  })

  it('refuses to write when the ai-activity gate is off', async () => {
    writesAllowed = false
    const ok = await appendReadingSpan(fakeVaultFS, span(localNoon(2026, 8, 30)))
    expect(ok).toBe(false)
    expect(installedFileNames()).toHaveLength(0)
  })

  it('reads every install’s file for a day', async () => {
    const start = localNoon(2026, 8, 30)
    const dayKey = readingDayKeyBlock(start)
    // A second install's file, as iCloud would have delivered it.
    files.set(
      `${DIR}/${dayKey}.beef01.jsonl`,
      JSON.stringify(span(start + 60_000, { filePath: 'notes/ipad.md' })) + '\n',
    )
    await appendReadingSpan(fakeVaultFS, span(start))
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS)
    expect(sessions).toHaveLength(2)
    // Topic is the document; project is now resolved from the path (see
    // thinkingspaceReadingProject.test.ts), so it is deliberately not the title.
    expect(sessions.map(s => s.topic).sort()).toEqual(['foo', 'foo'])
  })

  it('filters by day on the filename without opening excluded files', async () => {
    const old = localNoon(2026, 1, 5)
    const recent = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(old))
    await appendReadingSpan(fakeVaultFS, span(recent))

    const oldName = installedFileNames().find(n => n.startsWith('2026-01-05'))!
    const readSpy = vi.spyOn(fakeVaultFS, 'read')
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS, { sinceMs: localNoon(2026, 6, 1) })
    expect(sessions).toHaveLength(1)
    expect(readSpy.mock.calls.some(c => String(c[0]).includes(oldName))).toBe(false)
    readSpy.mockRestore()
  })

  it('ignores foreign files in the reading directory', async () => {
    files.set(`${DIR}/notes.txt`, 'not ours\n')
    files.set(`${DIR}/2026-08-30.jsonl`, 'no install id\n')
    await appendReadingSpan(fakeVaultFS, span(localNoon(2026, 8, 30)))
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS)
    expect(sessions).toHaveLength(1)
  })

  it('survives a corrupt line without losing the rest of the day', async () => {
    const start = localNoon(2026, 8, 30)
    await appendReadingSpan(fakeVaultFS, span(start))
    const name = installedFileNames()[0]
    files.set(`${DIR}/${name}`, `{ not json\n${files.get(`${DIR}/${name}`)}`)
    const sessions = await loadThinkingspaceReadingSessions(fakeVaultFS)
    expect(sessions).toHaveLength(1)
  })

  it('returns [] when nothing has ever been logged', async () => {
    expect(await loadThinkingspaceReadingSessions(fakeVaultFS)).toEqual([])
  })

  describe('editing', () => {
    it('marks a hand-corrected span declared and rewrites its duration', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: start,
        endMs: start + 90 * 60_000,
        pages: 12,
      })
      expect(result.ok).toBe(true)

      const name = installedFileNames()[0]
      const rec = JSON.parse(files.get(`${DIR}/${name}`)!.trim()) as ThinkingspaceReadingRecord
      expect(rec.method).toBe('declared')
      expect(rec.activeMs).toBe(90 * 60_000)
      expect(rec.pages).toBe(12)
    })

    it('absorbs same-doc fragments overlapping the edited window', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      await appendReadingSpan(fakeVaultFS, span(start + 45 * 60_000))
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: start,
        endMs: start + 60 * 60_000,
        pages: 1,
      })
      expect(result.absorbed).toBe(1)
      expect(result.total).toBe(1)
    })

    it('leaves a different document alone', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      await appendReadingSpan(fakeVaultFS, span(start + 10 * 60_000, { filePath: 'notes/bar.md' }))
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: start,
        endMs: start + 60 * 60_000,
        pages: 1,
      })
      expect(result.absorbed).toBe(0)
      expect(result.total).toBe(2)
    })

    it('rejects a window shorter than a minute', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: start,
        endMs: start + 10_000,
        pages: 1,
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('merging a repeated emit', () => {
    // The hide-flush writes an in-progress span so quitting cannot lose it;
    // the real close re-emits the same key with more attention on it. Keeping
    // the first would permanently record the flush's shorter number.
    it('upgrades a flushed span when the sitting really ends', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start, { activeMs: 3 * 60_000 }))
      await appendReadingSpan(fakeVaultFS, span(start, { activeMs: 20 * 60_000 }))
      const name = installedFileNames()[0]
      const rows = files.get(`${DIR}/${name}`)!.trim().split('\n').map(l => JSON.parse(l))
      expect(rows).toHaveLength(1)
      expect(rows[0].activeMs).toBe(20 * 60_000)
    })

    it('never lets a later emit shrink a span', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start, { activeMs: 20 * 60_000 }))
      await appendReadingSpan(fakeVaultFS, span(start, { activeMs: 3 * 60_000 }))
      const name = installedFileNames()[0]
      const rec = JSON.parse(files.get(`${DIR}/${name}`)!.trim())
      expect(rec.activeMs).toBe(20 * 60_000)
    })

    // A person correcting a number outranks any later automatic emit.
    it('never stomps a declared span with a measured one', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: start,
        endMs: start + 90 * 60_000,
        pages: 3,
      })
      await appendReadingSpan(fakeVaultFS, span(start, { activeMs: 10 * 3_600_000 }))
      const name = installedFileNames()[0]
      const rec = JSON.parse(files.get(`${DIR}/${name}`)!.trim())
      expect(rec.method).toBe('declared')
      expect(rec.activeMs).toBe(90 * 60_000)
    })
  })

  describe('identity', () => {
    it('carries a document uuid through to the record', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start, { uuid: 'abc-123' }))
      const name = installedFileNames()[0]
      expect(JSON.parse(files.get(`${DIR}/${name}`)!.trim()).uuid).toBe('abc-123')
    })

    it('finds the filed day from the key even when a path contains a pipe', async () => {
      const start = localNoon(2026, 8, 30)
      const filePath = 'notes/a|b.md'
      await appendReadingSpan(fakeVaultFS, span(start, { filePath }))
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|${filePath}|${start}`,
        startMs: start,
        endMs: start + 70 * 60_000,
        pages: 1,
      })
      expect(result.ok).toBe(true)
    })

    // Dragging a sitting back across midnight changes the edited startMs while
    // the record stays filed under the day it was recorded on. Looking in the
    // new day's file would find nothing and silently no-op.
    it('edits a span dragged backwards across midnight', async () => {
      const start = localNoon(2026, 8, 30)
      await appendReadingSpan(fakeVaultFS, span(start))
      const movedTo = new Date(2026, 7, 29, 23, 30, 0, 0).getTime()
      const result = await editThinkingspaceReadingRecord(fakeVaultFS, {
        key: `reading-md|notes/foo.md|${start}`,
        startMs: movedTo,
        endMs: movedTo + 80 * 60_000,
        pages: 1,
      })
      expect(result.ok).toBe(true)
      const name = installedFileNames()[0]
      expect(name).toMatch(/^2026-08-30\./)
      const rec = JSON.parse(files.get(`${DIR}/${name}`)!.trim())
      expect(rec.startMs).toBe(movedTo)
    })
  })
})
