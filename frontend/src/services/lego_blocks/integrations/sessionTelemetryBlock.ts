// Latest-session selection for explorer telemetry — which vault files the most
// recent AI session actually wrote. File-edit provenance only (`touchedPaths`
// from Edit/Write tool calls): a wrong dot costs trust faster than a missing
// one, so chat sessions and GC'd transcripts (time-window guesses) contribute
// nothing here. Pure selection over already-parsed sessions; the orchestrator
// adds fs facts (ctime) to split created vs edited.

import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

export interface LatestVaultSession {
  /** Base transcript key (window suffixes stripped) — identity of "the session". */
  sessionKey: string
  /** First substantive topic of the session's earliest window. */
  topic: string
  source: string
  startedMs: number
  endedMs: number
  /** Vault-relative paths the session wrote, unioned across its windows. */
  relPaths: string[]
}

/** Dots are live telemetry, not an inbox: a session older than this shows
 *  nothing (AI Activity is the durable record). */
export const SESSION_TELEMETRY_MAX_AGE_MS = 12 * 60 * 60 * 1000

function toRelPath(absPath: string, vaultRoot: string): string | null {
  const root = vaultRoot.replace(/\/+$/, '')
  if (root && absPath.startsWith(`${root}/`)) return absPath.slice(root.length + 1)
  return null
}

/**
 * Pick the most recently ended session that wrote at least one file inside the
 * vault. A transcript's idle-gap windows (`path`, `path#w1`, …) are regrouped
 * into one session — their touchedPaths are disjoint by timestamp, so the
 * union is exactly the transcript's edits.
 */
export function selectLatestVaultSessionBlock(
  sessions: ParsedSession[],
  vaultRoot: string,
  nowMs: number,
): LatestVaultSession | null {
  if (!vaultRoot) return null

  interface Group {
    startedMs: number
    endedMs: number
    topic: string
    source: string
    relPaths: Set<string>
  }
  const groups = new Map<string, Group>()

  for (const session of sessions) {
    const touched = session.touchedPaths
    if (!touched || touched.length === 0) continue
    const relPaths = touched
      .map(p => toRelPath(p, vaultRoot))
      .filter((p): p is string => p !== null)
    if (relPaths.length === 0) continue

    const startedMs = Date.parse(session.startedIso)
    if (!Number.isFinite(startedMs)) continue
    const endedParsed = session.endedIso ? Date.parse(session.endedIso) : NaN
    const endedMs = Number.isFinite(endedParsed) ? Math.max(startedMs, endedParsed) : startedMs

    const key = session.path.split('#', 1)[0]
    const group = groups.get(key)
    if (!group) {
      groups.set(key, {
        startedMs,
        endedMs,
        topic: session.topic,
        source: session.source,
        relPaths: new Set(relPaths),
      })
      continue
    }
    if (startedMs < group.startedMs) {
      group.startedMs = startedMs
      group.topic = session.topic
    }
    group.endedMs = Math.max(group.endedMs, endedMs)
    for (const rel of relPaths) group.relPaths.add(rel)
  }

  let bestKey: string | null = null
  let best: Group | null = null
  for (const [key, group] of groups) {
    if (nowMs - group.endedMs > SESSION_TELEMETRY_MAX_AGE_MS) continue
    if (!best || group.endedMs > best.endedMs) {
      bestKey = key
      best = group
    }
  }
  if (!best || bestKey === null) return null

  return {
    sessionKey: bestKey,
    topic: best.topic,
    source: best.source,
    startedMs: best.startedMs,
    endedMs: best.endedMs,
    relPaths: [...best.relPaths],
  }
}
