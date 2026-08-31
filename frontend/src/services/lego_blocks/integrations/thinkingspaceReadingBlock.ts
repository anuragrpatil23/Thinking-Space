// Durable store for in-app reading/drawing spans (TS markdown + Excalidraw).
//
// Layout — one file per local day per install:
//
//   ai-activity/raw-sessions/thinkingspace/reading/2026-08-30.a3f1c2.jsonl
//
// Two properties come out of that naming, and both matter:
//
//  1. **Appends touch one small file.** VaultFS has no atomic append, so every
//     append is read-modify-write. A single growing log means rewriting the
//     whole history into an iCloud-synced, *watched* directory every time a
//     document closes — the shape docs/contracts/ENERGY.md was written about
//     (`home-snapshot.json`). A day file holds a few dozen rows forever, and
//     yesterday's is never touched again.
//  2. **Two installs can never collide.** One shared file appended by a Mac
//     and an iPad on the same day is an iCloud conflict copy waiting to
//     happen, and the losing rows are simply gone. Disjoint filenames merge by
//     concatenation.
//
// The filename is also an index: the loader filters by date without opening
// anything, so a range query costs a directory listing.
//
// The legacy single `reading.jsonl` is deliberately NOT read. Its rows were
// wall-clock open-time, not measured attention, so counting them beside
// measured spans would silently mix two methods in one total. The file is left
// on disk untouched.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { getReadingInstallIdBlock } from '@/services/lego_blocks/units/storageKeyBlock'
import { getVaultWriteAiActivityAnyEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'
import {
  parseThinkingspaceReadingLog,
  type ThinkingspaceReadingRecord,
} from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const READING_DIR = 'ai-activity/raw-sessions/thinkingspace/reading'

/** `YYYY-MM-DD.<install>.jsonl` — nothing else in the folder is ours. */
const DAY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.[0-9a-f]{6,}\.jsonl$/

/** Local calendar date for a timestamp. Local rather than UTC because "what
 *  did I read today" is a question about the reader's day, not about UTC. */
export function readingDayKeyBlock(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayFilePath(dayKey: string, installId: string): string {
  return `${READING_DIR}/${dayKey}.${installId}.jsonl`
}

function parseLogText(text: string): ThinkingspaceReadingRecord[] {
  const out: ThinkingspaceReadingRecord[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as ThinkingspaceReadingRecord)
    } catch {
      // Skip a corrupt line rather than dropping the whole day.
    }
  }
  return out
}

function serializeLog(records: ThinkingspaceReadingRecord[]): string {
  if (records.length === 0) return ''
  return records.map(r => JSON.stringify(r)).join('\n') + '\n'
}

async function ensureReadingDir(fs: VaultFS): Promise<void> {
  // mkdir each segment progressively; ignore "already exists". Cheap, and
  // avoids assuming a recursive mkdir across the four VaultFS backends.
  const segments = READING_DIR.split('/')
  let prefix = ''
  for (const seg of segments) {
    prefix = prefix ? `${prefix}/${seg}` : seg
    try {
      if (!(await fs.exists(prefix))) await fs.mkdir(prefix)
    } catch {
      // Concurrent create or already-exists — fine.
    }
  }
}

// Appends are read-modify-write, so serialize them through a module-level
// promise chain. Two near-simultaneous document closes then can't clobber each
// other's line even when they land in the same day file.
let _writeChain: Promise<void> = Promise.resolve()

async function readDayFile(
  fs: VaultFS,
  path: string,
): Promise<{ text: string; records: ThinkingspaceReadingRecord[] }> {
  try {
    if (!(await fs.exists(path))) return { text: '', records: [] }
    const text = await fs.read(path)
    return { text, records: parseLogText(text) }
  } catch {
    return { text: '', records: [] }
  }
}

/**
 * Append one reading span, deduped by key within its day file (idempotent —
 * a repeated emit for the same sitting is a no-op).
 *
 * Gated on the general `ai-activity/` write permission, the same gate manual
 * sessions ride: a reading span is first-party authored durable data living in
 * that folder, so it follows the folder's permission rather than the
 * digests-mirror opt-in specifically.
 *
 * Best-effort: swallows all errors so a logging failure never disrupts the
 * viewer. Returns false when the gate is off, so callers can tell "not
 * allowed" from "wrote nothing".
 */
