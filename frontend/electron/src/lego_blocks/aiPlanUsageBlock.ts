import { spawn, type ChildProcess } from 'child_process';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Session and weekly plan usage for the AI tools installed on this machine.
 *
 * Both providers are read from *local, first-party* surfaces — we never read a
 * credential, never call a provider's HTTP API, and never impersonate another
 * client:
 *
 *   - Codex: the local `codex app-server`, over JSON-RPC on stdio. Codex holds
 *     its own login and makes its own call; we ask it for the answer.
 *   - Claude: a small JSON file the user's Claude Code status line writes.
 *     Claude Code has already fetched the numbers; the status line is the
 *     documented way it hands them to a script.
 *
 * Anything requiring us to read `~/.codex/auth.json` or the login keychain and
 * call a provider endpoint directly is deliberately out of scope — that is the
 * pattern subscription providers have enforced against, and it isn't needed
 * when both tools will simply tell us.
 */

const CLAUDE_HOME_BLOCK = path.join(os.homedir(), '.claude');
const CODEX_HOME_BLOCK = path.join(os.homedir(), '.codex');

/** Where the user's status-line script drops the Claude reading. */
export const CLAUDE_LIMITS_BRIDGE_PATH_BLOCK = path.join(
  os.homedir(),
  '.thinking-space',
  'claude-limits.json',
);

export type AiPlanUsageProviderIdBlock = 'claude' | 'codex';
export type AiPlanUsageStateBlock = 'ready' | 'waiting' | 'unconfigured';

export interface AiPlanUsageWindowBlock {
  usedPercent: number;
  resetsAt: number | null;
  windowMinutes: number | null;
}

export interface AiPlanUsageProviderBlock {
  id: AiPlanUsageProviderIdBlock;
  label: string;
  plan: string | null;
  state: AiPlanUsageStateBlock;
  detected: boolean;
  hasPlan: boolean;
  session: AiPlanUsageWindowBlock | null;
  weekly: AiPlanUsageWindowBlock | null;
}

function isFiniteNumberBlock(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A window whose reset has already passed is stale, not full — both providers
 * drop windows once they roll over, and showing the old figure would be a lie
 * that gets worse the longer the app sits open.
 */
function liveWindowBlock(window: AiPlanUsageWindowBlock | null): AiPlanUsageWindowBlock | null {
  if (!window) return null;
  if (window.resetsAt != null && window.resetsAt * 1000 <= Date.now()) return null;
  return window;
}

// ---------------------------------------------------------------------------
// Codex — local app-server over JSON-RPC
// ---------------------------------------------------------------------------

/**
 * Codex is commonly installed through npm/nvm, whose bin directory is not on a
 * GUI app's inherited PATH. Static candidates first (cheap), then a PATH probe
 * with the usual install roots merged in.
 */
function resolveCodexBinaryBlock(): string | null {
  const home = os.homedir();
  const candidates = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(home, '.local', 'bin', 'codex')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // nvm keeps one bin dir per installed Node version; scan rather than guess.
  const nvmVersions = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const version of fs.readdirSync(nvmVersions)) {
      const candidate = path.join(nvmVersions, version, 'bin', 'codex');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // No nvm on this machine — fine.
  }

  try {
    const merged = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].join(':');
    const found = execFileSync('/usr/bin/which', ['codex'], {
      env: { ...process.env, PATH: merged },
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

interface PendingRequestBlock {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * One long-lived `codex app-server` process.
 *
 * Held open rather than spawned per read: the handshake costs a process launch,
 * and keeping the connection lets us take `account/rateLimits/updated` pushes
 * instead of polling — which is what keeps this off a timer.
 */
class CodexAppServerClientBlock {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequestBlock>();
  private buffer = '';
  private ready: Promise<void> | null = null;
  /** Last pushed snapshot, so a read can answer without a round trip. */
  latestRateLimits: unknown = null;

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // Not our protocol — ignore rather than crash the reader.
    }

    if (typeof message.method === 'string' && message.method === 'account/rateLimits/updated') {
      this.latestRateLimits = (message.params as Record<string, unknown> | undefined)?.rateLimits ?? null;
      return;
    }

    const id = message.id;
    if (!isFiniteNumberBlock(id)) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(JSON.stringify(message.error)));
    } else {
      entry.resolve(message.result);
    }
  }

  private start(binary: string): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(binary, ['app-server'], {
          stdio: ['pipe', 'pipe', 'ignore'],
          env: { ...process.env },
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.child = child;

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        this.buffer += chunk;
        let index = this.buffer.indexOf('\n');
        while (index >= 0) {
          const line = this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + 1);
          this.handleLine(line);
          index = this.buffer.indexOf('\n');
        }
      });

      const onGone = (): void => {
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('codex app-server exited'));
        }
        this.pending.clear();
        this.child = null;
        this.ready = null;
        this.latestRateLimits = null;
      };
      child.on('exit', onGone);
      child.on('error', onGone);

      this.request('initialize', {
        clientInfo: { name: 'thinking-space', title: 'Thinking Space', version: '1.0.0' },
      })
        .then(() => resolve())
        .catch(reject);
    });

    return this.ready;
  }

  request(method: string, params: unknown, timeoutMs = 8000): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin) return Promise.reject(new Error('codex app-server not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async ensureStarted(binary: string): Promise<void> {
    await this.start(binary);
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}

const codexClientBlock = new CodexAppServerClientBlock();

/** Frees the app-server child. Call on app quit. */
export function disposeAiPlanUsageBlock(): void {
  codexClientBlock.dispose();
}

const CODEX_PLAN_LABEL_BLOCK: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Education',
  edu_plus: 'Education Plus',
  edu_pro: 'Education Pro',
};

