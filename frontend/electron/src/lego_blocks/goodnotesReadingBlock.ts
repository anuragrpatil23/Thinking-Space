// Attribute GoodNotes reading sessions from the Apple Screen Time mirror.
//
// Source of truth: the per-day `ai-activity/raw-sessions/apple_screen_time/app_usage/*.jsonl`
// files written by the Screen Time dumper. We filter to GoodNotes' bundle id,
// then for each focus session find the doc whose `document_meta.last_modified`
// (from GoodNotes' fts.sqlite) falls inside the focus window. The latest
// matching doc wins; sessions with no matching annotation are recorded under
// a synthetic "(reading — unattributed)" bucket so app-time stays visible
// without poisoning per-book stats.
//
// We also synthesize *phantom-iPad* sessions: when fts.sqlite's `last_modified`
// for a doc advances and no Mac focus session covers that timestamp, the
// reading happened on iPad (which iCloud-syncs the file but not its app_usage
// events to this Mac). We emit a default-30min phantom row ending at
// `last_modified`; the user can adjust it via the edit modal.
//
// Output: `ai-activity/raw-sessions/goodnotes/reading.jsonl` with monotonic-cursor
// append-only semantics — once a row is in the file, the harvester never
// touches it. A sidecar `.harvest-cursor.json` tracks the highest `Z_PK`
// ingested and the latest `last_modified` per doc, so re-runs are idempotent
// and the user's edits / deletions in the JSONL stay put.
//
// Read-only against GoodNotes' fts.sqlite and the dumped JSONL. The only
// write targets are the vault's reading.jsonl and its cursor sidecar.

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { appleScreenTimeAvailableBlock } from './appleScreenTimeBlock';

const execFileAsync = promisify(execFile);

const GOODNOTES_BUNDLE_ID = 'com.goodnotesapp.x';

const GOODNOTES_CONTAINER = path.join(
  os.homedir(),
  'Library',
  'Containers',
  'com.goodnotesapp.x',
  'Data',
);
const FTS_DB = path.join(GOODNOTES_CONTAINER, 'Library', 'Databases', 'fts.sqlite');

const APP_USAGE_DIR_REL = path.join('ai-activity', 'raw-sessions', 'apple_screen_time', 'app_usage');
const READING_LOG_RELPATH = path.join('ai-activity', 'raw-sessions', 'goodnotes', 'reading.jsonl');
const CURSOR_RELPATH = path.join('ai-activity', 'raw-sessions', 'goodnotes', '.harvest-cursor.json');

const UNATTRIBUTED_DOC_ID = 'goodnotes-unattributed';
const UNATTRIBUTED_TITLE = '(reading — unattributed)';

/** Bumped when the record shape on disk changes. A mismatched cursor sidecar
 *  triggers a one-time wipe of reading.jsonl so old-shape rows don't poison
 *  the parser. Beta product; no in-place migration. */
const SCHEMA_VERSION = 2;

/** A doc's last_modified within ±this many ms of a focus session is considered
 *  to have been annotated during that session. Covers clock drift between
 *  Screen Time's focus stamps and fts.sqlite's commit time. */
const ATTRIBUTION_GRACE_MS = 30_000;

/** Cap per-session duration for harvester-emitted screentime rows so a
 *  forgotten-foreground window doesn't dwarf real reading. User-edited rows
 *  bypass this cap (handled at parse time). */
const MAX_SESSION_MS = 90 * 60_000;

/** Default placeholder duration for a phantom-iPad session. The user is
 *  expected to extend (or shrink) it via the edit modal — 30 min is roughly
 *  the median real reading session and is short enough to feel obviously
 *  placeholder. */
const PHANTOM_DEFAULT_DURATION_MS = 30 * 60_000;

/** Skip emitting a new phantom for a doc when a recent phantom for the same
 *  doc ends within this window. Absorbs iCloud sync bursts that re-touch the
 *  same file several times in a few minutes. */
const PHANTOM_COALESCE_WINDOW_MS = 5 * 60_000;

