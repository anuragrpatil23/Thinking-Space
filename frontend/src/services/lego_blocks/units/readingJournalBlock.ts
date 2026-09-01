// Write-ahead journal for the sitting currently being measured.
//
// Attention used to live in a ref until the sitting ended, with exactly one
// chance to persist it. Anything that interrupted that moment — an iOS
// WebContent memory kill (docs/contracts/IOS-MEMORY.md treats those as the
// default explanation for an iOS-only death, and they arrive with no JS error),
// a force-quit, a suspension mid-write, a crash — discarded the whole sitting.
// Forty-five minutes of reading held in memory with one shot at durability is
// the same mistake DURABILITY.md already names for text: typed text is never
// only in the buffer, in any save mode. Neither is attention.
//
// So the vault write stops being the only path and becomes a *drain*. The
// in-progress span is checkpointed to localStorage — synchronous, no bridge, no
// I/O round trip, survives suspension and termination — and whatever is still
// sitting there on the next launch gets written to the vault then. A crash now
// costs the last few seconds instead of the whole sitting.
//
// localStorage is the right store precisely because it is synchronous: the
// Capacitor filesystem is several async bridge hops, which is exactly what
// cannot be relied on at the moment the OS is taking the app away.

import type { ThinkingspaceReadingRecord } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const JOURNAL_KEY = 'ltm-reading-journal'

/** Checkpoint at most this often. A crash losing ten seconds of attention is
 *  not worth a synchronous write on every signal; losing a sitting is. */
export const JOURNAL_CHECKPOINT_INTERVAL_MS = 10_000

/** Keep the journal small. Entries only survive a failure to drain, so a large
 *  backlog means something is wrong — dropping the oldest is better than
 *  growing without bound in a store with a hard quota. */
const MAX_ENTRIES = 40

function readRaw(): Record<string, ThinkingspaceReadingRecord> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(JOURNAL_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, ThinkingspaceReadingRecord>
  } catch {
    return {}
  }
}

function writeRaw(map: Record<string, ThinkingspaceReadingRecord>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(map))
  } catch {
    // A full or unavailable store must not break reading. The vault write is
    // still attempted at the end of the sitting; this only stops being a
    // safety net.
  }
}

/**
 * Record (or update) the in-progress span. Keyed by the span's own key, so
 * checkpointing the same sitting repeatedly overwrites rather than accumulates.
 */
export function checkpointReadingJournalBlock(record: ThinkingspaceReadingRecord): void {
  const map = readRaw()
  map[record.key] = record
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    // Oldest by start time, not by insertion — insertion order is not
    // meaningful once entries have been rewritten in place.
    const doomed = keys
      .sort((a, b) => (map[a]?.startMs ?? 0) - (map[b]?.startMs ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
    for (const key of doomed) delete map[key]
  }
  writeRaw(map)
}

/** Forget a span — called once the vault has it. */
export function clearReadingJournalEntryBlock(key: string): void {
  const map = readRaw()
  if (!(key in map)) return
  delete map[key]
  writeRaw(map)
}

/** Every span still awaiting a durable write, oldest first. */
export function readReadingJournalBlock(): ThinkingspaceReadingRecord[] {
  return Object.values(readRaw())
    .filter(r => r && typeof r.key === 'string' && Number.isFinite(r.activeMs))
    .sort((a, b) => a.startMs - b.startMs)
}

export function clearReadingJournalBlock(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(JOURNAL_KEY)
  } catch {
    // Nothing to do.
  }
}
