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
import type { CanvasStationBlock } from '@/services/lego_blocks/units/canvasAttentionBlock'

export type ThinkingspaceReadingSource = Extract<ActivitySource, 'reading-md' | 'reading-draw'>

/** How a span's duration came to be known. The distinction is the point of the
 *  record: a number the app observed and a number a person asserted must never
 *  be indistinguishable once written down. */
export type ThinkingspaceReadingMethod = 'measured' | 'declared'

/**
 * Where within the document the attention went. A tagged union rather than a
 * bag of optional fields, so each surface contributes the granularity it can
 * actually support and a new surface adds a variant instead of more `?:`.
 *
 * The two are the same idea at different dimensions: a document has an extent,
 * so a position in it is one number; a canvas has none, so a position is a
 * rectangle. `scroll` is the degenerate case of `canvas`, not a special case.
 */
export type ThinkingspaceReadingWhere =
  | {
      kind: 'scroll'
      /** Deepest point reached, as a fraction of scrollable height. */
      max: number
      /** Where the sitting ended. With `max`, this answers "did I bounce off,
       *  and where" with no block-level anchoring at all. */
      end?: number
    }
  | {
      kind: 'canvas'
      stations: CanvasStationBlock[]
    }

export interface ThinkingspaceReadingRecord {
  /**
   * Dedup identity for this *sitting*: `${source}|${filePath}|${startMs}`.
   *
   * Not the document's identity — see `uuid`. The trailing field is the
   * sitting's original start, which is how the store finds the day file a
   * record lives in even after an edit moves its window.
   */
  key: string
  source: ThinkingspaceReadingSource
  /** Vault-relative path of the document read/drawn. A *hint*: it moves when
   *  the file is renamed, which is exactly why it is not the identity. */
  filePath: string
  /**
   * Identity of the document, from its YAML frontmatter, when it has one.
   *
   * Survives renames and moves, so history filed under it does not split when
   * a note is reorganised. Cannot be required: in this vault 88 of 91
   * Excalidraw documents carry a uuid but only ~24% of markdown does, so it is
   * a strengthening where available and readers fall back to `filePath`.
   */
  uuid?: string
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
  /** Where within the document the attention went. Absent when the surface
   *  could not say. */
  where?: ThinkingspaceReadingWhere
  /** Optional "pages read" count for declared spans. Defaults to 1 when
   *  missing. Surfaced as the row's msg count in the panel. */
  pages?: number
}

/** The sitting's original start, recovered from its key. The key's last field
 *  is that timestamp, and reading it from the right survives a `|` inside a
 *  vault path. Returns null for a key that isn't ours. */
export function readingRecordStartFromKeyBlock(key: string): number | null {
  const at = key.lastIndexOf('|')
  if (at === -1) return null
  const parsed = Number(key.slice(at + 1))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Which of two records for the same sitting to keep.
 *
 * Not "first one wins": the in-progress span is flushed when the app hides so
 * that quitting cannot lose it, and the real close then re-emits the same key
 * with more attention on it. The longer measurement is the more complete one.
 *
 * A declared record is never replaced. A person correcting a number outranks
 * any later automatic emit — the same precedence ASSIGNMENT.md sets between
 * what automation proposes and what a human mints.
 */
export function mergeReadingRecordsBlock(
  existing: ThinkingspaceReadingRecord,
  incoming: ThinkingspaceReadingRecord,
): ThinkingspaceReadingRecord {
  if (existing.method === 'declared') return existing
  if (incoming.method === 'declared') return incoming
  return incoming.activeMs > existing.activeMs ? incoming : existing
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
