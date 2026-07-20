// Device-local IndexedDB persistence for AI-activity data.
//
// Two records, both keyed to (CACHE_VERSION, vaultRoot):
//   - snapshot: the final deduped session list from the last successful load.
//     A cold app launch (iOS kills the WKWebView whenever the app backgrounds;
//     an Electron relaunch loses the module-level snapshot) paints from this
//     instantly while the real vault load runs in the background.
//   - disk-cache mirror: the parsed contents of the vault's shared
//     `.thinking-space/ai-activity-cache.json`, tagged with the file's
//     stat fingerprint. When the file hasn't changed, the loader skips the
//     multi-MB bridge read + JSON.parse entirely (on iOS that read also risks
//     an iCloud re-download stall).
//
// This is derived data only — the vault stays the source of truth (locked
// decision #3), and a version or vaultRoot mismatch simply falls back to the
// full load path.

import Dexie, { type Table } from 'dexie'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

interface AiActivitySnapshotRecord {
  /** Fixed key — one snapshot per storage partition. */
  id: string
  version: number
  vaultRoot: string
  /** Unix ms when the snapshot was written. */
  ts: number
  sessions: ParsedSession[]
}

interface AiActivityDiskCacheMirrorRecord {
  /** Fixed key — one mirror per storage partition. */
  id: string
  version: number
  vaultRoot: string
  /** `${mtime}:${size}` of the vault cache file this mirror was parsed from. */
  fingerprint: string
  sessions: Record<string, ParsedSession>
  updatedAt: number
}

class AiActivitySnapshotDB extends Dexie {
  snapshots!: Table<AiActivitySnapshotRecord>
  diskCacheMirrors!: Table<AiActivityDiskCacheMirrorRecord>

  constructor() {
    super('ThinkingSpaceAiActivitySnapshot')
    this.version(1).stores({
      snapshots: '&id',
      diskCacheMirrors: '&id',
    })
  }
}

let _db: AiActivitySnapshotDB | null = null

function getDb(): AiActivitySnapshotDB {
  if (!_db) _db = new AiActivitySnapshotDB()
  return _db
}

const RECORD_ID = 'latest'

export async function readPersistedAiActivitySnapshotBlock(
  version: number,
  vaultRoot: string,
): Promise<ParsedSession[] | null> {
  try {
    const rec = await getDb().snapshots.get(RECORD_ID)
    if (!rec || rec.version !== version || rec.vaultRoot !== vaultRoot) return null
    if (!Array.isArray(rec.sessions) || rec.sessions.length === 0) return null
    return rec.sessions
  } catch {
    return null
  }
}

export async function writePersistedAiActivitySnapshotBlock(
  version: number,
  vaultRoot: string,
  sessions: ParsedSession[],
): Promise<void> {
  try {
    await getDb().snapshots.put({
      id: RECORD_ID,
      version,
      vaultRoot,
      ts: Date.now(),
      sessions,
    })
  } catch {
    // Persistence failures are silent — next launch just does the full load.
  }
}

export async function clearPersistedAiActivitySnapshotBlock(): Promise<void> {
  try {
    await getDb().snapshots.delete(RECORD_ID)
  } catch {
    // ignore
  }
}

export async function readPersistedDiskCacheMirrorBlock(
  version: number,
  vaultRoot: string,
  fingerprint: string,
): Promise<{ sessions: Record<string, ParsedSession>; updatedAt: number } | null> {
  try {
    const rec = await getDb().diskCacheMirrors.get(RECORD_ID)
    if (!rec || rec.version !== version || rec.vaultRoot !== vaultRoot) return null
    if (rec.fingerprint !== fingerprint) return null
    if (!rec.sessions || typeof rec.sessions !== 'object') return null
    return { sessions: rec.sessions, updatedAt: rec.updatedAt }
  } catch {
    return null
  }
}

export async function writePersistedDiskCacheMirrorBlock(
  version: number,
  vaultRoot: string,
  fingerprint: string,
  sessions: Record<string, ParsedSession>,
  updatedAt: number,
): Promise<void> {
  try {
    await getDb().diskCacheMirrors.put({
      id: RECORD_ID,
      version,
      vaultRoot,
      fingerprint,
      sessions,
      updatedAt,
    })
  } catch {
    // Persistence failures are silent — next load re-reads the vault file.
  }
}
