// Session-telemetry workflow — resolves the latest vault-touching AI session
// into explorer-ready telemetry: which files it created vs edited, the folders
// above them, and the counts for the strip over the file tree. Created-vs-
// edited comes from each file's ctime falling inside the session span, so no
// parser or cache-shape change is needed. Snapshot + in-flight dedupe mirror
// vaultGraphOrch; the snapshot also preserves object identity across reloads
// when nothing changed, so polling hooks don't re-render for free.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { selectLatestVaultSessionBlock } from '@/services/lego_blocks/integrations/sessionTelemetryBlock'

export interface SessionTelemetry {
  /** Base transcript key — identity of "the session" the dots describe. */
  sessionKey: string
  topic: string
  startedMs: number
  endedMs: number
  /** Vault-relative file → how the session touched it. */
  files: ReadonlyMap<string, 'created' | 'edited'>
  /** Every ancestor folder of a touched file (vault-relative; root excluded). */
  folders: ReadonlySet<string>
  createdCount: number
  editedCount: number
}

/** Saves land shortly after tool calls; ctime gets the same slack the graph
 *  gives session windows. */
const CTIME_SLACK_MS = 5 * 60_000

const SNAPSHOT_TTL_MS = 60_000

let _snapshot: { value: SessionTelemetry | null; ts: number } | null = null
let _inflight: Promise<SessionTelemetry | null> | null = null

function sameTelemetry(a: SessionTelemetry | null, b: SessionTelemetry | null): boolean {
  if (a === null || b === null) return a === b
  if (a.sessionKey !== b.sessionKey || a.endedMs !== b.endedMs || a.files.size !== b.files.size) {
    return false
  }
  for (const [path, kind] of b.files) {
    if (a.files.get(path) !== kind) return false
  }
  return true
}

async function performLoad(): Promise<SessionTelemetry | null> {
  const vaultRoot = getStoredVaultRoot() ?? ''
  if (!vaultRoot) return null
  const fs = getVaultFS()
  const { sessions } = await loadAiActivity(fs)
  const latest = selectLatestVaultSessionBlock(sessions, vaultRoot, Date.now())
  if (!latest) return null

  const files = new Map<string, 'created' | 'edited'>()
  await Promise.all(
    latest.relPaths.map(async rel => {
      try {
        const stat = await fs.stat(rel)
        if (stat.isDirectory) return
        const ctimeMs = (stat.ctime ?? 0) * 1000
        const created =
          ctimeMs >= latest.startedMs - CTIME_SLACK_MS && ctimeMs <= latest.endedMs + CTIME_SLACK_MS
        files.set(rel, created ? 'created' : 'edited')
      } catch {
        // Deleted since the session — no row left to mark.
      }
    }),
  )
  if (files.size === 0) return null

  const folders = new Set<string>()
  for (const rel of files.keys()) {
    let dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    while (dir) {
      folders.add(dir)
      const cut = dir.lastIndexOf('/')
      dir = cut > 0 ? dir.slice(0, cut) : ''
    }
  }

  let createdCount = 0
  for (const kind of files.values()) {
    if (kind === 'created') createdCount++
  }

  return {
    sessionKey: latest.sessionKey,
    topic: latest.topic,
    startedMs: latest.startedMs,
    endedMs: latest.endedMs,
    files,
    folders,
    createdCount,
    editedCount: files.size - createdCount,
  }
}

/**
 * Latest-session telemetry for the explorer (dots + count strip). Null when no
 * recent session wrote into the vault. Safe to poll — concurrent callers share
 * one load, and an unchanged result keeps its previous object identity.
 */
export async function loadSessionTelemetry(
  options: { force?: boolean } = {},
): Promise<SessionTelemetry | null> {
  const { force = false } = options

  if (!force && _snapshot && Date.now() - _snapshot.ts < SNAPSHOT_TTL_MS) {
    return _snapshot.value
  }
  if (!force && _inflight) return _inflight
  if (force) {
    _snapshot = null
    _inflight = null
  }

  const promise = performLoad()
    .then(value => {
      const previous = _snapshot?.value ?? null
      const next = sameTelemetry(previous, value) ? previous : value
      _snapshot = { value: next, ts: Date.now() }
      _inflight = null
      return next
    })
    .catch(err => {
      _inflight = null
      throw err
    })

  _inflight = promise
  return promise
}
