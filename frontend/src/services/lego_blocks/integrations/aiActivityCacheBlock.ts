// Vault-backed cache for parsed Claude Code / Codex sessions.
//
// Four layers, fastest first:
//   1. Module-level in-memory snapshot (shared across every hook / component).
//      Returned instantly on subsequent calls — second mount is free.
//   2. Device-persisted snapshot in IndexedDB (aiActivitySnapshotStoreBlock).
//      Cold launches (iOS kills the WKWebView on background) paint from it
//      immediately while the full load runs behind; subscribers are notified
//      when the fresh result lands.
//   3. On-disk JSON cache in the vault (survives app restarts; shared with the
//      Python script that uses the same parser). Fingerprinted by stat so an
//      unchanged file skips the multi-MB read + JSON.parse.
//   4. Parse from the raw session markdown (only for files whose mtime changed
//      since the on-disk cache was written).
//
// Concurrent callers share the same in-flight load promise so the post-it
// hook and the activity panel never duplicate the vault walk.

import type { VaultFS, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseVaultSessionsBlock,
  type ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  listNativeAiSessions,
  loadAndParseNativeAiSession,
  nativeAiSourcesAvailable,
  readClaudeHistory,
} from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'
import { parseClaudeHistoryBlock } from '@/services/lego_blocks/units/claudeHistoryParserBlock'
import { sessionIdOf } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import { readVaultSessionPrefixesBlock } from '@/services/lego_blocks/units/aiActivitySourcesBlock'
import { loadGoodnotesReadingSessions } from '@/services/lego_blocks/integrations/goodnotesReadingBlock'
import { loadMemorizedSessions } from '@/services/lego_blocks/integrations/memorizedReadingBlock'
import { loadThinkingspaceReadingSessions } from '@/services/lego_blocks/integrations/thinkingspaceReadingBlock'
import { loadManualSessions } from '@/services/lego_blocks/integrations/manualSessionBlock'
import {
  clearPersistedAiActivitySnapshotBlock,
  readPersistedAiActivitySnapshotBlock,
  readPersistedDiskCacheMirrorBlock,
  writePersistedAiActivitySnapshotBlock,
  writePersistedDiskCacheMirrorBlock,
} from '@/services/lego_blocks/integrations/aiActivitySnapshotStoreBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

const CACHE_PATH = '.thinking-space/ai-activity-cache.json'
const CACHE_DIR = '.thinking-space'
// v12: project detection switched to the generic "cwd folder name" scheme and
// sessions now carry an explicit `cwd` — bump so every transcript re-classifies.
// v13: cwd detection now validates the captured value is a real path (rejects
// shell/JSON fragments like `$(pwd | sed...`) and scans all matches for the
// first sane one — re-parse so garbage project buckets disappear.
// v14: chat exports (chatgpt/grok) cap created→updated spans at 6h — revisited
// conversations were producing multi-month "sessions"; re-parse to fix durations.
// v15: chat exports now parse real per-message body timestamps into per-sitting
// windows (`path#wN`) — frontmatter `updated` proved to be bulk-rewritten junk.
// v16: native Claude sessions now carry file-edit provenance (`touchedPaths`)
// for the vault-graph session lens; reparse so cached rows pick it up.
// v18: native sessions carry activeDurationMs (inter-message time, long pauses
// clamped) so the density sparkline reflects work, not wall-clock tab-open time.
// v19: a window's id is anchored to its first event (`<uuid>::<event-uuid>`)
// instead of its ordinal (`<uuid>::w2`), so an assignment cannot slide onto a
// different sitting when the windowing changes. Cached rows keep whatever id
// they were parsed with, and the id is the digest's ADDRESS — so without this
// bump every window keeps its old name and no digest ever lands at the new one.
// v20: tokens are attributed to the window that spent them (Claude sums its
// per-turn usage, Codex deltas its running total) instead of landing entirely
// on window 0. Cached rows carry the old all-on-window-0 split.
// v21: chat-export (chatgpt/grok) window ids are anchored to the first
// message's timestamp instead of the window's ordinal, matching what native
// sessions already do. Cached rows carry the old `::wN` form, which is the
// digest's ADDRESS — without the bump they keep it and no digest lands at the
// new one.
const CACHE_VERSION = 21

