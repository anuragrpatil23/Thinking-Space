// Mirror Apple Screen Time streams from knowledgeC.db into the vault.
//
// macOS purges knowledgeC.db rows after ~28 days. To keep history forever we
// append every event we see to per-day JSONLs in the vault:
//
//   ai-activity/raw-sessions/apple_screen_time/<sanitized_stream>/YYYY-MM-DD.jsonl
//
// Each JSONL line is one event. Files are written in append-only fashion;
// once a UTC day rolls over, that day's file is sealed and never touched
// again. Dedup uses Z_PK (auto-increment, never reused), so re-running the
// dumper is idempotent — the cursor is `max(Z_PK)` already on disk for that
// stream, scanned across the small set of recent per-day files.
//
// First run on a fresh machine backfills the whole ~28-day window in one
// shot (cursor starts at 0). Subsequent runs are O(new rows only).

import * as fsPromises from 'fs/promises';
import * as path from 'path';

import {
  appleScreenTimeAvailableBlock,
  readStreamBlock,
  type AppleScreenTimeEvent,
} from './appleScreenTimeBlock';

/** Vault-relative root for all Apple Screen Time mirrors. */
const VAULT_ROOT_REL = path.join('ai-activity', 'raw-sessions', 'apple_screen_time');

/** Streams the dumper mirrors by default. High-signal, low-noise.
 *  Skipped intentionally: /display/isBacklit, /device/batteryPercentage —
 *  both fire constantly and we don't have a use for them yet. */
export const DEFAULT_TRACKED_STREAMS: readonly string[] = [
  '/app/usage',
  '/app/inFocus',
  '/app/webUsage',
  '/safari/history',
  '/audio/nowPlaying',
  '/device/isLocked',
];

export interface StreamDumpResult {
  stream: string;
  /** How many new events were appended this run. */
  added: number;
  /** The Z_PK cursor used as the lower bound for this run. */
  sinceZpk: number;
  /** The new high-water mark after this run. */
  newCursor: number;
  /** True when FDA was denied for this run. */
  needsFullDiskAccess?: boolean;
}

export interface AppleScreenTimeHarvestResult {
  perStream: StreamDumpResult[];
  /** True when the Knowledge DB isn't on disk (non-macOS or fresh install). */
  unavailable?: boolean;
  /** True when any stream's read was denied (FDA not granted). */
  needsFullDiskAccess?: boolean;
}

// ── Path helpers ────────────────────────────────────────────────────────────

/** "/app/usage" → "app_usage". Lowercases + replaces slashes with underscores
 *  + strips the leading slash so the segment is a clean directory name. */
function sanitizeStreamName(stream: string): string {
  return stream.replace(/^\/+/, '').replace(/\//g, '_').toLowerCase();
}

function streamDir(vaultRoot: string, stream: string): string {
  const resolved = path.resolve(
    vaultRoot,
    VAULT_ROOT_REL,
    sanitizeStreamName(stream),
  );
  const rootResolved = path.resolve(vaultRoot);
  if (!resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Apple Screen Time dump path escaped the vault root');
  }
  return resolved;
}

/** Day-bucket an event by its START time in UTC. We use UTC (not local TZ) so
 *  the file split is stable across DST transitions and travel — the renderer
 *  groups by local date when displaying. */
function dayKeyFor(event: AppleScreenTimeEvent): string {
  const ms = event.startMs > 0 ? event.startMs : event.creationMs;
  if (ms <= 0) return '0000-00-00';
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Cursor: max Z_PK already on disk for one stream ─────────────────────────

/** Walk the per-day files for a stream and return the highest Z_PK previously
 *  written. Returns 0 when the stream has never been dumped (first run). The
 *  scan is bounded to a handful of recent files even on a long-lived vault. */
async function readCursorBlock(vaultRoot: string, stream: string): Promise<number> {
  const dir = streamDir(vaultRoot, stream);
  let files: string[];
  try {
    files = (await fsPromises.readdir(dir)).filter(f => f.endsWith('.jsonl'));
  } catch {
    return 0;
  }
  if (files.length === 0) return 0;
  // Sort newest-first; the latest day holds the max Z_PK since insertion order
  // matches chronological order (Z_PK is auto-increment). We still fall back
  // to the previous file if the latest happens to be empty.
  files.sort().reverse();
  let max = 0;
  for (const f of files) {
    let raw: string;
    try {
      raw = await fsPromises.readFile(path.join(dir, f), 'utf-8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as { zpk?: number };
        if (typeof rec.zpk === 'number' && rec.zpk > max) max = rec.zpk;
      } catch {
        // Skip corrupt line.
      }
    }
    if (max > 0) return max; // found in the latest non-empty file — good enough
  }
  return max;
}

// ── Dump driver ─────────────────────────────────────────────────────────────

async function appendDayFile(
  dir: string,
  day: string,
  events: AppleScreenTimeEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await fsPromises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${day}.jsonl`);
  const payload = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  await fsPromises.appendFile(file, payload, 'utf-8');
}

async function dumpStream(
  vaultRoot: string,
  stream: string,
): Promise<StreamDumpResult> {
  const cursor = await readCursorBlock(vaultRoot, stream);
  const res = await readStreamBlock(stream, { sinceZpk: cursor });
  if (res.needsFullDiskAccess) {
    return {
      stream,
      added: 0,
      sinceZpk: cursor,
      newCursor: cursor,
      needsFullDiskAccess: true,
    };
  }
  if (res.events.length === 0) {
    return { stream, added: 0, sinceZpk: cursor, newCursor: cursor };
  }
  // Group by UTC day so each per-day file is written with one appendFile call.
  const byDay = new Map<string, AppleScreenTimeEvent[]>();
  let max = cursor;
  for (const evt of res.events) {
    const day = dayKeyFor(evt);
    const bucket = byDay.get(day) ?? [];
    bucket.push(evt);
    byDay.set(day, bucket);
    if (evt.zpk > max) max = evt.zpk;
  }
  const dir = streamDir(vaultRoot, stream);
  // Write in chronological day order so a fresh tail-follower sees events in
  // their natural sequence.
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    await appendDayFile(dir, day, byDay.get(day)!);
  }
  return { stream, added: res.events.length, sinceZpk: cursor, newCursor: max };
}

// Per-vault inflight lock — multiple triggers (app launch, panel open) share
// one in-flight harvest rather than racing the append/cursor logic.
const inflight = new Map<string, Promise<AppleScreenTimeHarvestResult>>();

/**
 * Harvest every tracked stream into the vault. Idempotent — safe to call from
 * launch and panel mount; the inflight lock dedupes concurrent calls.
 */
export async function harvestAppleScreenTimeBlock(
  vaultRoot: string,
  streams: readonly string[] = DEFAULT_TRACKED_STREAMS,
): Promise<AppleScreenTimeHarvestResult> {
  if (!vaultRoot) return { perStream: [] };
  if (!appleScreenTimeAvailableBlock()) {
    return { perStream: [], unavailable: true };
  }
  const existing = inflight.get(vaultRoot);
  if (existing) return existing;
  const run = (async () => {
    const perStream: StreamDumpResult[] = [];
    for (const stream of streams) {
      try {
        perStream.push(await dumpStream(vaultRoot, stream));
      } catch {
        perStream.push({ stream, added: 0, sinceZpk: 0, newCursor: 0 });
      }
    }
    const needsFullDiskAccess = perStream.some(s => s.needsFullDiskAccess);
    return { perStream, needsFullDiskAccess };
  })().finally(() => { inflight.delete(vaultRoot); });
  inflight.set(vaultRoot, run);
  return run;
}
