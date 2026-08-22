// Recovery journal — the storage half. See docs/contracts/DURABILITY.md.
//
// Two tiers, chosen for what each survives rather than for redundancy:
//
//  Hot     localStorage, synchronous. The only store writable from `pagehide`
//          and `beforeunload`, which do not await async work. Survives a crash
//          or force-quit. Dies with an app reinstall.
//  Durable A plain markdown file in the vault. Survives reinstall, machine
//          migration, and the app never booting again. Also the only tier in a
//          *different failure domain* from... no — it is the same domain as the
//          note file, which is exactly why the hot tier is not redundant with
//          it: when the vault write is what failed, localStorage still holds
//          the text.
//
// Neither tier is gated on auto-save. Auto-save controls publication; the
// journal controls durability.

import { getVaultFS } from './fsBlock'
import {
  DRAFT_JOURNAL_DIR_BLOCK,
  DRAFT_JOURNAL_HOT_KEY_BLOCK,
  draftFilePathBlock,
  parseNoteDraftBlock,
  serializeNoteDraftBlock,
  type NoteDraftEntryBlock,
} from '../units/noteDraftJournalBlock'

// ── Hot tier ──

/** Synchronous by contract. Every caller on the teardown path depends on this
 *  returning after the bytes are in localStorage, not after a microtask. */
export function writeHotDraftBlock(entry: NoteDraftEntryBlock): boolean {
  try {
    const all = readHotDraftsBlock()
    const next = all.filter(candidate => candidate.id !== entry.id)
    next.push(entry)
    localStorage.setItem(DRAFT_JOURNAL_HOT_KEY_BLOCK, JSON.stringify(next))
    return true
  } catch {
    // A full or unavailable localStorage must not break typing, so this never
    // throws. It does *report*, because the transition chokepoint has to know
    // whether a copy of the text actually exists before it lets anything clear
    // the buffer.
    return false
  }
}

export function readHotDraftsBlock(): NoteDraftEntryBlock[] {
  try {
    const raw = localStorage.getItem(DRAFT_JOURNAL_HOT_KEY_BLOCK)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDraftEntryBlock)
  } catch {
    return []
  }
}

export function clearHotDraftBlock(id: string): void {
  try {
    const next = readHotDraftsBlock().filter(entry => entry.id !== id)
    if (next.length === 0) localStorage.removeItem(DRAFT_JOURNAL_HOT_KEY_BLOCK)
    else localStorage.setItem(DRAFT_JOURNAL_HOT_KEY_BLOCK, JSON.stringify(next))
  } catch {
    // See above.
  }
}

function isDraftEntryBlock(value: unknown): value is NoteDraftEntryBlock {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NoteDraftEntryBlock>
  return typeof candidate.id === 'string'
    && typeof candidate.content === 'string'
    && typeof candidate.updatedAt === 'string'
}

// ── Durable tier ──

export async function writeDurableDraftBlock(entry: NoteDraftEntryBlock): Promise<boolean> {
  try {
    const fs = getVaultFS()
    await fs.mkdir(DRAFT_JOURNAL_DIR_BLOCK).catch(() => {})
    await fs.write(draftFilePathBlock(entry.id), serializeNoteDraftBlock(entry))
    return true
  } catch {
    // Same contract as the hot tier: never throw at a person mid-sentence,
    // always report.
    return false
  }
}

export async function clearDurableDraftBlock(id: string): Promise<void> {
  try {
    await getVaultFS().delete(draftFilePathBlock(id))
  } catch {
    // Already gone, or the vault is unavailable. Either way there is nothing
    // to recover from a failure to *delete* a draft.
  }
}

export async function listDurableDraftsBlock(): Promise<NoteDraftEntryBlock[]> {
  const fs = getVaultFS()
  let names: string[]
  try {
    names = (await fs.list(DRAFT_JOURNAL_DIR_BLOCK)).files
  } catch {
    // No drafts folder yet is the normal case, not an error.
    return []
  }
  const out: NoteDraftEntryBlock[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    try {
      const text = await fs.read(`${DRAFT_JOURNAL_DIR_BLOCK}/${name}`)
      const entry = parseNoteDraftBlock(text)
      // `null` means the file is not one of ours. The drafts folder lives in
      // the user's vault, so anything could be in there, and offering to
      // "recover" a real note over itself would be its own kind of loss.
      if (entry) out.push(entry)
    } catch {
      // Unreadable file — skip it rather than failing the whole sweep.
    }
  }
  return out
}

/** Forget a draft in both tiers. Called only once a save's read-back has
 *  confirmed the text is at its target. */
export async function resolveDraftBlock(id: string): Promise<void> {
  clearHotDraftBlock(id)
  await clearDurableDraftBlock(id)
}

/** Every draft known to either tier, hot winning on id collision because it is
 *  written more often and is therefore never staler than its durable twin. */
export async function readAllDraftsBlock(): Promise<NoteDraftEntryBlock[]> {
  const durable = await listDurableDraftsBlock()
  const byId = new Map<string, NoteDraftEntryBlock>()
  for (const entry of durable) byId.set(entry.id, entry)
  for (const entry of readHotDraftsBlock()) byId.set(entry.id, entry)
  return [...byId.values()]
}