/** How long to trust the in-memory snapshot before re-walking on the next load call. */
const MEM_TTL_MS = 5 * 60 * 1000
/** Max concurrent fs.read calls when re-parsing changed sessions. */
const READ_CONCURRENCY = 16

/**
 * Compare file mtimes at whole-second resolution.
 *
 * Every adapter reports mtime as FRACTIONAL seconds from a different source —
 * Electron divides `stat.mtimeMs` by 1000, iOS reads `timeIntervalSince1970`,
 * the Capacitor Filesystem path divides its own ms value — and the cache
 * round-trips the number through JSON as a decimal string. Two of those steps
 * lose the low bits, so an exact `===` on the raw values reports "changed" for
 * files nobody touched: on the author's Mac 294 of 2,859 rows differed only in
 * the last ULP (…0964825 vs …0964823), and on iOS, where the value comes from
 * an entirely different API than the one that wrote the cache, it effectively
 * never matched.
 *
 * The cost of that was not a stale cache — it was correctness-preserving and
 * catastrophic: every launch re-read and re-parsed all ~1,500 vault transcripts
 * (~524 MB), which measured as a ~790 MB permanently-retained WebContent
 * footprint on iPad plus a 13-second 155% CPU burn at startup (see the iOS
 * Memory Contract). Flooring to seconds is what `vaultSyncOrch` already does
 * via `normalizeEpochSeconds`, and it works against caches already on disk
 * without a version bump.
 *
 * Tradeoff: a file rewritten within the same second as its cached parse is not
 * re-parsed. That is the same resolution make(1) and rsync have relied on for
 * decades, and these transcripts are append-on-session-end, not hot files.
 */
function sameMtimeBlock(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.floor(a) === Math.floor(b)
}

interface CacheFile {
  version: number
  /** Map of path -> parsed session, keyed by vault-relative path. */
  sessions: Record<string, ParsedSession>
  /** Unix-seconds timestamp when the cache was last written. */
  updatedAt: number
}

function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, sessions: {}, updatedAt: 0 }
}

function vaultRootKey(): string {
  return getStoredVaultRoot() ?? ''
}

// The vault cache file is multi-MB; on iOS reading it is a WKWebView bridge
// round-trip (plus a possible iCloud re-download) and JSON.parse runs on the
// main thread. Fingerprint the file first (mtime+size) and reuse the parsed
// content — in-memory within a process, IndexedDB-mirrored across launches —
// whenever the file hasn't changed.
let _diskCacheMemo: { fingerprint: string; cache: CacheFile } | null = null

async function statCacheFingerprint(fs: VaultFS): Promise<string | null> {
  try {
    const st = await fs.stat(CACHE_PATH)
    if (st.isDirectory) return null
    return `${st.mtime}:${st.size}`
  } catch {
    // Missing file, or an undownloaded iCloud placeholder — fall back to the
    // exists()+read path, which knows how to handle both.
    return null
  }
}

async function readCache(fs: VaultFS): Promise<CacheFile> {
  const fingerprint = await statCacheFingerprint(fs)
  if (fingerprint) {
    if (_diskCacheMemo?.fingerprint === fingerprint) return _diskCacheMemo.cache
    const mirrored = await readPersistedDiskCacheMirrorBlock(
      CACHE_VERSION,
      vaultRootKey(),
      fingerprint,
    )
    if (mirrored) {
      const cache: CacheFile = {
        version: CACHE_VERSION,
        sessions: mirrored.sessions,
        updatedAt: mirrored.updatedAt,
      }
      _diskCacheMemo = { fingerprint, cache }
      return cache
    }
  }
  try {
    if (!fingerprint && !(await fs.exists(CACHE_PATH))) return emptyCache()
    const raw = await fs.read(CACHE_PATH)
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed.version !== CACHE_VERSION) return emptyCache()
    if (!parsed.sessions || typeof parsed.sessions !== 'object') return emptyCache()
    if (fingerprint) {
      _diskCacheMemo = { fingerprint, cache: parsed }
      void writePersistedDiskCacheMirrorBlock(
        CACHE_VERSION,
        vaultRootKey(),
        fingerprint,
        parsed.sessions,
        parsed.updatedAt,
      )
    }
    return parsed
  } catch {
    return emptyCache()
  }
}

