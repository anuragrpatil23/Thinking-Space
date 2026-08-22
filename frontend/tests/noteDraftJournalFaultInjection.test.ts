// Fault injection for the recovery journal. See docs/contracts/DURABILITY.md.
//
// The contract's invariant, asserted at every failure point:
//
//   After an abort at any step, the union of (note files + journal) contains
//   every character the user typed.
//
// The two tiers are not redundant — they fail in different places. The hot tier
// dies with an app reinstall; the durable tier dies when the vault is the thing
// that is unavailable, which is precisely when a save has just failed. So each
// test below kills one and checks the text is still reachable.

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  DRAFT_JOURNAL_DIR_BLOCK,
  draftFilePathBlock,
  isDraftCoveredByDiskBlock,
  unresolvedDraftsBlock,
  type NoteDraftEntryBlock,
} from '@/services/lego_blocks/units/noteDraftJournalBlock'

// ── A vault that can be told to fail ──
const files = new Map<string, string>()
let vaultFails = false

const fakeVaultFS = {
  async write(path: string, data: string) {
    if (vaultFails) throw new Error('vault unavailable')
    files.set(path, data)
  },
  async read(path: string) {
    if (vaultFails) throw new Error('vault unavailable')
    const value = files.get(path)
    if (value === undefined) throw new Error(`missing: ${path}`)
    return value
  },
  async exists(path: string) {
    if (vaultFails) throw new Error('vault unavailable')
    return files.has(path)
  },
  async mkdir() { if (vaultFails) throw new Error('vault unavailable') },
  async delete(path: string) {
    if (vaultFails) throw new Error('vault unavailable')
    files.delete(path)
  },
  async list(dir: string) {
    if (vaultFails) throw new Error('vault unavailable')
    const prefix = `${dir}/`
    return {
      files: [...files.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length)),
      folders: [],
    }
  },
}

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => fakeVaultFS,
}))

// ── A localStorage that can be told to fail ──
let storageFails = false
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (storageFails) throw new Error('QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => { store.delete(k) },
})

const {
  writeHotDraftBlock,
  readHotDraftsBlock,
  writeDurableDraftBlock,
  listDurableDraftsBlock,
  readAllDraftsBlock,
  resolveDraftBlock,
} = await import('@/services/lego_blocks/integrations/noteDraftJournalStoreBlock')

const TYPED = 'the paragraph the user actually typed'
const entry: NoteDraftEntryBlock = {
  id: 'draft-1',
  targetPath: 'thoughts/2026-08-22.md',
  content: TYPED,
  updatedAt: '2026-08-22T10:00:00.000Z',
  createdTarget: true,
}

/** The invariant, as a function. */
async function textIsReachable(text: string): Promise<boolean> {
  const drafts = await readAllDraftsBlock().catch(() => [])
  if (drafts.some(d => d.content.includes(text))) return true
  for (const content of files.values()) {
    if (content.includes(text)) return true
  }
  return false
}

beforeEach(() => {
  files.clear()
  store.clear()
  vaultFails = false
  storageFails = false
})

describe('the text survives a failure in either tier', () => {
  it('keeps it when the vault is unavailable', async () => {
    vaultFails = true
    expect(writeHotDraftBlock(entry)).toBe(true)
    expect(await writeDurableDraftBlock(entry)).toBe(false)

    vaultFails = false
    expect(readHotDraftsBlock()[0]?.content).toBe(TYPED)
    expect(await textIsReachable(TYPED)).toBe(true)
  })

  it('keeps it when localStorage is full', async () => {
    storageFails = true
    expect(writeHotDraftBlock(entry)).toBe(false)
    expect(await writeDurableDraftBlock(entry)).toBe(true)

    expect((await listDurableDraftsBlock())[0]?.content).toBe(TYPED)
    expect(await textIsReachable(TYPED)).toBe(true)
  })

  // Both gone is the one case the chokepoint refuses to transition on, because
  // it is the only one where the buffer really is the only copy.
  it('reports honestly when both tiers fail', async () => {
    vaultFails = true
    storageFails = true
    const hotOk = writeHotDraftBlock(entry)
    const durableOk = await writeDurableDraftBlock(entry)
    expect(hotOk || durableOk).toBe(false)
  })

  it('never throws at a person mid-sentence, whatever fails', async () => {
    vaultFails = true
    storageFails = true
    expect(() => writeHotDraftBlock(entry)).not.toThrow()
    await expect(writeDurableDraftBlock(entry)).resolves.toBe(false)
    await expect(resolveDraftBlock(entry.id)).resolves.toBeUndefined()
  })
})

