// Session-telemetry workflow — resolves every recent vault-touching AI session
// into explorer-ready telemetry: which files each one created vs edited, the
// folders above them, and the counts for the strip over the file tree, plus a
// combined view across all of them (several agents usually run at once).
// Created-vs-edited comes from each file's ctime falling inside the session
// span, so no parser or cache-shape change is needed. Snapshot + in-flight
// dedupe mirror vaultGraphOrch; the snapshot also preserves object identity
// across reloads when nothing changed, so polling hooks don't re-render for free.
//
// Live: the AI Activity snapshot is up to 5 minutes old, and forcing it would
// walk the whole vault and rewrite its cache file into iCloud on every save.
// Instead, each load re-parses only the native transcripts whose mtime moved
// past that snapshot — in practice the one or two agents still running — and
// an external vault write (an agent saving a note) triggers a load, so the
// strip follows the agent within a couple of seconds. Event-driven: no timer
// runs unless the vault actually changes (Energy contract).

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { selectRecentVaultSessionsBlock, SESSION_TELEMETRY_MAX_AGE_MS } from '@/services/lego_blocks/integrations/sessionTelemetryBlock'
import {
  listNativeAiSessions,
  loadAndParseNativeAiSession,
  nativeAiSourcesAvailable,
} from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'
import { subscribeExternalVaultChangesBlock } from '@/services/lego_blocks/integrations/vaultExternalChangeBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

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

/** Transcripts re-parsed here because they changed after the AI Activity
 *  snapshot, keyed by `native/<source>/<relPath>` (the snapshot's base key). */
const _liveTranscripts = new Map<string, { mtime: number; sessions: ParsedSession[] }>()

const baseKey = (path: string) => path.split('#', 1)[0]

/**
 * The snapshot's sessions with every transcript that moved since it was taken
 * replaced by a fresh parse. Only recent transcripts are considered, and one
 * is parsed only when its mtime differs from both the snapshot and the last
 * live parse — so a quiet vault costs one directory listing.
 */
async function overlayLiveTranscripts(sessions: ParsedSession[], nowMs: number): Promise<ParsedSession[]> {
  if (!nativeAiSourcesAvailable()) return sessions

  const snapshotMtime = new Map<string, number>()
  for (const s of sessions) {
    if (s.path.startsWith('native/')) snapshotMtime.set(baseKey(s.path), Math.floor(s.mtime))
  }

  const cutoffSec = (nowMs - SESSION_TELEMETRY_MAX_AGE_MS) / 1000
  const entries = (await listNativeAiSessions()).filter(e => e.mtime >= cutoffSec)
  const live = new Set<string>()
  await Promise.all(entries.map(async entry => {
    const key = `native/${entry.source}/${entry.relPath}`
    const mtime = Math.floor(entry.mtime)
    if (snapshotMtime.get(key) === mtime) return
    live.add(key)
    if (_liveTranscripts.get(key)?.mtime === mtime) return
    const parsed = await loadAndParseNativeAiSession(entry)
    // A failed read keeps the last good parse rather than blanking the session.
    if (parsed.length > 0 || !_liveTranscripts.has(key)) {
      _liveTranscripts.set(key, { mtime, sessions: parsed })
    }
  }))
  // Once the snapshot catches up (or a transcript ages out), drop the overlay.
  for (const key of _liveTranscripts.keys()) {
    if (!live.has(key)) _liveTranscripts.delete(key)
  }
  if (_liveTranscripts.size === 0) return sessions

  const merged = sessions.filter(s => !_liveTranscripts.has(baseKey(s.path)))
  for (const { sessions: fresh } of _liveTranscripts.values()) merged.push(...fresh)
  return merged
}

async function performLoad(): Promise<SessionTelemetry | null> {
  const vaultRoot = getStoredVaultRoot() ?? ''
  if (!vaultRoot) return null
  const fs = getVaultFS()
  const nowMs = Date.now()
  const { sessions: snapshotSessions } = await loadAiActivity(fs)
  const sessions = await overlayLiveTranscripts(snapshotSessions, nowMs)
  const recent = selectRecentVaultSessionsBlock(sessions, vaultRoot, nowMs)
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

// ── Live updates ─────────────────────────────────────────────────────────────

/** Collapses an agent's burst of saves into one load. */
const CHANGE_DEBOUNCE_MS = 1_500
/** A save can land a beat before its tool call is flushed to the transcript;
 *  one follow-up load catches a write the first one could not yet attribute. */
const CHANGE_FOLLOWUP_MS = 5_000

type TelemetryListener = (value: SessionTelemetry | null) => void
const _listeners = new Set<TelemetryListener>()
let _unsubscribeVault: (() => void) | null = null
let _debounceTimer: ReturnType<typeof setTimeout> | null = null
let _followupTimer: ReturnType<typeof setTimeout> | null = null

function publish(): void {
  void loadSessionTelemetry({ force: true })
    .then(value => { for (const listener of _listeners) listener(value) })
    .catch(() => undefined)
}

function onVaultChange(): void {
  if (_debounceTimer !== null) clearTimeout(_debounceTimer)
  if (_followupTimer !== null) clearTimeout(_followupTimer)
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null
    publish()
    _followupTimer = setTimeout(() => {
      _followupTimer = null
      publish()
    }, CHANGE_FOLLOWUP_MS)
  }, CHANGE_DEBOUNCE_MS)
}

/**
 * Push telemetry to `listener` whenever something outside the app writes into
 * the vault. One vault subscription is shared by every listener and released
 * with the last one.
 */
export function subscribeSessionTelemetry(listener: TelemetryListener): () => void {
  _listeners.add(listener)
  if (!_unsubscribeVault) _unsubscribeVault = subscribeExternalVaultChangesBlock(onVaultChange)
  return () => {
    _listeners.delete(listener)
    if (_listeners.size > 0) return
    _unsubscribeVault?.()
    _unsubscribeVault = null
    if (_debounceTimer !== null) clearTimeout(_debounceTimer)
    if (_followupTimer !== null) clearTimeout(_followupTimer)
    _debounceTimer = null
    _followupTimer = null
  }
}