async function writeCache(fs: VaultFS, cache: CacheFile): Promise<void> {
  try {
    if (!(await fs.exists(CACHE_DIR))) {
      await fs.mkdir(CACHE_DIR)
    }
    await fs.write(CACHE_PATH, JSON.stringify(cache))
    // Refresh the fingerprint memo/mirror so the next load doesn't re-read
    // the file we just wrote.
    const fingerprint = await statCacheFingerprint(fs)
    if (fingerprint) {
      _diskCacheMemo = { fingerprint, cache }
      void writePersistedDiskCacheMirrorBlock(
        CACHE_VERSION,
        vaultRootKey(),
        fingerprint,
        cache.sessions,
        cache.updatedAt,
      )
    }
  } catch {
    // Cache write failures are silent — next launch just re-parses.
  }
}

export interface LoadResult {
  sessions: ParsedSession[]
  /** Count of files re-parsed this load (0 means everything hit the cache). */
  reparsed: number
}

// ── Module-level snapshot ──────────────────────────────────────────────────
//
// _snapshot holds the most recent successful result. _inflight dedupes
// concurrent callers so a panel + a post-it hook + a refresh all share one
// vault walk.

let _snapshot: { result: LoadResult; ts: number } | null = null
let _inflight: Promise<LoadResult> | null = null

export function getCachedSnapshot(): LoadResult | null {
  return _snapshot?.result ?? null
}

export function clearAiActivitySnapshot(): void {
  _snapshot = null
  _inflight = null
  _diskCacheMemo = null
  // Drop the device-persisted snapshot too — callers clear when the session
  // sources change, and a stale seed would resurrect excluded sessions for a
  // moment on the next cold launch.
  void clearPersistedAiActivitySnapshotBlock()
}

// Fires after every fresh performLoad completes, so consumers that painted
// from a (possibly stale) persisted seed can adopt the real result silently.
const _snapshotListeners = new Set<() => void>()

export function subscribeAiActivitySnapshotBlock(listener: () => void): () => void {
  _snapshotListeners.add(listener)
  return () => {
    _snapshotListeners.delete(listener)
  }
}

function notifySnapshotListeners(): void {
  for (const listener of [..._snapshotListeners]) {
    try {
      listener()
    } catch {
      // Listener errors must not break the load pipeline.
    }
  }
}

async function runParallel<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function pull(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  }
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => pull())
  await Promise.all(lanes)
  return out
}

interface LoadOptions {
  /** Bypass the in-memory snapshot and force a fresh vault walk. */
  force?: boolean
}

