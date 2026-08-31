// Convert in-app reading/drawing spans (TS markdown + Excalidraw) into the
// shared ParsedSession shape so they flow through the same chain / totals /
// trend / heatmap / digest pipeline as the AI and memorization sources.
//
// A span is emitted by MarkdownDocumentBlock when a sitting ends, carrying
// *measured attention* (`activeMs`) rather than how long the document was
// open — see readingAttentionBlock for how that is accounted. The document
// title is the bucket so the panel groups by what was read/drawn; the record's
// `source` ('reading-md' | 'reading-draw') drives the sub-source pill.

import type {
  ActivitySource,
  ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'

export type ThinkingspaceReadingSource = Extract<ActivitySource, 'reading-md' | 'reading-draw'>

/** How a span's duration came to be known. The distinction is the point of the
 *  record: a number the app observed and a number a person asserted must never
 *  be indistinguishable once written down. */
export type ThinkingspaceReadingMethod = 'measured' | 'declared'

export interface ThinkingspaceReadingRecord {
  /** Unique, idempotent key: `${source}|${filePath}|${startMs}`. */
  key: string
  source: ThinkingspaceReadingSource
  /** Vault-relative path of the document read/drawn. */
  filePath: string
  /** Display title (best-effort, derived from the filename at emit time). */
  title: string
  /** 'measured' — the app observed it. 'declared' — a person asserted it. */
  method: ThinkingspaceReadingMethod
  /** Wall-clock start of the sitting, epoch ms. Says WHEN, not how much. */
  startMs: number
  /** Wall-clock end of the sitting, epoch ms. Says WHEN, not how much. */
  endMs: number
  /**
   * Measured attention within the sitting, ms — the duration every view uses.
   *
   * Kept separate from `endMs - startMs` on purpose. The wall-clock span says
   * when you sat down and got up; this says how much of that was actually
   * spent on the document. Collapsing them at write time would throw away the
   * ratio between the two, which is a free signal (how distracted a sitting
   * was) that cannot be recovered later.
   */
  activeMs: number
  /** When the record was appended, epoch ms. */
  recordedAt: number
  /** Deepest point reached, as a fraction of scrollable height. Markdown only
   *  — a canvas has no extent to be a fraction of. */
  maxScrollRatio?: number
  /** Where the sitting ended, as a fraction of scrollable height. Together
   *  with maxScrollRatio this answers "did I bounce off, and where" without
   *  any block-level anchoring. Markdown only. */
  endScrollRatio?: number
  /** Optional "pages read" count for declared spans. Defaults to 1 when
   *  missing. Surfaced as the row's msg count in the panel. */
  pages?: number
}

/** Derive a readable title from a vault path, stripping the markdown/excalidraw
 *  extensions. Used at emit time when no better title is on hand. */
export function readingTitleFromPathBlock(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.excalidraw\.md$/i, '').replace(/\.(excalidraw|md)$/i, '').trim() || filePath
}

/**
 * Convert one span into a ParsedSession. Returns null for unusable records.
 *
 * The session's duration is `activeMs`, so a 40-minute sitting with 25 minutes
 * of attention renders as 25 minutes anchored at the sitting's start. There is
 * no duration cap: a cap exists to clamp a number you don't trust, and an
 * attention total is bounded by its own accounting.
 */
export function readingRecordToSession(rec: ThinkingspaceReadingRecord): ParsedSession | null {
  const startMs = rec.startMs
  if (!Number.isFinite(startMs) || startMs <= 0) return null
  const activeMs = Number.isFinite(rec.activeMs) ? Math.max(0, rec.activeMs) : 0
  if (activeMs <= 0) return null
  const title = (rec.title ?? '').trim() || readingTitleFromPathBlock(rec.filePath)
  return {
    path: `${rec.source}/${rec.filePath}#${startMs}`,
    source: rec.source,
    startedIso: new Date(startMs).toISOString(),
    endedIso: new Date(startMs + activeMs).toISOString(),
    project: title,
    userMsgCount: Math.max(1, Math.round(rec.pages ?? 0) || 1),
    topic: title,
    hadClear: false,
    mtime: Math.floor((rec.recordedAt || startMs) / 1000),
    sessionId: rec.key,
  }
}

export function parseThinkingspaceReadingLog(
  records: ThinkingspaceReadingRecord[],
): ParsedSession[] {
  const out: ParsedSession[] = []
  for (const rec of records) {
    const s = readingRecordToSession(rec)
    if (s) out.push(s)
  }
  return out
}