function codexPlanLabelBlock(planType: unknown): string | null {
  if (typeof planType !== 'string' || planType.length === 0 || planType === 'unknown') return null;
  return CODEX_PLAN_LABEL_BLOCK[planType] ?? planType.replace(/_/g, ' ');
}

function codexWindowBlock(raw: unknown): AiPlanUsageWindowBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isFiniteNumberBlock(value.usedPercent)) return null;
  return {
    usedPercent: value.usedPercent,
    resetsAt: isFiniteNumberBlock(value.resetsAt) ? value.resetsAt : null,
    windowMinutes: isFiniteNumberBlock(value.windowDurationMins) ? value.windowDurationMins : null,
  };
}

async function readCodexPlanUsageBlock(): Promise<AiPlanUsageProviderBlock> {
  const base: AiPlanUsageProviderBlock = {
    id: 'codex',
    label: 'Codex',
    plan: null,
    state: 'waiting',
    detected: false,
    hasPlan: false,
    session: null,
    weekly: null,
  };

  // "Detected" means the person actually uses Codex here — the binary alone
  // isn't enough, since an install with no login has nothing to report.
  const binary = resolveCodexBinaryBlock();
  if (!binary || !fs.existsSync(path.join(CODEX_HOME_BLOCK, 'auth.json'))) return base;
  base.detected = true;

  try {
    await codexClientBlock.ensureStarted(binary);
    const result = (await codexClientBlock.request('account/rateLimits/read', {})) as
      | Record<string, unknown>
      | undefined;
    const rateLimits = (result?.rateLimits ?? codexClientBlock.latestRateLimits) as
      | Record<string, unknown>
      | undefined;
    if (!rateLimits) return base;

    return {
      ...base,
      state: 'ready',
      hasPlan: true,
      plan: codexPlanLabelBlock(rateLimits.planType),
      session: liveWindowBlock(codexWindowBlock(rateLimits.primary)),
      weekly: liveWindowBlock(codexWindowBlock(rateLimits.secondary)),
    };
  } catch {
    // App-server unreachable or the account has no metered plan. Stay in
    // `waiting` rather than inventing a reading.
    return base;
  }
}

// ---------------------------------------------------------------------------
// Claude — status-line bridge file
// ---------------------------------------------------------------------------

function claudeWindowBlock(raw: unknown, windowMinutes: number): AiPlanUsageWindowBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isFiniteNumberBlock(value.used_percentage)) return null;
  return {
    usedPercent: value.used_percentage,
    resetsAt: isFiniteNumberBlock(value.resets_at) ? value.resets_at : null,
    windowMinutes,
  };
}

function readClaudePlanUsageBlock(): AiPlanUsageProviderBlock {
  const base: AiPlanUsageProviderBlock = {
    id: 'claude',
    label: 'Claude',
    plan: null,
    state: 'unconfigured',
    detected: fs.existsSync(CLAUDE_HOME_BLOCK),
    hasPlan: false,
    session: null,
    weekly: null,
  };

  if (!base.detected) return base;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(CLAUDE_LIMITS_BRIDGE_PATH_BLOCK, 'utf8')) as Record<string, unknown>;
  } catch {
    // No bridge file: Claude Code is installed but the status line hasn't been
    // wired up. That's the day-one state and the UI invites the user to fix it.
    return base;
  }

  const session = liveWindowBlock(claudeWindowBlock(parsed.five_hour, 300));
  const weekly = liveWindowBlock(claudeWindowBlock(parsed.seven_day, 10080));

  // A bridge file with both windows rolled over means the status line ran but
  // Claude Code had nothing to publish yet — connected, not yet reporting.
  if (!session && !weekly) return { ...base, state: 'waiting', hasPlan: true };

  return {
    ...base,
    state: 'ready',
    hasPlan: true,
    plan: typeof parsed.plan === 'string' ? parsed.plan : null,
    session,
    weekly,
  };
}

// ---------------------------------------------------------------------------

/** Both providers, in the order they appear on the card. */
export async function readAiPlanUsageBlock(): Promise<AiPlanUsageProviderBlock[]> {
  const codex = await readCodexPlanUsageBlock();
  return [readClaudePlanUsageBlock(), codex];
}