export interface GoodnotesReadingRecord {
  key: string;
  documentId: string;
  title: string;
  /** Wall-clock session start, epoch ms. */
  startMs: number;
  /** Wall-clock session end, epoch ms. */
  endMs: number;
  /** Pages associated with the session — fts page count at harvest time, or
   *  the user-supplied value once edited. Minimum 1 surfaces in the UI. */
  pages: number;
  /** 'screentime' (Mac focus session) or 'phantom-ipad' (inferred from fts
   *  last_modified jump with no Mac focus). */
  documentType: string;
  harvestedAt: number;
  /** Latest fts.sqlite last_modified for the doc at emit time. */
  docModifiedMs: number;
  /** Flipped by the edit IPC. Parsers skip the duration cap when set. */
  userEdited?: boolean;
}

export interface GoodnotesHarvestResult {
  added: number;
  total: number;
  unavailable?: boolean;
  needsFullDiskAccess?: boolean;
}

export function goodnotesAvailableBlock(): boolean {
  try {
    return fs.existsSync(FTS_DB);
  } catch {
    return false;
  }
}

// ── Cursor sidecar ──────────────────────────────────────────────────────────

interface CursorState {
  schemaVersion: number;
  /** Highest Apple Screen Time Z_PK we've ingested. Z_PK is monotonic in
   *  insert order, so this is the right "skip everything before" boundary —
   *  late-arriving focus events get newer Z_PKs and are picked up correctly. */
  lastZpk: number;
  /** Latest fts.sqlite last_modified seen per documentId. Drives phantom-iPad
   *  dedup: only emit a phantom when last_modified advances past this. */
  lastDocModifiedMsById: Record<string, number>;
}

function emptyCursor(): CursorState {
  return { schemaVersion: SCHEMA_VERSION, lastZpk: 0, lastDocModifiedMsById: {} };
}

function cursorPath(vaultRoot: string): string {
  const resolved = path.resolve(vaultRoot, CURSOR_RELPATH);
  const rootResolved = path.resolve(vaultRoot);
  if (!resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Cursor sidecar path escaped the vault root');
  }
  return resolved;
}

async function readCursorBlock(vaultRoot: string): Promise<CursorState> {
  try {
    const raw = await fsPromises.readFile(cursorPath(vaultRoot), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CursorState>;
    const lastZpk = typeof parsed.lastZpk === 'number' ? parsed.lastZpk : 0;
    const lastDocModifiedMsById: Record<string, number> = {};
    if (parsed.lastDocModifiedMsById && typeof parsed.lastDocModifiedMsById === 'object') {
      for (const [k, v] of Object.entries(parsed.lastDocModifiedMsById)) {
        if (typeof v === 'number' && Number.isFinite(v)) lastDocModifiedMsById[k] = v;
      }
    }
    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0,
      lastZpk,
      lastDocModifiedMsById,
    };
  } catch {
    return emptyCursor();
  }
}

async function writeCursorBlock(vaultRoot: string, state: CursorState): Promise<void> {
  const p = cursorPath(vaultRoot);
  await fsPromises.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  await fsPromises.rename(tmp, p);
}

// ── fts.sqlite document metadata ────────────────────────────────────────────

interface DocMeta {
  documentId: string;
  name: string;
  /** last_modified as epoch ms (UTC). 0 when fts has the sentinel zero. */
  lastModifiedMs: number;
}