describe('abort at each step of a save', () => {
  it('offers the draft when nothing reached the target', async () => {
    await writeDurableDraftBlock(entry)
    writeHotDraftBlock(entry)
    // Crash before any note file was written.
    const drafts = await readAllDraftsBlock()
    const disk = new Map<string, string | null>([[entry.targetPath!, null]])
    expect(unresolvedDraftsBlock(drafts, disk).map(d => d.id)).toEqual(['draft-1'])
    expect(await textIsReachable(TYPED)).toBe(true)
  })

  it('offers the draft when the target landed only partially', async () => {
    await writeDurableDraftBlock(entry)
    const drafts = await readAllDraftsBlock()
    const disk = new Map<string, string | null>([
      [entry.targetPath!, '---\ntitle: "x"\n---\n\nthe paragraph the user'],
    ])
    expect(unresolvedDraftsBlock(drafts, disk)).toHaveLength(1)
  })

  it('stops offering once the text is fully at the target', async () => {
    await writeDurableDraftBlock(entry)
    const drafts = await readAllDraftsBlock()
    const disk = new Map<string, string | null>([
      [entry.targetPath!, `---\ntitle: "x"\n---\n\n${TYPED}\n`],
    ])
    expect(unresolvedDraftsBlock(drafts, disk)).toEqual([])
  })
})

describe('resolution clears both tiers, and only after the text landed', () => {
  it('clears both', async () => {
    writeHotDraftBlock(entry)
    await writeDurableDraftBlock(entry)
    expect(files.has(draftFilePathBlock(entry.id))).toBe(true)

    await resolveDraftBlock(entry.id)

    expect(readHotDraftsBlock()).toEqual([])
    expect(files.has(draftFilePathBlock(entry.id))).toBe(false)
  })

  it('leaves other drafts alone', async () => {
    writeHotDraftBlock(entry)
    writeHotDraftBlock({ ...entry, id: 'draft-2', content: 'a different note' })
    await resolveDraftBlock('draft-1')
    expect(readHotDraftsBlock().map(d => d.id)).toEqual(['draft-2'])
  })

  it('hot tier wins over a staler durable twin', async () => {
    await writeDurableDraftBlock({ ...entry, content: 'older text' })
    writeHotDraftBlock({ ...entry, content: 'newer text' })
    const all = await readAllDraftsBlock()
    expect(all).toHaveLength(1)
    expect(all[0].content).toBe('newer text')
  })
})

describe('the drafts folder is in the user vault', () => {
  it('ignores files that are not drafts', async () => {
    files.set(`${DRAFT_JOURNAL_DIR_BLOCK}/a-real-note.md`, '# Not a draft\n\nreal content')
    await writeDurableDraftBlock(entry)
    const drafts = await listDurableDraftsBlock()
    // Offering to "recover" a real note over itself is its own kind of loss.
    expect(drafts.map(d => d.id)).toEqual(['draft-1'])
  })
})

describe('isDraftCoveredByDiskBlock is the gate on all of this', () => {
  it('errs toward keeping the draft', () => {
    expect(isDraftCoveredByDiskBlock(TYPED, null)).toBe(false)
    expect(isDraftCoveredByDiskBlock(TYPED, '')).toBe(false)
    expect(isDraftCoveredByDiskBlock(TYPED, TYPED.slice(0, -5))).toBe(false)
  })
})
