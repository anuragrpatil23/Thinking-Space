// Durable store + loader for user-authored manual sessions. The log lives in
// the vault under ai-activity/ (the durable AI-activity home, gated by the
// writeAiActivity opt-in) — NOT ai-raw/, which is for harvested telemetry. A
// manual session is first-party authored data, so it rides the same opt-in the
// AI-activity mirror uses: writes require writeAiActivity; reads are best-effort
// (show whatever is already in the vault even if the user later toggled off).

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  parseManualSessionLog,
  type ManualSessionRecord,
} from '@/services/lego_blocks/units/manualSessionParserBlock'
import { getVaultWriteAiActivityEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'

const MANUAL_DIR = 'ai-activity'
const MANUAL_LOG_PATH = `${MANUAL_DIR}/manual-sessions.jsonl`

function parseLogText(text: string): ManualSessionRecord[] {
  const out: ManualSessionRecord[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as ManualSessionRecord)
    } catch {
      // Skip a corrupt line rather than dropping the whole log.
    }
  }
  return out
}

async function ensureManualDir(fs: VaultFS): Promise<void> {
  const segments = MANUAL_DIR.split('/')
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

// Read-modify-write serialized through a module promise chain so two edits
// can't clobber each other's line.
let _writeChain: Promise<void> = Promise.resolve()

async function readRecords(fs: VaultFS): Promise<{ text: string; records: ManualSessionRecord[] }> {
  if (!(await fs.exists(MANUAL_LOG_PATH))) return { text: '', records: [] }
  const text = await fs.read(MANUAL_LOG_PATH)
  return { text, records: parseLogText(text) }
}

async function writeAll(fs: VaultFS, records: ManualSessionRecord[]): Promise<void> {
  await ensureManualDir(fs)
  const body = records.map(r => JSON.stringify(r)).join('\n')
  await fs.write(MANUAL_LOG_PATH, body ? `${body}\n` : '')
}

/** Create one manual session. Requires the writeAiActivity opt-in; returns
 *  false (no-op) when it's off so callers can nudge the user to enable it. */
export async function appendManualSession(fs: VaultFS, record: ManualSessionRecord): Promise<boolean> {
  if (!(await getVaultWriteAiActivityEnabled())) return false
  let ok = false
  _writeChain = _writeChain.then(async () => {
    try {
      const { records } = await readRecords(fs)
      if (records.some(r => r.key === record.key)) { ok = true; return }
      records.push(record)
      await writeAll(fs, records)
      ok = true
    } catch {
      ok = false
    }
  })
  await _writeChain
  return ok
}

/** Edit a manual session in place by key. */
export async function editManualSession(
  fs: VaultFS,
  input: Pick<ManualSessionRecord, 'key' | 'project' | 'topic' | 'startMs' | 'endMs'> & { note?: string },
): Promise<boolean> {
  if (!(await getVaultWriteAiActivityEnabled())) return false
  let ok = false
  _writeChain = _writeChain.then(async () => {
    try {
      const { records } = await readRecords(fs)
      const idx = records.findIndex(r => r.key === input.key)
      if (idx === -1) return
      if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs) || input.endMs <= input.startMs) return
      records[idx] = {
        ...records[idx],
        project: input.project,
        topic: input.topic,
        note: input.note,
        startMs: input.startMs,
        endMs: input.endMs,
        recordedAt: Date.now(),
      }
      await writeAll(fs, records)
      ok = true
    } catch {
      ok = false
    }
  })
  await _writeChain
  return ok
}

/** Delete a manual session by key. */
export async function deleteManualSession(fs: VaultFS, key: string): Promise<boolean> {
  if (!(await getVaultWriteAiActivityEnabled())) return false
  let ok = false
  _writeChain = _writeChain.then(async () => {
    try {
      const { records } = await readRecords(fs)
      const next = records.filter(r => r.key !== key)
      if (next.length === records.length) { ok = true; return }
      await writeAll(fs, next)
      ok = true
    } catch {
      ok = false
    }
  })
  await _writeChain
  return ok
}

/** Fetch one record (for the edit modal — carries the note that the projected
 *  ParsedSession/chain drops). */
export async function getManualSession(fs: VaultFS, key: string): Promise<ManualSessionRecord | null> {
  try {
    const { records } = await readRecords(fs)
    return records.find(r => r.key === key) ?? null
  } catch {
    return null
  }
}

/** Load all manual sessions as ParsedSessions. Best-effort, unconditional read. */
export async function loadManualSessions(fs: VaultFS): Promise<ParsedSession[]> {
  try {
    const { records } = await readRecords(fs)
    return parseManualSessionLog(records)
  } catch {
    return []
  }
}
