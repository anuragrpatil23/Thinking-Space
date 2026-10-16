// Session-telemetry workflow — resolves every recent vault-touching AI session
// into explorer-ready telemetry: which files each one created vs edited, the
// folders above them, and the counts for the strip over the file tree, plus a
// combined view across all of them (several agents usually run at once).
// Created-vs-edited comes from each file's ctime falling inside the session
// span, so no parser or cache-shape change is needed. Snapshot + in-flight
// dedupe mirror vaultGraphOrch; the snapshot also preserves object identity
// across reloads when nothing changed, so polling hooks don't re-render for free.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { selectRecentVaultSessionsBlock } from '@/services/lego_blocks/integrations/sessionTelemetryBlock'

export type SessionTouch = 'created' | 'edited'

/** What the explorer paints: dots, folder dots, counts, filter set. */
export interface SessionTelemetryView {
  /** Vault-relative file → how the session(s) touched it. */
  files: ReadonlyMap<string, SessionTouch>
  /** Every ancestor folder of a touched file (vault-relative; root excluded). */
  folders: ReadonlySet<string>
  createdCount: number
  editedCount: number
}

export interface SessionTelemetrySession extends SessionTelemetryView {
  /** Base transcript key — identity of "the session" the dots describe. */
  sessionKey: string
  topic: string
  source: string
  startedMs: number
  endedMs: number
}

export interface SessionTelemetry {
  /** Recent sessions that still have touched files on disk, most recently active first. */
  sessions: SessionTelemetrySession[]
  /** Union of every session — a file any session created counts as created. */
  all: SessionTelemetryView
}

/** Saves land shortly after tool calls; ctime gets the same slack the graph
 *  gives session windows. */
const CTIME_SLACK_MS = 5 * 60_000

const SNAPSHOT_TTL_MS = 60_000

let _snapshot: { value: SessionTelemetry | null; ts: number } | null = null
let _inflight: Promise<SessionTelemetry | null> | null = null

function sameTelemetry(a: SessionTelemetry | null, b: SessionTelemetry | null): boolean {
  if (a === null || b === null) return a === b
  if (a.sessions.length !== b.sessions.length) return false
  return a.sessions.every((sa, i) => {
    const sb = b.sessions[i]
    if (sa.sessionKey !== sb.sessionKey || sa.endedMs !== sb.endedMs || sa.files.size !== sb.files.size) {
      return false
    }
    for (const [path, kind] of sb.files) {
      if (sa.files.get(path) !== kind) return false
    }
    return true
  })
}

function buildView(files: Map<string, SessionTouch>): SessionTelemetryView {
  const folders = new Set<string>()
  let createdCount = 0
  for (const [rel, kind] of files) {
    if (kind === 'created') createdCount++
    let dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    while (dir) {
      folders.add(dir)
      const cut = dir.lastIndexOf('/')
      dir = cut > 0 ? dir.slice(0, cut) : ''
    }
  }
  return { files, folders, createdCount, editedCount: files.size - createdCount }
}

async function performLoad(): Promise<SessionTelemetry | null> {
  const vaultRoot = getStoredVaultRoot() ?? ''
  if (!vaultRoot) return null
  const fs = getVaultFS()
  const { sessions } = await loadAiActivity(fs)
  const recent = selectRecentVaultSessionsBlock(sessions, vaultRoot, Date.now())
  if (recent.length === 0) return null

  // Concurrent sessions often touch the same notes — stat each path once.
  // Null = gone or a directory: no row left to mark.
  const ctimes = new Map<string, Promise<number | null>>()
  const ctimeOf = (rel: string): Promise<number | null> => {
    let pending = ctimes.get(rel)
    if (!pending) {
      pending = fs.stat(rel).then(
        stat => (stat.isDirectory ? null : (stat.ctime ?? 0) * 1000),
        () => null,
      )
      ctimes.set(rel, pending)
    }
    return pending
  }

  const resolved = await Promise.all(
    recent.map(async (session): Promise<SessionTelemetrySession | null> => {
      const files = new Map<string, SessionTouch>()
      await Promise.all(
        session.relPaths.map(async rel => {
          const ctimeMs = await ctimeOf(rel)
          if (ctimeMs === null) return
          const created =
            ctimeMs >= session.startedMs - CTIME_SLACK_MS && ctimeMs <= session.endedMs + CTIME_SLACK_MS
          files.set(rel, created ? 'created' : 'edited')
        }),
      )
      if (files.size === 0) return null
      return {
        sessionKey: session.sessionKey,
        topic: session.topic,
        source: session.source,
        startedMs: session.startedMs,
        endedMs: session.endedMs,
        ...buildView(files),
      }
    }),
  )
  const live = resolved.filter((s): s is SessionTelemetrySession => s !== null)
  if (live.length === 0) return null

  const union = new Map<string, SessionTouch>()
  for (const session of live) {
    for (const [rel, kind] of session.files) {
      if (kind === 'created' || !union.has(rel)) union.set(rel, kind)
    }
  }

  return { sessions: live, all: buildView(union) }
}

/**
 * Recent-session telemetry for the explorer (dots + count strip). Null when no
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