async function performLoad(fs: VaultFS): Promise<LoadResult> {
  // ── 1. Discover the universe of session files across both source families ──
  // On non-Electron clients (iPhone/web) the native IPC isn't present, so
  // `listNativeAiSessions()` returns []. We still want the cached native
  // sessions (Electron wrote them, iCloud synced them) — handled in step 3
  // by carrying every cached native row through unchanged when the native
  // source isn't available locally.
  const nativeAvailable = nativeAiSourcesAvailable()
  const [vaultEntries, nativeEntries, historyText] = await Promise.all([
    fs.walkVault(['.md']),
    listNativeAiSessions(),
    readClaudeHistory(),
  ])

  const sourcePrefixes = readVaultSessionPrefixesBlock()
  const vaultSessions: VaultEntry[] = vaultEntries.filter(e =>
    sourcePrefixes.some(prefix => e.path.startsWith(prefix)),
  )

  const cache = await readCache(fs)
  const next: Record<string, ParsedSession> = {}
  const present = new Set<string>()
  let reparsed = 0

  // ── 2. Vault markdown — cached by relative vault path. Chat-export files
  // (chatgpt/grok) can yield several per-sitting windows (`path`, `path#w1`,
  // …) which all share the file's mtime — same sibling-restore scheme as the
  // native step below. ──
  const cachedByVaultFile = new Map<string, ParsedSession[]>()
  for (const [path, sess] of Object.entries(cache.sessions)) {
    if (path.startsWith('native/') || path.startsWith('history/')) continue
    const fileKey = path.split('#', 1)[0]
    const arr = cachedByVaultFile.get(fileKey) ?? []
    arr.push(sess)
    cachedByVaultFile.set(fileKey, arr)
  }
  const vaultToParse: VaultEntry[] = []
  for (const entry of vaultSessions) {
    const cachedWindows = cachedByVaultFile.get(entry.path) ?? []
    const fresh = cachedWindows.length > 0 && cachedWindows.every(s => sameMtimeBlock(s.mtime, entry.mtime))
    if (fresh) {
      for (const s of cachedWindows) {
        present.add(s.path)
        next[s.path] = s
      }
    } else {
      present.add(entry.path)
      vaultToParse.push(entry)
    }
  }
  const vaultParsed = await runParallel(vaultToParse, READ_CONCURRENCY, async entry => {
    try {
      const text = await fs.read(entry.path)
      return parseVaultSessionsBlock({ path: entry.path, text, mtime: entry.mtime })
    } catch {
      return cachedByVaultFile.get(entry.path) ?? []
    }
  })
  for (const windows of vaultParsed) {
    for (const s of windows) {
      present.add(s.path)
      next[s.path] = s
    }
    if (windows.length > 0) reparsed += 1
  }

  // ── 3. Native sessions — cached by `native/<source>/<relPath>` synthetic key.
  // One file can produce multiple window entries (`key`, `key#w1`, `key#w2`, …)
  // when there are long idle gaps. All windows from the same file share an
  // mtime, so on a cache hit we restore every sibling row for that key. ──
  const nativeToParse: typeof nativeEntries = []
  const cachedByFileKey = new Map<string, ParsedSession[]>()
  for (const [path, sess] of Object.entries(cache.sessions)) {
    if (!path.startsWith('native/')) continue
    const fileKey = path.split('#', 1)[0]
    const arr = cachedByFileKey.get(fileKey) ?? []
    arr.push(sess)
    cachedByFileKey.set(fileKey, arr)
  }
  if (!nativeAvailable) {
    // iPhone / web: no native IPC, so we can't list or re-parse native files.
    // Carry every cached native window through unchanged — Electron wrote
    // them, iCloud synced them to us. Without this, the prune step below
    // would treat all native entries as stale and the next writeCache would
    // wipe them from the shared cache, poisoning the next Electron launch.
    for (const [, windows] of cachedByFileKey) {
      for (const s of windows) {
        present.add(s.path)
        next[s.path] = s
      }
    }
  } else {
    for (const entry of nativeEntries) {
      const key = `native/${entry.source}/${entry.relPath}`
      const cachedWindows = cachedByFileKey.get(key) ?? []
      const fresh = cachedWindows.length > 0 && cachedWindows.every(s => sameMtimeBlock(s.mtime, entry.mtime))
      if (fresh) {
        for (const s of cachedWindows) {
          present.add(s.path)
          next[s.path] = s
        }
      } else {
        // Mark the base key present so a later prune step (if any) doesn't drop
        // the file just because its window suffixes haven't been written yet.
        present.add(key)
        nativeToParse.push(entry)
      }
    }
  }
  const nativeParsed = await runParallel(nativeToParse, READ_CONCURRENCY, async entry => {
    const parsed = await loadAndParseNativeAiSession(entry)
    if (parsed.length > 0) return parsed
    // Parse failure: fall back to whatever windows we have cached for this file.
    const key = `native/${entry.source}/${entry.relPath}`
    return cachedByFileKey.get(key) ?? []
  })
  for (const windows of nativeParsed) {
    for (const s of windows) {
      present.add(s.path)
      next[s.path] = s
    }
    if (windows.length > 0) reparsed += 1
  }

  // ── 3b. Reconstructed sessions from ~/.claude/history.jsonl. ────────────────
  // The permanent prompt log survives Claude Code's transcript cleanup, so it
  // backfills sessions whose JSONL files were deleted (no tokens — just prompt
  // counts, project, and a rough time window). Parsed fresh on every Electron
  // load (single small file); non-Electron clients carry the cached entries
  // through, same as native. Coverage filtering happens at dedup time below —
  // a history row is dropped whenever a real transcript covers its sessionId.
  if (!nativeAvailable || !historyText) {
    for (const [path, sess] of Object.entries(cache.sessions)) {
      if (!path.startsWith('history/')) continue
      present.add(path)
      next[path] = sess
    }
  } else {
    const historySessions = parseClaudeHistoryBlock(historyText, 0)
    let historyChanged = false
    for (const s of historySessions) {
      present.add(s.path)
      next[s.path] = s
      const cached = cache.sessions[s.path]
      if (!cached || cached.userMsgCount !== s.userMsgCount || cached.endedIso !== s.endedIso) {
        historyChanged = true
      }
    }
    if (historyChanged) reparsed += 1
  }

  // ── 4. Persist the merged cache (raw, pre-dedup). ───────────────────────────
  // Only Electron writes the cache — it's the only client that can actually
  // re-parse native files, so it's the source of truth. iPhone/web stays
  // read-only on the shared cache so it can't drop entries it can't verify.
  const stale = Object.keys(cache.sessions).filter(p => !present.has(p))
  if (nativeAvailable && (reparsed > 0 || stale.length > 0 || Object.keys(cache.sessions).length === 0)) {
    await writeCache(fs, {
      version: CACHE_VERSION,
      sessions: next,
      updatedAt: Math.floor(Date.now() / 1000),
    })
  }

  // ── 4b. GoodNotes reading sessions. ─────────────────────────────────────────
  // Harvested (Electron) or read from the synced vault log (iPhone/web) into the
  // shared ParsedSession shape, tagged source:'goodnotes'. Deliberately NOT
  // written to the on-disk cache.json — the durable JSONL in the vault is their
  // source of truth, so we read them fresh each load (small file) and merge them
  // into the dedup below. They carry unique ids (no collision with claude/codex/
  // chat sessions), so dedup leaves them intact.
  const goodnotesSessions = await loadGoodnotesReadingSessions(fs).catch(() => [])

  // ── 4c. Memorization sessions. ──────────────────────────────────────────────
  // Read from the `memorized_sessions` YAML indexed into IndexedDB (the durable
  // source of truth is the notes themselves), tagged source:'memorized'. Like
  // GoodNotes, NOT written to cache.json — read fresh each load, unique ids
  // survive the dedup below.
  const memorizedSessions = await loadMemorizedSessions().catch(() => [])

  // ── 4d. In-app reading/drawing sessions (TS markdown + Excalidraw). ──────────
  // Emitted by the viewers into a durable vault JSONL once a sitting crosses the
  // dwell threshold, tagged source:'reading-md'/'reading-draw'. Like the others,
  // NOT written to cache.json — read fresh each load, unique ids survive dedup.
  const thinkingspaceReadingSessions = await loadThinkingspaceReadingSessions(fs).catch(() => [])

  // ── 4e. User-authored manual sessions (ai-activity/manual-sessions.jsonl). ───
  // Hand-logged time blocks ("painting 4h"); durable, uuid-keyed, read fresh.
  const manualSessions = await loadManualSessions(fs).catch(() => [])

  // ── 5. Dedupe before returning to consumers. ────────────────────────────────
  // For each session id (full UUID for native, 8-char short id for vault),
  // prefer the richer native record when both exist — it has explicit cwd,
  // millisecond timestamps, and the full sessionId.
  // Reconstructed history rows are the lowest-priority source: drop every
  // window of a history session when ANY real (native/vault) record covers the
  // same base sessionId. Mixing windows from a real transcript with leftover
  // history windows would double-count, so coverage is all-or-nothing per id.
  const raw = [
    ...Object.values(next),
    ...goodnotesSessions,
    ...memorizedSessions,
    ...thinkingspaceReadingSessions,
    ...manualSessions,
  ]
  const coveredFullIds = new Set<string>()
  const coveredShortIds = new Set<string>()
  for (const s of raw) {
    if (s.path.startsWith('history/')) continue
    const base = sessionIdOf(s).split('::', 1)[0]
    if (base.length === 8) coveredShortIds.add(base)
    else coveredFullIds.add(base)
  }
  const all = raw.filter(s => {
    if (!s.path.startsWith('history/')) return true
    const base = sessionIdOf(s).split('::', 1)[0]
    if (coveredFullIds.has(base)) return false
    return !coveredShortIds.has(base.slice(0, 8))
  })

  const byId = new Map<string, ParsedSession>()
  for (const s of all) {
    const id = sessionIdOf(s)
    // Normalize vault short ids onto the matching native UUID prefix when
    // we have one, so the same session collapses into one entry.
    const normalizedId = id.length === 8
      ? findUuidByPrefix(all, id) ?? id
      : id
    const existing = byId.get(normalizedId)
    if (!existing) {
      byId.set(normalizedId, s)
      continue
    }
    // Prefer native (path starts with "native/"). If both same type, keep the
    // one with the higher userMsgCount (more complete).
    const existingIsNative = existing.path.startsWith('native/')
    const candidateIsNative = s.path.startsWith('native/')
    if (candidateIsNative && !existingIsNative) {
      byId.set(normalizedId, s)
    } else if (candidateIsNative === existingIsNative && s.userMsgCount > existing.userMsgCount) {
      byId.set(normalizedId, s)
    }
  }

  const sessions = [...byId.values()].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )
  return { sessions, reparsed }
}

