// User-authored manual sessions: time blocks the user logs by hand ("painting
// 4h today") so non-AI work has a durable place in the AI-activity record and
// shows up on the timeline / per-project totals. Stored as JSONL in the vault
// (ai-activity/manual-sessions.jsonl); this block only defines the record shape
// and its projection into the shared ParsedSession pipeline.

import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

export interface ManualSessionRecord {
  /** Stable id (uuid) — dedup key + edit/delete handle. */
  key: string
  /** Project bucket — reused as the activity label (e.g. "Painting"). */
  project: string
  /** Short label shown in the Topic column. */
  topic: string
  /** Optional longer note kept for the durable record; shown when expanded. */
  note?: string
  /** Wall-clock start / end, epoch ms. */
  startMs: number
  endMs: number
  /** When the record was created/last edited, epoch ms. */
  recordedAt: number
}

/** Project new records into the shared session shape. Manual sessions carry no
 *  tokens/messages (userMsgCount 0) and set hadClear so buildChains keeps each
 *  logged block as its own chain (one row per entry) instead of merging two
 *  same-project logs that happen to fall within the idle gap. */
export function manualRecordToSession(rec: ManualSessionRecord): ParsedSession | null {
  if (!Number.isFinite(rec.startMs) || rec.startMs <= 0) return null
  const dur = Math.max(0, rec.endMs - rec.startMs)
  const project = (rec.project ?? '').trim() || 'Logged'
  const topic = (rec.topic ?? '').trim() || project
  return {
    path: `manual/${rec.key}`,
    source: 'manual',
    startedIso: new Date(rec.startMs).toISOString(),
    endedIso: new Date(rec.startMs + dur).toISOString(),
    project,
    userMsgCount: 0,
    topic,
    hadClear: true,
    mtime: Math.floor((rec.recordedAt || rec.startMs) / 1000),
    sessionId: rec.key,
  }
}

export function parseManualSessionLog(records: ManualSessionRecord[]): ParsedSession[] {
  const out: ParsedSession[] = []
  for (const rec of records) {
    const s = manualRecordToSession(rec)
    if (s) out.push(s)
  }
  return out
}
