// Durable store + loader for in-app reading/drawing sessions (TS markdown +
// Excalidraw). The markdown/excalidraw viewers call appendReadingSession once a
// sitting crosses the dwell threshold; the AI activity pipeline reads the log
// back via loadThinkingspaceReadingSessions. The log lives in the vault and
// syncs, so iPhone/web see the same sessions.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  parseThinkingspaceReadingLog,
  type ThinkingspaceReadingRecord,
} from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const READING_DIR = 'ai-activity/raw-sessions/thinkingspace'
const READING_LOG_PATH = `${READING_DIR}/reading.jsonl`

function parseLogText(text: string): ThinkingspaceReadingRecord[] {
  const out: ThinkingspaceReadingRecord[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as ThinkingspaceReadingRecord)
    } catch {
      // Skip a corrupt line rather than dropping the whole log.
    }
  }
  return out
}

async function ensureReadingDir(fs: VaultFS): Promise<void> {
  // mkdir each segment progressively; ignore "already exists". Cheap and avoids
  // assuming a recursive mkdir.
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

// Appends are read-modify-write (VaultFS has no atomic append), so serialize
// them through a module-level promise chain. Two near-simultaneous document
// closes then can't clobber each other's line.
let _writeChain: Promise<void> = Promise.resolve()

/**
 * Append one reading session to the durable log, deduped by key (idempotent —
 * a repeated emit for the same sitting is a no-op). Best-effort: swallows all
 * errors so a logging failure never disrupts the viewer.
 */
export async function appendReadingSession(
  fs: VaultFS,
  record: ThinkingspaceReadingRecord,
): Promise<void> {
  _writeChain = _writeChain.then(async () => {
    try {
      let existingText = ''
      if (await fs.exists(READING_LOG_PATH)) {
        existingText = await fs.read(READING_LOG_PATH)
      } else {
        await ensureReadingDir(fs)
      }
      const existing = parseLogText(existingText)
      if (existing.some(r => r.key === record.key)) return
      const line = JSON.stringify(record)
      const next = existingText && !existingText.endsWith('\n')
        ? `${existingText}\n${line}\n`
        : `${existingText}${line}\n`
      await fs.write(READING_LOG_PATH, next)
    } catch {
      // Logging is best-effort; never throw into the caller.
    }
  })
  return _writeChain
}

/** Same-source same-doc rows that overlap the edited window with this much
 *  grace on each side get absorbed. Matches the goodnotes harvester's grace
 *  so editing feels consistent across reading sources. */
const ABSORB_GRACE_MS = 5 * 60_000

/**
 * Edit a single reading-md / reading-draw row in place: update startMs/endMs/
 * pages, mark `userEdited`, then delete every other row of the same source +
 * same filePath whose window overlaps the edited window (with 5-min grace on
 * each side). Serialized through the same write chain as appendReadingSession
 * so the dwell-emit-on-unmount path can't clobber an in-flight edit.
 */
export async function editThinkingspaceReadingRecord(
  fs: VaultFS,
  input: { key: string; startMs: number; endMs: number; pages: number },
): Promise<{ ok: boolean; absorbed: number; total: number }> {
  let result: { ok: boolean; absorbed: number; total: number } = {
    ok: false, absorbed: 0, total: 0,
  }
  _writeChain = _writeChain.then(async () => {
    try {
      if (!(await fs.exists(READING_LOG_PATH))) return
      const existingText = await fs.read(READING_LOG_PATH)
      const records = parseLogText(existingText)
      const idx = records.findIndex(r => r.key === input.key)
      if (idx === -1) return
      const target = records[idx]
      if (
        !Number.isFinite(input.startMs)
        || !Number.isFinite(input.endMs)
        || input.endMs - input.startMs < 60_000
      ) return

      const updated: ThinkingspaceReadingRecord = {
        ...target,
        startMs: input.startMs,
        endMs: input.endMs,
        pages: Math.max(1, Math.round(input.pages) || 1),
        userEdited: true,
      }

      const absorbStart = updated.startMs - ABSORB_GRACE_MS
      const absorbEnd = updated.endMs + ABSORB_GRACE_MS
      const survivors: ThinkingspaceReadingRecord[] = []
      let absorbed = 0
      for (let i = 0; i < records.length; i += 1) {
        if (i === idx) continue
        const r = records[i]
        const sameDoc = r.source === updated.source && r.filePath === updated.filePath
        const overlaps = sameDoc
          && r.startMs <= absorbEnd
          && r.endMs >= absorbStart
        if (overlaps) { absorbed += 1; continue }
        survivors.push(r)
      }
      survivors.splice(Math.min(idx, survivors.length), 0, updated)

      const next = survivors.length === 0
        ? ''
        : survivors.map(r => JSON.stringify(r)).join('\n') + '\n'
      await fs.write(READING_LOG_PATH, next)
      result = { ok: true, absorbed, total: survivors.length }
    } catch {
      // Best-effort; leave result with ok:false.
    }
  })
  await _writeChain
  return result
}

/**
 * Load in-app reading/drawing sessions from the durable vault log. Returns []
 * when nothing has been logged yet.
 */
export async function loadThinkingspaceReadingSessions(fs: VaultFS): Promise<ParsedSession[]> {
  try {
    if (!(await fs.exists(READING_LOG_PATH))) return []
    const text = await fs.read(READING_LOG_PATH)
    return parseThinkingspaceReadingLog(parseLogText(text))
  } catch {
    return []
  }
}
