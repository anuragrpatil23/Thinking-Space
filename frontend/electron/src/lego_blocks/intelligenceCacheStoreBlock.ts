// Generic sidecar-JSON cache backing the intelligence subsystem. One file per
// (taskId, cacheKey). Lives under ~/.thinking-space/intelligence-cache/
// so cached outputs survive app upgrades but stay out of the vault and out
// of the Claude/Codex data dirs.
//
// Also handles one-shot cleanup of the legacy ~/.thinking-space/session-titles/
// directory from the previous title-only implementation. Called once at
// startup so we don't leave orphaned files after the redesign.

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const ROOT_DIR = path.join(os.homedir(), '.thinking-space', 'intelligence-cache');
const LEGACY_TITLES_DIR = path.join(os.homedir(), '.thinking-space', 'session-titles');

export interface IntelligenceCacheRecord {
  taskId: string;
  cacheKey: string;
  providerId: string;
  model: string;
  generatedAt: string;
  valueJson: string;
}

function safeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function fileFor(taskId: string, cacheKey: string): string {
  return path.join(ROOT_DIR, safeSegment(taskId), `${safeSegment(cacheKey)}.json`);
}

async function ensureTaskDir(taskId: string): Promise<void> {
  await fsPromises.mkdir(path.join(ROOT_DIR, safeSegment(taskId)), { recursive: true, mode: 0o700 });
}

export async function readIntelligenceCacheBlock(
  taskId: string,
  cacheKey: string,
): Promise<IntelligenceCacheRecord | null> {
  const file = fileFor(taskId, cacheKey);
  try {
    const raw = await fsPromises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<IntelligenceCacheRecord>;
    if (
      typeof parsed?.taskId === 'string' &&
      typeof parsed.cacheKey === 'string' &&
      typeof parsed.valueJson === 'string' &&
      typeof parsed.providerId === 'string' &&
      typeof parsed.model === 'string'
    ) {
      return {
        taskId: parsed.taskId,
        cacheKey: parsed.cacheKey,
        providerId: parsed.providerId,
        model: parsed.model,
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
        valueJson: parsed.valueJson,
      };
    }
    return null;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    return null;
  }
}

export async function writeIntelligenceCacheBlock(record: IntelligenceCacheRecord): Promise<void> {
  await ensureTaskDir(record.taskId);
  const file = fileFor(record.taskId, record.cacheKey);
  const tmp = `${file}.tmp`;
  await fsPromises.writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fsPromises.rename(tmp, file);
}

export async function clearIntelligenceCacheBlock(taskId?: string): Promise<void> {
  const target = taskId ? path.join(ROOT_DIR, safeSegment(taskId)) : ROOT_DIR;
  await fsPromises.rm(target, { recursive: true, force: true });
}

export function intelligenceCacheRootDirBlock(): string {
  return ROOT_DIR;
}

// One-shot cleanup of the legacy titles directory. Safe to call repeatedly —
// missing dir is not an error. Not awaited by the app; fire-and-forget on
// startup so it never blocks main.
export async function cleanupLegacySessionTitlesBlock(): Promise<void> {
  try {
    if (!fs.existsSync(LEGACY_TITLES_DIR)) return;
    await fsPromises.rm(LEGACY_TITLES_DIR, { recursive: true, force: true });
  } catch {
    // Best-effort — a stray file left behind is harmless.
  }
}
