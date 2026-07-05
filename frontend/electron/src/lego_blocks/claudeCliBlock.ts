import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

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
// Incognito: every invocation is captured by Claude Code as a JSONL under
// `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, and the user's
// SessionEnd hook mirrors it into the vault at `ai_raw/raw/claude-code/`.
// Because THIS caller is the AI-activity summarizer itself, letting those
// traces stick around means the next summarizer run sees its own previous
// invocations as new "activity" — recursive noise. We use
// `--output-format json` to capture the session_id and, right after the
// process exits, delete both the JSONL and the vault mirror via the shared
// cleanup module (same one the scheduler runner uses for one-shot jobs).
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
  // THINKSPC_INCOGNITO surfaces to any SessionEnd hook the user might wire
  // up (e.g. render-session.sh); a hook that respects the flag can
  // early-exit instead of writing the vault mirror. Even without the hook
  // change we still nuke the mirror post-run — this flag is belt-and-braces.
  return {
    ...process.env,
    PATH: merged,
    FORCE_COLOR: '0',
    THINKSPC_INCOGNITO: '1',
  };
}

// Location of the shared cleanup module. Installed by schedulerProvisionBlock
// on every launch — the same on-disk copy the scheduler's runner.mjs uses,
// so this module and runner.mjs can never drift out of sync.
function resolveCleanupModuleUrlBlock(): string {
  const installed = path.join(
    process.env.HOME ?? '',
    '.thinking-space', 'scheduler', 'claudeSessionCleanupBlock.mjs',
  );
  return pathToFileURL(installed).href;
}

interface CleanupModuleBlock {
  deleteClaudeSessionFilesBlock: (sessionId: string) => string[];
}

let cachedCleanupModule: Promise<CleanupModuleBlock | null> | null = null;
async function loadCleanupModuleBlock(): Promise<CleanupModuleBlock | null> {
  if (!cachedCleanupModule) {
    cachedCleanupModule = (async () => {
      try {
        const mod = await import(resolveCleanupModuleUrlBlock());
        if (typeof mod.deleteClaudeSessionFilesBlock !== 'function') return null;
        return mod as CleanupModuleBlock;
      } catch {
        // Provisioning hasn't run yet (first launch) or the file was
        // deleted. Cleanup silently degrades — the tradeoff is one stray
        // session file, no functional breakage.
        return null;
      }
    })();
  }
  return cachedCleanupModule;
}

/** Best-effort cleanup with a short retry to cover the race where the
 *  SessionEnd hook writes the vault mirror moments after the child exits.
 *  Two passes ~1s apart is enough for the hook to have flushed. */
async function scheduleSessionCleanupBlock(sessionId: string): Promise<void> {
  const mod = await loadCleanupModuleBlock();
  if (!mod) return;
  try { mod.deleteClaudeSessionFilesBlock(sessionId); } catch { /* best effort */ }
  setTimeout(() => {
    try { mod.deleteClaudeSessionFilesBlock(sessionId); } catch { /* best effort */ }
  }, 1000);
}

interface ParsedClaudeResultBlock {
  content: string;
  sessionId: string | null;
}

/** Parse `claude -p --output-format json` stdout. The CLI returns a single
 *  JSON envelope with at least `result` (assistant text) and `session_id`.
 *  Defensive: falls back to raw stdout if the payload isn't parseable JSON,
 *  so an unexpected CLI version doesn't break the summarizer path. */
function parseClaudeJsonOutputBlock(stdout: string): ParsedClaudeResultBlock {
  const trimmed = stdout.trim();
  if (!trimmed) return { content: '', sessionId: null };
  try {
    const obj = JSON.parse(trimmed) as {
      result?: unknown;
      session_id?: unknown;
      is_error?: unknown;
    };
    const content = typeof obj.result === 'string' ? obj.result : '';
    const sessionId = typeof obj.session_id === 'string' ? obj.session_id : null;
    return { content, sessionId };
  } catch {
    return { content: trimmed, sessionId: null };
  }
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
  // json output gives us `session_id` + `result` in one buffered payload so
  // we can (a) hand the assistant text back to the caller and (b) know
  // which JSONL to nuke from ~/.claude/projects.
  args.push('--output-format', 'json');
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
      const parsed = parseClaudeJsonOutputBlock(trimmed);
      // Fire cleanup as soon as we know the session id — no need to await
      // (the caller only cares about the response text). The retry inside
      // scheduleSessionCleanupBlock covers the SessionEnd-hook race.
      if (parsed.sessionId) void scheduleSessionCleanupBlock(parsed.sessionId);
      resolve({ ok: true, content: parsed.content, latencyMs });
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
