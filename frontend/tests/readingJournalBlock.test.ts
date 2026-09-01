import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ThinkingspaceReadingRecord } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const store = new Map<string, string>()
let storeFails = false
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (storeFails) throw new Error('QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => { store.delete(k) },
})

const {
  checkpointReadingJournalBlock,
  clearReadingJournalBlock,
  clearReadingJournalEntryBlock,
  readReadingJournalBlock,
} = await import('@/services/lego_blocks/units/readingJournalBlock')

function span(startMs: number, over: Partial<ThinkingspaceReadingRecord> = {}): ThinkingspaceReadingRecord {
  const filePath = over.filePath ?? 'notes/foo.md'
  return {
    key: `reading-md|${filePath}|${startMs}`,
    source: 'reading-md',
    filePath,
    title: 'foo',
    method: 'measured',
    startMs,
    endMs: startMs + 60_000,
    activeMs: 60_000,
    recordedAt: startMs + 60_000,
    ...over,
  }
}

describe('readingJournalBlock', () => {
  beforeEach(() => { store.clear(); storeFails = false })

  it('holds a checkpointed span', () => {
    checkpointReadingJournalBlock(span(1000))
    expect(readReadingJournalBlock()).toHaveLength(1)
  })

  // The whole point: the same sitting checkpointed repeatedly is one entry
  // that grows, not a pile of partial duplicates.
  it('overwrites the same sitting rather than accumulating it', () => {
    checkpointReadingJournalBlock(span(1000, { activeMs: 60_000 }))
    checkpointReadingJournalBlock(span(1000, { activeMs: 120_000 }))
    checkpointReadingJournalBlock(span(1000, { activeMs: 900_000 }))
    const entries = readReadingJournalBlock()
    expect(entries).toHaveLength(1)
    expect(entries[0].activeMs).toBe(900_000)
  })

  it('keeps separate sittings apart', () => {
    checkpointReadingJournalBlock(span(1000))
    checkpointReadingJournalBlock(span(2000, { filePath: 'notes/bar.md' }))
    expect(readReadingJournalBlock()).toHaveLength(2)
  })

  it('forgets an entry once the vault has it', () => {
    const s = span(1000)
    checkpointReadingJournalBlock(s)
    clearReadingJournalEntryBlock(s.key)
    expect(readReadingJournalBlock()).toHaveLength(0)
  })

  it('survives a restart — entries outlive the module, not the store', () => {
    checkpointReadingJournalBlock(span(1000, { activeMs: 2_700_000 }))
    // A "restart" is just reading the same backing store again.
    const recovered = readReadingJournalBlock()
    expect(recovered[0].activeMs).toBe(2_700_000)
    expect(recovered[0].filePath).toBe('notes/foo.md')
  })

  it('returns entries oldest first so a drain replays in order', () => {
    checkpointReadingJournalBlock(span(3000, { filePath: 'c.md' }))
    checkpointReadingJournalBlock(span(1000, { filePath: 'a.md' }))
    checkpointReadingJournalBlock(span(2000, { filePath: 'b.md' }))
    expect(readReadingJournalBlock().map(r => r.filePath)).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('drops the oldest rather than growing past the cap', () => {
    for (let i = 0; i < 45; i += 1) {
      checkpointReadingJournalBlock(span(1000 + i, { filePath: `n${i}.md` }))
    }
    const entries = readReadingJournalBlock()
    expect(entries).toHaveLength(40)
    expect(entries[0].filePath).toBe('n5.md')
  })

  it('ignores a corrupt store instead of throwing into the reader', () => {
    store.set('ltm-reading-journal', '{ not json')
    expect(readReadingJournalBlock()).toEqual([])
  })

  it('drops entries that are not usable spans', () => {
    store.set('ltm-reading-journal', JSON.stringify({ a: { key: 'a' }, b: span(1000) }))
    expect(readReadingJournalBlock()).toHaveLength(1)
  })

  // A full quota must not break reading — it only costs the safety net.
  it('does not throw when the store refuses a write', () => {
    storeFails = true
    expect(() => checkpointReadingJournalBlock(span(1000))).not.toThrow()
  })

  it('clears wholesale', () => {
    checkpointReadingJournalBlock(span(1000))
    clearReadingJournalBlock()
    expect(readReadingJournalBlock()).toEqual([])
  })
})
