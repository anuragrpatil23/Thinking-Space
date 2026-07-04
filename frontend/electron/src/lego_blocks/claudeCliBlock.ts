import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Shell-out adapter for the Claude Code CLI (`claude -p`). Pro-plan users
// already pay for Claude via subscription; hitting the API SDK on top of
// that would double-bill them. The CLI reuses the same OAuth login that
// the interactive Claude Code session uses, so no separate credential
// setup is needed.
//
// Trade-offs vs. the SDK path:
//   - No streaming (we buffer stdout). Fine for the current internal
//     intelligence tasks (chain digest, day atom) which return < 2K tokens.
//   - No native tool calling / structured output. If the caller needs
//     tools or a JSON schema they should stay on the SDK provider.
//   - `--model` accepts aliases (haiku/sonnet/opus) or full model ids.
//
// The `claude` binary is looked up on PATH, augmented with common install
// locations so it resolves when the app is launched from Finder rather
// than a terminal.

export interface ClaudeCliChatRequestBlock {
  model: string;
  system: string;
  userPrompt: string;
  /** Millisecond wall-clock budget. Enforced by killing the process. */
  timeoutMs: number;
}

export interface ClaudeCliChatResponseBlock {
  ok: boolean;
  content?: string;
  error?: string;
  /** Rounded to ms — used for telemetry. */
  latencyMs?: number;
}

// Matches scheduler runner.mjs's DEFAULT_CLAUDE_BINARY — keep the two in sync
// so "where does claude live on this machine" has one answer across the app.
const DEFAULT_CLAUDE_BINARY = '/opt/homebrew/bin/claude';

function resolveClaudeBinaryBlock(): string {
  if (fs.existsSync(DEFAULT_CLAUDE_BINARY)) return DEFAULT_CLAUDE_BINARY;
  return 'claude'; // PATH-resolved fallback.
}

function buildEnvBlock(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? '';
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
  ].filter(Boolean);

  const existingPath = process.env.PATH ?? '';
  const merged = [...extraPaths, ...existingPath.split(':').filter(Boolean)].join(':');
  return { ...process.env, PATH: merged, FORCE_COLOR: '0' };
}

const runningProcesses = new Map<string, ChildProcess>();

export async function invokeClaudeCliChatBlock(
  requestId: string,
  request: ClaudeCliChatRequestBlock,
): Promise<ClaudeCliChatResponseBlock> {
  const started = Date.now();
  const args = ['-p'];
  if (request.model) args.push('--model', request.model);
  if (request.system) args.push('--system-prompt', request.system);
  args.push(request.userPrompt);

  return await new Promise<ClaudeCliChatResponseBlock>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(resolveClaudeBinaryBlock(), args, {
        env: buildEnvBlock(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, error: `spawn failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    runningProcesses.set(requestId, proc);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, request.timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      runningProcesses.delete(requestId);
      resolve({ ok: false, error: `process error: ${err.message}` });
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      runningProcesses.delete(requestId);
      const latencyMs = Date.now() - started;
      if (cancelled) {
        resolve({ ok: false, error: 'cancelled', latencyMs });
        return;
      }
      if (timedOut) {
        resolve({ ok: false, error: `timeout after ${request.timeoutMs}ms`, latencyMs });
        return;
      }
      const trimmed = stdout.trim();
      // `claude -p` prints "Not logged in" (and similar auth errors) on
      // stdout with exit 0 — the process didn't fail, but the payload is
      // an error message. Detect and surface as an error so callers can
      // fall through instead of returning the raw string as content.
      if (/^Not logged in/i.test(trimmed) || /Please run \/login/i.test(trimmed)) {
        resolve({ ok: false, error: 'not-logged-in', latencyMs });
        return;
      }
      if (code !== 0 && !trimmed) {
        resolve({ ok: false, error: stderr.trim() || `exit ${code}`, latencyMs });
        return;
      }
      resolve({ ok: true, content: trimmed, latencyMs });
    });

    // Set the cancel hook after `on(close)` — otherwise a cancel that
    // arrives between spawn and listener setup would race the kill.
    ;(proc as ChildProcess & { _cancel?: () => void })._cancel = () => {
      cancelled = true;
      proc.kill('SIGTERM');
    };
  });
}

export function cancelClaudeCliRequestBlock(requestId: string): void {
  const proc = runningProcesses.get(requestId) as
    | (ChildProcess & { _cancel?: () => void })
    | undefined;
  if (!proc) return;
  if (proc._cancel) proc._cancel();
  else proc.kill('SIGTERM');
}

// Availability probe: does `claude` resolve on PATH? Result is cached for
// the process lifetime — the binary either exists at boot or it doesn't.
let cachedAvailable: boolean | null = null;
let cachedVersion: string | null = null;

export async function probeClaudeCliBlock(): Promise<{ available: boolean; version: string | null }> {
  if (cachedAvailable !== null) {
    return { available: cachedAvailable, version: cachedVersion };
  }
  return await new Promise((resolve) => {
    const proc = spawn(resolveClaudeBinaryBlock(), ['--version'], {
      env: buildEnvBlock(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('error', () => {
      cachedAvailable = false;
      cachedVersion = null;
      resolve({ available: false, version: null });
    });
    proc.on('close', (code: number | null) => {
      const ok = code === 0;
      cachedAvailable = ok;
      cachedVersion = ok ? out.trim() : null;
      resolve({ available: ok, version: cachedVersion });
    });
  });
}