function parseFtsDateMs(s: string): number {
  const t = s.trim();
  if (!t || t.startsWith('1970-01-01')) return 0;
  const ms = Date.parse(`${t.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

async function readDocMetaBlock(): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  try {
    await fsPromises.access(FTS_DB);
  } catch {
    return out;
  }
  const sql =
    `SELECT document_id, COALESCE(name, ''), last_modified FROM document_meta ` +
    `WHERE is_deleted=0;`;
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-readonly', '-separator', '\x1f', `file:${FTS_DB}?immutable=1`, sql],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const a = line.indexOf('\x1f');
      if (a === -1) continue;
      const b = line.indexOf('\x1f', a + 1);
      if (b === -1) continue;
      const documentId = line.slice(0, a);
      const name = line.slice(a + 1, b);
      if (!documentId) continue;
      out.push({
        documentId,
        name,
        lastModifiedMs: parseFtsDateMs(line.slice(b + 1)),
      });
    }
  } catch {
    // sqlite3 missing / DB locked.
  }
  return out;
}

async function readPageCountsBlock(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    await fsPromises.access(FTS_DB);
  } catch {
    return counts;
  }
  const sql =
    `SELECT document_id, COUNT(*) FROM page_meta ` +
    `WHERE is_page_deleted=0 GROUP BY document_id;`;
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-readonly', '-separator', '\x1f', `file:${FTS_DB}?immutable=1`, sql],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const sep = line.indexOf('\x1f');
      if (sep === -1) continue;
      const id = line.slice(0, sep);
      const n = parseInt(line.slice(sep + 1), 10);
      if (id && Number.isFinite(n)) counts.set(id, n);
    }
  } catch {
    // sqlite3 missing / DB locked.
  }
  return counts;
}

// ── Read GoodNotes focus events from the Screen Time mirror ─────────────────

interface FocusSession {
  zpk: number;
  startMs: number;
  endMs: number;
}

/** Walk every per-day `app_usage` JSONL and yield the focus events for
 *  GoodNotes' bundle id. Returns events in arbitrary order — caller dedups. */
async function readGoodnotesFocusFromMirror(vaultRoot: string): Promise<FocusSession[]> {
  const dir = path.resolve(vaultRoot, APP_USAGE_DIR_REL);
  let files: string[];
  try {
    files = (await fsPromises.readdir(dir)).filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: FocusSession[] = [];
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
      let rec: { zpk?: number; startMs?: number; endMs?: number; valueString?: string | null };
      try {
        rec = JSON.parse(t);
      } catch {
        continue;
      }
      if (rec.valueString !== GOODNOTES_BUNDLE_ID) continue;
      const startMs = typeof rec.startMs === 'number' ? rec.startMs : 0;
      const endMs = typeof rec.endMs === 'number' ? rec.endMs : 0;
      const zpk = typeof rec.zpk === 'number' ? rec.zpk : 0;
      if (!zpk || endMs <= startMs) continue;
      out.push({ zpk, startMs, endMs });
    }
  }
  return out;
}

// ── reading.jsonl: load + rewrite ───────────────────────────────────────────

function readingLogPath(vaultRoot: string): string {
  const resolved = path.resolve(vaultRoot, READING_LOG_RELPATH);
  const rootResolved = path.resolve(vaultRoot);
  if (!resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Reading-log path escaped the vault root');
  }
  return resolved;
}

async function loadExistingBlock(
  logPath: string,
): Promise<{ records: GoodnotesReadingRecord[]; dirty: boolean }> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(logPath, 'utf-8');
  } catch {
    return { records: [], dirty: false };
  }
  const byKey = new Map<string, GoodnotesReadingRecord>();
  let dirty = false;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) {
      if (i !== lines.length - 1) dirty = true;
      continue;
    }
    let parsed: GoodnotesReadingRecord | null = null;
    try {
      parsed = JSON.parse(t) as GoodnotesReadingRecord;
    } catch {
      dirty = true;
    }
    if (!parsed || typeof parsed.key !== 'string' || !parsed.key) {
      dirty = true;
      continue;
    }
    // Reject rows that look like the pre-v2 shape ({timeMs, durationMs}) so the
    // wipe path below catches stragglers if the cursor sidecar was deleted by
    // hand. The check is a sniff, not strict validation.
    if (
      typeof parsed.startMs !== 'number'
      || typeof parsed.endMs !== 'number'
    ) {
      dirty = true;
      continue;
    }
    if (byKey.has(parsed.key)) {
      dirty = true;
      continue;
    }
    byKey.set(parsed.key, parsed);
  }
  return { records: [...byKey.values()], dirty };
}

async function rewriteLogBlock(
  logPath: string,
  records: GoodnotesReadingRecord[],
): Promise<void> {
  await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
  const tmp = `${logPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = records.length === 0
    ? ''
    : records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await fsPromises.writeFile(tmp, payload, 'utf-8');
  await fsPromises.rename(tmp, logPath);
}

// ── Attribution ─────────────────────────────────────────────────────────────

function attributeFocusSession(
  startMs: number,
  endMs: number,
  docMetas: DocMeta[],
): DocMeta | null {
  let best: DocMeta | null = null;
  const winStart = startMs - ATTRIBUTION_GRACE_MS;
  const winEnd = endMs + ATTRIBUTION_GRACE_MS;
  for (const d of docMetas) {
    if (d.lastModifiedMs <= 0) continue;
    if (d.lastModifiedMs < winStart || d.lastModifiedMs > winEnd) continue;
    if (!best || d.lastModifiedMs > best.lastModifiedMs) best = d;
  }
  return best;
}

// ── Harvest driver ──────────────────────────────────────────────────────────

const inflightHarvests = new Map<string, Promise<GoodnotesHarvestResult>>();

/** Serialize all writes (harvest + edits) per vault so the harvester and the
 *  edit IPC never race on reading.jsonl. */
const writeChainByVault = new Map<string, Promise<void>>();

function runSerialized<T>(vaultRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChainByVault.get(vaultRoot) ?? Promise.resolve();
  let result!: T;
  const next = prev
    .catch(() => undefined)
    .then(() => fn())
    .then(r => { result = r; });
  writeChainByVault.set(vaultRoot, next);
  return next.then(() => result);
}

/**
 * Re-derive `reading.jsonl` from the Apple Screen Time mirror + fts.sqlite.
 * Append-only past `lastZpk` (Mac focus) and `lastDocModifiedMsById[docId]`
 * (iPad phantom) — never rewrites existing rows. Safe to re-run.
 */
export async function harvestGoodnotesReadingBlock(
  vaultRoot: string,
): Promise<GoodnotesHarvestResult> {
  if (!vaultRoot) return { added: 0, total: 0 };
  if (!appleScreenTimeAvailableBlock() && !goodnotesAvailableBlock()) {
    return { added: 0, total: 0, unavailable: true };
  }
  const inflight = inflightHarvests.get(vaultRoot);
  if (inflight) return inflight;
  const run = runSerialized(vaultRoot, () => harvestGoodnotesReadingInner(vaultRoot))
    .finally(() => { inflightHarvests.delete(vaultRoot); });
  inflightHarvests.set(vaultRoot, run);
  return run;
}

async function harvestGoodnotesReadingInner(
  vaultRoot: string,
): Promise<GoodnotesHarvestResult> {
  const logPath = readingLogPath(vaultRoot);

  // Schema check: a missing/old-version cursor means the on-disk log is from
  // the pre-v2 shape (or we've never harvested here). Nuke and rebuild from
  // scratch — beta, no migration. The cursor goes back to zero so every
  // focus event and last_modified is re-ingested under the new shape.
  let cursor = await readCursorBlock(vaultRoot);
  if (cursor.schemaVersion !== SCHEMA_VERSION) {
    try { await fsPromises.rm(logPath, { force: true }); } catch { /* ignore */ }
    cursor = emptyCursor();
    await writeCursorBlock(vaultRoot, cursor);
  }

  const [focusSessions, docMetas, pageCounts, loaded] = await Promise.all([
    readGoodnotesFocusFromMirror(vaultRoot),
    readDocMetaBlock(),
    readPageCountsBlock(),
    loadExistingBlock(logPath),
  ]);

  const existing = loaded.records;
  if (loaded.dirty) {
    try {
      await rewriteLogBlock(logPath, existing);
    } catch {
      // Best-effort heal.
    }
  }

  const seen = new Set(existing.map(r => r.key));
  const titlesById = new Map(docMetas.map(d => [d.documentId, d.name] as const));
  const harvestedAt = Math.floor(Date.now() / 1000);

  const fresh: GoodnotesReadingRecord[] = [];
  let maxZpkSeen = cursor.lastZpk;
  /** docIds attributed to a Mac focus session this run — exempt from phantom
   *  emission even if their last_modified advanced (Mac saw the reading). */
  const attributedDocs = new Set<string>();

  for (const s of focusSessions) {
    if (s.zpk <= cursor.lastZpk) continue;
    if (s.zpk > maxZpkSeen) maxZpkSeen = s.zpk;
    const doc = attributeFocusSession(s.startMs, s.endMs, docMetas);
    const documentId = doc?.documentId ?? UNATTRIBUTED_DOC_ID;
    const key = `screentime|${s.zpk}|${documentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (doc) attributedDocs.add(doc.documentId);
    // Clamp the harvester-emitted duration; user-edited rows skip this cap at
    // parse time so a true 90-min+ session can land via the edit modal.
    const endMs = s.endMs;
    const startMs = Math.max(s.startMs, endMs - MAX_SESSION_MS);
    fresh.push({
      key,
      documentId,
      title: doc ? (titlesById.get(doc.documentId) ?? '') : UNATTRIBUTED_TITLE,
      startMs,
      endMs,
      pages: doc ? (pageCounts.get(doc.documentId) ?? 0) : 0,
      documentType: 'screentime',
      harvestedAt,
      docModifiedMs: doc?.lastModifiedMs ?? 0,
    });
  }

  // ── Phantom-iPad synthesis ─────────────────────────────────────────────
  //
  // A doc whose fts last_modified advanced past the cursor but has no Mac
  // focus attribution this run was read on iPad — iCloud synced the file but
  // app_usage events don't cross devices. Emit one placeholder row per
  // newly-advanced doc; the user adjusts the duration via the edit modal.

  const nextDocModifiedMsById = { ...cursor.lastDocModifiedMsById };
  // Existing phantoms inform the coalesce window: a sync-storm may have
  // already bumped last_modified once, emitting a phantom; a follow-up bump
  // a minute later shouldn't fan out into a second pill.
  const recentPhantomEndByDoc = new Map<string, number>();
  for (const r of existing) {
    if (r.documentType !== 'phantom-ipad') continue;
    const cur = recentPhantomEndByDoc.get(r.documentId) ?? 0;
    if (r.endMs > cur) recentPhantomEndByDoc.set(r.documentId, r.endMs);
  }

  for (const doc of docMetas) {
    if (doc.lastModifiedMs <= 0) continue;
    if (!doc.name) continue;
    const lastSeen = cursor.lastDocModifiedMsById[doc.documentId] ?? 0;
    if (doc.lastModifiedMs <= lastSeen) continue;
    // Always advance the cursor: even if we skip emission (Mac-attributed or
    // coalesced), we've now accounted for this last_modified value.
    nextDocModifiedMsById[doc.documentId] = doc.lastModifiedMs;

    // Mac saw a focus session that attributed to this doc → reading already
    // captured as screentime. No phantom needed.
    if (attributedDocs.has(doc.documentId)) continue;

    // Coalesce iCloud sync bursts: if a recent phantom for this doc ends close
    // to the candidate end, absorb into that existing pill (caller can fine-
    // tune later via the edit modal).
    const recentEnd = recentPhantomEndByDoc.get(doc.documentId) ?? 0;
    if (Math.abs(recentEnd - doc.lastModifiedMs) <= PHANTOM_COALESCE_WINDOW_MS) {
      continue;
    }

    const endMs = doc.lastModifiedMs;
    const startMs = endMs - PHANTOM_DEFAULT_DURATION_MS;
    const key = `ipad|${doc.documentId}|${endMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({
      key,
      documentId: doc.documentId,
      title: doc.name,
      startMs,
      endMs,
      pages: pageCounts.get(doc.documentId) ?? 0,
      documentType: 'phantom-ipad',
      harvestedAt,
      docModifiedMs: doc.lastModifiedMs,
    });
    recentPhantomEndByDoc.set(doc.documentId, endMs);
  }

  await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
  if (fresh.length > 0) {
    const payload = fresh.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fsPromises.appendFile(logPath, payload, 'utf-8');
  }

  await writeCursorBlock(vaultRoot, {
    schemaVersion: SCHEMA_VERSION,
    lastZpk: maxZpkSeen,
    lastDocModifiedMsById: nextDocModifiedMsById,
  });

  return { added: fresh.length, total: existing.length + fresh.length };
}

export async function readGoodnotesReadingLogBlock(
  vaultRoot: string,
): Promise<GoodnotesReadingRecord[]> {
  if (!vaultRoot) return [];
  const { records } = await loadExistingBlock(readingLogPath(vaultRoot));
  return records;
}

// ── Edit + absorb ───────────────────────────────────────────────────────────

export interface GoodnotesEditInput {
  key: string;
  startMs: number;
  endMs: number;
  pages: number;
}

export interface GoodnotesEditResult {
  ok: boolean;
  reason?: 'not-found' | 'invalid' | 'failed';
  /** Number of other rows absorbed into the edited row. */
  absorbed: number;
  /** Total rows in the log after the write. */
  total: number;
}

/** Same-source same-doc rows whose `[startMs, endMs]` overlaps the edited
 *  window with this much grace on each side get absorbed into the survivor.
 *  Screen Time fragments a single sitting into 2–3 close-but-non-overlapping
 *  rows, so a non-zero grace is necessary to make "absorb" feel right. */
const ABSORB_GRACE_MS = 5 * 60_000;

/**
 * Edit a single goodnotes row in place: update startMs/endMs/pages, mark
 * `userEdited`, then delete every other row of the same source + same docId
 * whose time window overlaps the edited window (with 5-min grace on each
 * side). The harvester's cursor never moves backward, so absorbed rows stay
 * absorbed across re-runs. Also advances the cursor to ensure deleted rows'
 * identifying bumps are covered.
 */
export async function editGoodnotesReadingRecordBlock(
  vaultRoot: string,
  input: GoodnotesEditInput,
): Promise<GoodnotesEditResult> {
  if (!vaultRoot) return { ok: false, reason: 'invalid', absorbed: 0, total: 0 };
  return runSerialized(vaultRoot, async () => {
    const logPath = readingLogPath(vaultRoot);
    const { records } = await loadExistingBlock(logPath);
    const idx = records.findIndex(r => r.key === input.key);
    if (idx === -1) {
      return { ok: false, reason: 'not-found', absorbed: 0, total: records.length };
    }
    const target = records[idx];
    if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs)) {
      return { ok: false, reason: 'invalid', absorbed: 0, total: records.length };
    }
    if (input.endMs - input.startMs < 60_000) {
      return { ok: false, reason: 'invalid', absorbed: 0, total: records.length };
    }
    const updated: GoodnotesReadingRecord = {
      ...target,
      startMs: input.startMs,
      endMs: input.endMs,
      pages: Math.max(1, Math.round(input.pages) || 1),
      userEdited: true,
    };

    const grace = ABSORB_GRACE_MS;
    const absorbStart = updated.startMs - grace;
    const absorbEnd = updated.endMs + grace;
    const survivors: GoodnotesReadingRecord[] = [];
    const absorbed: GoodnotesReadingRecord[] = [];
    for (let i = 0; i < records.length; i += 1) {
      if (i === idx) continue;
      const r = records[i];
      const sameDoc = r.documentId === updated.documentId;
      const overlaps = sameDoc
        && r.startMs <= absorbEnd
        && r.endMs >= absorbStart;
      if (overlaps) absorbed.push(r);
      else survivors.push(r);
    }
    survivors.splice(idx > survivors.length ? survivors.length : idx, 0, updated);

    await rewriteLogBlock(logPath, survivors);

    // Bring the cursor forward to cover anything we just deleted, so a
    // re-harvest doesn't resurrect the absorbed rows.
    if (absorbed.length > 0) {
      const cursor = await readCursorBlock(vaultRoot);
      let lastZpk = cursor.lastZpk;
      const lastDocModifiedMsById = { ...cursor.lastDocModifiedMsById };
      for (const r of absorbed) {
        if (r.documentType === 'screentime') {
          const m = /^screentime\|(\d+)\|/.exec(r.key);
          if (m) {
            const zpk = parseInt(m[1], 10);
            if (Number.isFinite(zpk) && zpk > lastZpk) lastZpk = zpk;
          }
        } else if (r.documentType === 'phantom-ipad') {
          const cur = lastDocModifiedMsById[r.documentId] ?? 0;
          if (r.docModifiedMs > cur) lastDocModifiedMsById[r.documentId] = r.docModifiedMs;
        }
      }
      await writeCursorBlock(vaultRoot, {
        schemaVersion: SCHEMA_VERSION,
        lastZpk,
        lastDocModifiedMsById,
      });
    }

    return { ok: true, absorbed: absorbed.length, total: survivors.length };
  });
}

// Legacy no-ops kept for back-compat (previously armed the Amplitude watcher).
export function startGoodnotesWatcherBlock(_vaultRoot: string): void {}
export function stopGoodnotesWatcherBlock(): void {}
