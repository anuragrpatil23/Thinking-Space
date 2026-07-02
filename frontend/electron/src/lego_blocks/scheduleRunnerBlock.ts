import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ScheduleSpecBlock } from './scheduleStorageBlock';
import { getInstalledRunnerPath } from './schedulerProvisionBlock';

// Run Now used to spawn `claude` directly with its own arg builder. That code
// drifted behind the standalone runner.mjs (no stream-json/sessionId capture,
// no telegram conv auto-open, no cleanupSession), so launchd-fired runs and
// app-fired runs of the same schedule behaved differently. This file now
// shells out to runner.mjs — single source of truth for execution.

export interface ScheduleRunResultBlock {
  key: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  transcriptPath: string;
  transcriptFilename: string;
  durationMs: number;
  errorMessage?: string;
}

export interface ScheduleRunChunkBlock {
  channel: 'stdout' | 'stderr';
  timestamp: string;
  line: string;
}

export interface ScheduleRunOptionsBlock {
  // Retained for API compatibility. Live streaming is currently a no-op for
  // delegated runs — the runner writes the transcript file directly. The full
  // transcript is available via the schedules:read-transcript IPC after exit.
  onChunk?: (chunk: ScheduleRunChunkBlock) => void;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function getTranscriptDirBlock(key: string): string {
  return path.join(app.getPath('userData'), 'transcripts', key);
}

function findNewestTranscript(dir: string, sinceMs: number): { name: string; full: string } | null {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  let best: { name: string; full: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.mtimeMs < sinceMs - 1000) continue;
    if (!best || stat.mtimeMs > best.mtimeMs) best = { name, full, mtimeMs: stat.mtimeMs };
  }
  return best ? { name: best.name, full: best.full } : null;
}

function parseExitFromTranscript(file: string): { exitCode: number | null; signal: NodeJS.Signals | null } {
  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return { exitCode: null, signal: null }; }
  const tail = text.slice(-400);
  const exitMatch = tail.match(/^# exit: (.+)$/m);
  const signalMatch = tail.match(/^# signal: (.+)$/m);
  const exitRaw = exitMatch?.[1]?.trim();
  const signalRaw = signalMatch?.[1]?.trim();
  const exitCode = exitRaw && exitRaw !== 'null' ? Number(exitRaw) : null;
  const signal = signalRaw && signalRaw !== 'null' ? (signalRaw as NodeJS.Signals) : null;
  return { exitCode: Number.isFinite(exitCode) ? exitCode : null, signal };
}

export async function runScheduleBlock(
  spec: ScheduleSpecBlock,
  _options: ScheduleRunOptionsBlock = {},
): Promise<ScheduleRunResultBlock> {
  if (!spec.enabled) {
    throw new Error(`Schedule ${spec.key} is disabled`);
  }

  const runnerPath = getInstalledRunnerPath();
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`Scheduler runner not provisioned at ${runnerPath}`);
  }

  const startedAt = new Date();
  const startedMs = startedAt.getTime();
  const transcriptDir = getTranscriptDirBlock(spec.key);
  fs.mkdirSync(transcriptDir, { recursive: true });

  let errorMessage: string | undefined;

  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const child = spawn(
      process.execPath,
      [runnerPath, 'run', spec.key, '--origin', 'fire-now'],
      {
        // THINKING_SPACE_USERDATA matches what the launchd plist injects —
        // without it the runner falls back to a default that's wrong for any
        // app whose name differs from productName (ours: "thinking-space"
        // vs "Thinking Space"), and readSpec returns spec_not_found.
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          THINKING_SPACE_USERDATA: app.getPath('userData'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    // Drain stdio so the pipe buffer never blocks the child. We don't forward
    // these — the runner writes its own transcript and event log.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});

    const timeout = setTimeout(() => {
      if (!child.killed) {
        errorMessage = `runner timeout after ${DEFAULT_TIMEOUT_MS}ms`;
        child.kill('SIGTERM');
      }
    }, DEFAULT_TIMEOUT_MS);

    child.on('error', (err) => {
      errorMessage = err.message;
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal });
    });
  });

  const endedAt = new Date();
  const transcript = findNewestTranscript(transcriptDir, startedMs);
  const transcriptPath = transcript?.full ?? '';
  const transcriptFilename = transcript?.name ?? '';

  // Prefer the transcript footer for exit status — the runner records the
  // claude child's exit there, which is what users actually care about. Fall
  // back to the runner process's own exit if no transcript was produced.
  const fromTranscript = transcriptPath ? parseExitFromTranscript(transcriptPath) : { exitCode: null, signal: null };
  const exitCode = fromTranscript.exitCode ?? result.exitCode;
  const signal = fromTranscript.signal ?? result.signal;

  if (!transcriptPath && !errorMessage) {
    errorMessage = `runner produced no transcript (runner exit ${result.exitCode}, signal ${result.signal ?? 'null'})`;
  }

  return {
    key: spec.key,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    exitCode,
    signal,
    transcriptPath,
    transcriptFilename,
    durationMs: endedAt.getTime() - startedAt.getTime(),
    errorMessage,
  };
}
