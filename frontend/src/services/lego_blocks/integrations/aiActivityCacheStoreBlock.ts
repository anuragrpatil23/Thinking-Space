// On-disk store for the parsed AI-activity cache, in the vault so iCloud
// carries the Mac's parses to the phone.
//
//   .thinking-space/ai-activity-cache/v<version>.<YYYY-MM>.json
//
// One file per month of session start. A write rewrites only the months whose
// content changed — in practice the current one — so a busy agent day no
// longer re-uploads the whole history. Measured before the split
// (2026-10-16): one 4.1 MB file rewritten on every transcript change, ~12×/h
// with agents running, ~50 MB/h of iCloud upload for nearly-static history.
//
// Reads fingerprint each month file (mtime+size) and reuse the parse of
// unchanged months in memory; the whole set is mirrored in IndexedDB across
// launches (iOS cold starts). The pre-split single file is read once to
// migrate and never written again — left in place so an older app build
// still finds its data.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  readPersistedDiskCacheMirrorBlock,
  writePersistedDiskCacheMirrorBlock,
} from '@/services/lego_blocks/integrations/aiActivitySnapshotStoreBlock'

export interface AiActivityCacheFile {
  version: number
  /** Map of path -> parsed session, keyed by vault-relative path. */
  sessions: Record<string, ParsedSession>
  /** Unix-seconds timestamp when the cache was last written. */
  updatedAt: number
}

const LEGACY_CACHE_PATH = '.thinking-space/ai-activity-cache.json'
const CACHE_DIR = '.thinking-space'
const SHARD_DIR = '.thinking-space/ai-activity-cache'

interface MonthMemo {
  fingerprint: string
  sessions: Record<string, ParsedSession>
  /** Exact text last read or written — kept only where this device writes,
   *  so a write can skip months whose content did not change. */
  raw?: string
}

let _months = new Map<string, MonthMemo>()
let _whole: { fingerprint: string; cache: AiActivityCacheFile } | null = null

/** Forget every parse held in memory (e.g. when session sources change). */
export function resetAiActivityCacheStoreBlock(): void {
  _months = new Map()
  _whole = null
}

const fileName = (version: number, month: string) => `v${version}.${month}.json`

export function aiActivityCacheMonthBlock(session: ParsedSession): string {
  const month = session.startedIso?.slice(0, 7) ?? ''
  return /^\d{4}-\d{2}$/.test(month) ? month : 'undated'
}

/** Month → fingerprint for every month file of `version` on disk. */
async function statMonths(fs: VaultFS, version: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let files: string[]
  try {
    files = (await fs.list(SHARD_DIR)).files
  } catch {
    return out
  }
  const prefix = `v${version}.`
  await Promise.all(files.map(async file => {
    if (!file.startsWith(prefix) || !file.endsWith('.json')) return
    const month = file.slice(prefix.length, -'.json'.length)
    try {
      const st = await fs.stat(`${SHARD_DIR}/${file}`)
      if (!st.isDirectory) out.set(month, `${st.mtime}:${st.size}`)
    } catch {
      // An undownloaded iCloud placeholder: no fingerprint, so it is read.
      out.set(month, `unknown:${Date.now()}`)
    }
  }))
  return out
}

const combine = (fingerprints: Map<string, string>) =>
  [...fingerprints].sort(([a], [b]) => a.localeCompare(b)).map(([m, fp]) => `${m}=${fp}`).join('|')