export async function appendReadingSpan(
  fs: VaultFS,
  record: ThinkingspaceReadingRecord,
): Promise<boolean> {
  if (!(await getVaultWriteAiActivityAnyEnabled())) return false
  const path = dayFilePath(readingDayKeyBlock(record.startMs), getReadingInstallIdBlock())
  _writeChain = _writeChain.then(async () => {
    try {
      const { text, records } = await readDayFile(fs, path)
      if (records.some(r => r.key === record.key)) return
      if (!text) await ensureReadingDir(fs)
      const line = JSON.stringify(record)
      const next = text && !text.endsWith('\n') ? `${text}\n${line}\n` : `${text}${line}\n`
      await fs.write(path, next)
    } catch {
      // Logging is best-effort; never throw into the caller.
    }
  })
  await _writeChain
  return true
}

/** Same-doc rows overlapping an edited window with this much grace on each
 *  side get absorbed, so hand-correcting one sitting doesn't leave fragments
 *  of the same sitting beside it. */
const ABSORB_GRACE_MS = 5 * 60_000

/**
 * Hand-correct one span: set its window and pages, mark it `declared` (a
 * person is now asserting these numbers, and the record must say so), then
 * absorb same-doc rows overlapping the edited window.
 *
 * Scoped to the span's own day file. A sitting and its fragments are on the
 * same local day by construction, so a whole-history scan would buy nothing.
 * Serialized through the same chain as the append path.
 */
export async function editThinkingspaceReadingRecord(
  fs: VaultFS,
  input: { key: string; startMs: number; endMs: number; pages: number },
): Promise<{ ok: boolean; absorbed: number; total: number }> {
  let result = { ok: false, absorbed: 0, total: 0 }
  if (!(await getVaultWriteAiActivityAnyEnabled())) return result
  const installId = getReadingInstallIdBlock()
  _writeChain = _writeChain.then(async () => {
    try {
      if (
        !Number.isFinite(input.startMs)
        || !Number.isFinite(input.endMs)
        || input.endMs - input.startMs < 60_000
      ) return

      // The row may predate the edit's new day (someone can drag a sitting
      // across midnight), so locate it by its own startMs, not the edited one.
      const dayKey = readingDayKeyBlock(input.startMs)
      const path = dayFilePath(dayKey, installId)
      const { records } = await readDayFile(fs, path)
      const idx = records.findIndex(r => r.key === input.key)
      if (idx === -1) return
      const target = records[idx]

      const updated: ThinkingspaceReadingRecord = {
        ...target,
        method: 'declared',
        startMs: input.startMs,
        endMs: input.endMs,
        activeMs: input.endMs - input.startMs,
        pages: Math.max(1, Math.round(input.pages) || 1),
      }

      const absorbStart = updated.startMs - ABSORB_GRACE_MS
      const absorbEnd = updated.endMs + ABSORB_GRACE_MS
      const survivors: ThinkingspaceReadingRecord[] = []
      let absorbed = 0
      for (let i = 0; i < records.length; i += 1) {
        if (i === idx) continue
        const r = records[i]
        const sameDoc = r.source === updated.source && r.filePath === updated.filePath
        if (sameDoc && r.startMs <= absorbEnd && r.endMs >= absorbStart) {
          absorbed += 1
          continue
        }
        survivors.push(r)
      }
      survivors.splice(Math.min(idx, survivors.length), 0, updated)

      await fs.write(path, serializeLog(survivors))
      result = { ok: true, absorbed, total: survivors.length }
    } catch {
      // Best-effort; leave result with ok:false.
    }
  })
  await _writeChain
  return result
}

export interface LoadReadingSpansOptions {
  /** Skip day files whose date is before this instant. Filtering happens on
   *  the filename, so excluded days are never opened. */
  sinceMs?: number
}

/**
 * Load in-app reading/drawing spans. Returns [] when nothing has been logged.
 *
 * Reads every install's file for each day in range — a vault synced across a
 * Mac and an iPad has two per day, and both are ours.
 */
export async function loadThinkingspaceReadingSessions(
  fs: VaultFS,
  options: LoadReadingSpansOptions = {},
): Promise<ParsedSession[]> {
  try {
    if (!(await fs.exists(READING_DIR))) return []
    const listed = await fs.list(READING_DIR)
    const sinceDayKey = options.sinceMs !== undefined
      ? readingDayKeyBlock(options.sinceMs)
      : null

    const names = listed.files.filter(name => {
      const match = DAY_FILE_PATTERN.exec(name)
      if (!match) return false
      return sinceDayKey === null || match[1] >= sinceDayKey
    })
    if (names.length === 0) return []

    const texts = await Promise.all(
      names.map(name => fs.read(`${READING_DIR}/${name}`).catch(() => '')),
    )
    const records: ThinkingspaceReadingRecord[] = []
    for (const text of texts) records.push(...parseLogText(text))
    return parseThinkingspaceReadingLog(records)
  } catch {
    return []
  }
}