function findUuidByPrefix(sessions: ParsedSession[], short: string): string | null {
  for (const s of sessions) {
    const id = sessionIdOf(s)
    if (id.length > 8 && id.startsWith(short)) return id
  }
  return null
}

/**
 * Load all session activity from the vault, using both an in-memory snapshot
 * and the on-disk JSON cache. Safe to call from many hooks at once — concurrent
 * callers share one in-flight load.
 */
export async function loadAiActivity(
  fs: VaultFS,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const { force = false } = options

  if (!force && _snapshot) {
    const age = Date.now() - _snapshot.ts
    if (age < MEM_TTL_MS) return _snapshot.result
  }

  if (!force && _inflight) return _inflight

  if (force) {
    _snapshot = null
    _inflight = null
  }

  const hadSnapshot = _snapshot != null

  const promise = performLoad(fs).then(result => {
    _snapshot = { result, ts: Date.now() }
    _inflight = null
    void writePersistedAiActivitySnapshotBlock(CACHE_VERSION, vaultRootKey(), result.sessions)
    notifySnapshotListeners()
    return result
  }).catch(err => {
    _inflight = null
    throw err
  })

  _inflight = promise

  // Cold start (nothing in memory yet, e.g. a fresh WKWebView after iOS killed
  // the app): paint immediately from the device-persisted snapshot while the
  // full load above runs in the background. The `ts: 0` marks the seed stale,
  // so the next call still awaits the real load; subscribers are notified when
  // it lands.
  if (!force && !hadSnapshot) {
    const persisted = await readPersistedAiActivitySnapshotBlock(
      CACHE_VERSION,
      vaultRootKey(),
    ).catch(() => null)
    if (persisted && !_snapshot) {
      const seeded: LoadResult = { sessions: persisted, reparsed: 0 }
      _snapshot = { result: seeded, ts: 0 }
      // The background load's rejection is surfaced to any caller awaiting
      // _inflight; this seed path just must not leave it unhandled.
      void promise.catch(() => {})
      return seeded
    }
  }

  return promise
}