async function readLegacy(fs: VaultFS, version: number): Promise<AiActivityCacheFile | null> {
  try {
    if (!(await fs.exists(LEGACY_CACHE_PATH))) return null
    const parsed = JSON.parse(await fs.read(LEGACY_CACHE_PATH)) as AiActivityCacheFile
    if (parsed.version !== version || !parsed.sessions || typeof parsed.sessions !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * The whole cache, or null when there is none (or a month can't be read — a
 * partial picture is worse than re-parsing). `keepRaw` on the device that
 * writes, so its next write can tell which months actually changed.
 */
export async function readAiActivityCacheStoreBlock(
  fs: VaultFS,
  version: number,
  vaultRoot: string,
  keepRaw: boolean,
): Promise<AiActivityCacheFile | null> {
  const fingerprints = await statMonths(fs, version)
  if (fingerprints.size === 0) return readLegacy(fs, version)

  const combined = combine(fingerprints)
  if (_whole?.fingerprint === combined) return _whole.cache
  if (_months.size === 0) {
    const mirrored = await readPersistedDiskCacheMirrorBlock(version, vaultRoot, combined)
    if (mirrored) {
      const cache = { version, sessions: mirrored.sessions, updatedAt: mirrored.updatedAt }
      _whole = { fingerprint: combined, cache }
      return cache
    }
  }

  const next = new Map<string, MonthMemo>()
  let updatedAt = 0
  try {
    for (const [month, fingerprint] of fingerprints) {
      const known = _months.get(month)
      if (known && known.fingerprint === fingerprint) {
        next.set(month, known)
        continue
      }
      const raw = await fs.read(`${SHARD_DIR}/${fileName(version, month)}`)
      const parsed = JSON.parse(raw) as AiActivityCacheFile
      if (parsed.version !== version || !parsed.sessions || typeof parsed.sessions !== 'object') {
        throw new Error(`bad month file ${month}`)
      }
      updatedAt = Math.max(updatedAt, parsed.updatedAt ?? 0)
      next.set(month, { fingerprint, sessions: parsed.sessions, raw: keepRaw ? raw : undefined })
    }
  } catch {
    resetAiActivityCacheStoreBlock()
    return null
  }
  _months = next

  const sessions: Record<string, ParsedSession> = {}
  for (const memo of next.values()) Object.assign(sessions, memo.sessions)
  const cache = { version, sessions, updatedAt: updatedAt || Math.floor(Date.now() / 1000) }
  _whole = { fingerprint: combined, cache }
  void writePersistedDiskCacheMirrorBlock(version, vaultRoot, combined, sessions, cache.updatedAt)
  return cache
}

/** Text of one month file. Keys sorted, so equal content is equal text. */
function monthText(version: number, sessions: Record<string, ParsedSession>, updatedAt: number): string {
  const sorted: Record<string, ParsedSession> = {}
  for (const path of Object.keys(sessions).sort()) sorted[path] = sessions[path]
  return JSON.stringify({ version, sessions: sorted, updatedAt })
}

/** Equal apart from the trailing top-level updatedAt stamp. */
function sameContent(a: string, b: string): boolean {
  const body = (text: string) => {
    const at = text.lastIndexOf(',"updatedAt":')
    return at >= 0 ? text.slice(0, at) : text
  }
  return body(a) === body(b)
}

/** Write the cache, touching only the months whose content changed. */
export async function writeAiActivityCacheStoreBlock(
  fs: VaultFS,
  cache: AiActivityCacheFile,
  vaultRoot: string,
): Promise<void> {
  try {
    for (const dir of [CACHE_DIR, SHARD_DIR]) {
      if (!(await fs.exists(dir))) await fs.mkdir(dir)
    }
    const byMonth = new Map<string, Record<string, ParsedSession>>()
    for (const [path, session] of Object.entries(cache.sessions)) {
      const month = aiActivityCacheMonthBlock(session)
      const bucket = byMonth.get(month) ?? {}
      bucket[path] = session
      byMonth.set(month, bucket)
    }

    let wrote = false
    for (const [month, sessions] of byMonth) {
      const raw = monthText(cache.version, sessions, cache.updatedAt)
      const known = _months.get(month)
      if (known?.raw && sameContent(known.raw, raw)) continue
      await fs.write(`${SHARD_DIR}/${fileName(cache.version, month)}`, raw)
      _months.set(month, { fingerprint: '', sessions, raw })
      wrote = true
    }

    // Months with nothing left in them, and files from other cache versions.
    const keep = new Set([...byMonth.keys()].map(month => fileName(cache.version, month)))
    try {
      for (const file of (await fs.list(SHARD_DIR)).files) {
        if (!keep.has(file)) await fs.delete(`${SHARD_DIR}/${file}`).catch(() => undefined)
      }
    } catch { /* nothing to clean */ }
    for (const month of [..._months.keys()]) {
      if (!byMonth.has(month)) _months.delete(month)
    }

    // Fresh fingerprints, so the next read doesn't re-read what was just written.
    const fingerprints = await statMonths(fs, cache.version)
    for (const [month, fingerprint] of fingerprints) {
      const memo = _months.get(month)
      if (memo) memo.fingerprint = fingerprint
    }
    const combined = combine(fingerprints)
    _whole = { fingerprint: combined, cache }
    if (wrote) {
      void writePersistedDiskCacheMirrorBlock(cache.version, vaultRoot, combined, cache.sessions, cache.updatedAt)
    }
  } catch {
    // Cache write failures are silent — the next launch just re-parses.
  }
}
