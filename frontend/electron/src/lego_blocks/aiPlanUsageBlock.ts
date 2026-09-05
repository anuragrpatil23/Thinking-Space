import { app } from 'electron';
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

/**
 * What Claude Code's status line currently is, which decides what we can safely
 * ask the user to do.
 *
 * `theirs` is the case that matters: pointing Claude Code at our script would
 * replace whatever they built — their branch, their context meter — because
 * only one status line runs. Telling someone to run a command that quietly
 * destroys their setup is not an instruction, it's a trap, so the card asks
 * them to add a line to their own script instead.
 */
export type ClaudeStatusLineModeBlock = 'none' | 'ours' | 'theirs';

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
 * Failure diary for the Codex read.
 *
 * Every path here degrades to an empty row rather than an error, which is right
 * for the UI and useless for debugging — a packaged build that silently shows
 * nothing gives no way to tell "not installed" from "spawn died" from "request
 * timed out". Costs one line per failure and is the only way to diagnose this
 * outside a terminal.
 */
function logPlanUsageBlock(message: string): void {
  try {
    const dir = path.join(os.homedir(), '.thinking-space', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'ai-plan-usage.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Diagnostics must never be the thing that breaks the feature.
  }
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

/**
 * Environment for the app-server child.
 *
 * `codex` is a `#!/usr/bin/env node` script, and on an nvm install the `node`
 * it needs sits in the same bin directory as `codex` itself. A Finder-launched
 * app inherits neither on PATH, so the shebang fails and the child dies the
 * instant it spawns — which surfaced as a permanently "waiting" Codex row in a
 * packaged build while working fine from a terminal. Prepending the binary's
 * own directory is what makes the interpreter resolvable; the rest are the
 * usual install roots, matching claudeCliBlock's approach.
 */
function buildCodexEnvBlock(binary: string): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPaths = [
    path.dirname(binary),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
  ];
  const merged = [...extraPaths, ...(process.env.PATH ?? '').split(':').filter(Boolean)].join(':');
  return {
    ...process.env,
    PATH: merged,
    // Pin the read to the person's own Codex login.
    //
    // codexProfileBlock reassigns `process.env.CODEX_HOME` to whichever agent
    // profile is active, and a child would inherit it — which sent this read at
    // a profile whose token no longer parses and came back 401, while the same
    // code worked from a terminal. Detection already looks at `~/.codex`, so
    // inheriting the override also meant deciding "Codex is installed" from one
    // account and reporting usage for another. The card is about the plan the
    // person is spending, not the profile the app happens to run agents under.
    CODEX_HOME: CODEX_HOME_BLOCK,
  };
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
          env: buildCodexEnvBlock(binary),
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

      const onGone = (cause?: unknown): void => {
        if (cause) logPlanUsageBlock(`codex app-server gone: ${String(cause)}`);
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('codex app-server exited'));
        }
        this.pending.clear();
        this.child = null;
        this.ready = null;
        this.latestRateLimits = null;
      };
      child.on('exit', (code, signal) => onGone(`exit code=${code} signal=${signal}`));
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
  const hasAuth = fs.existsSync(path.join(CODEX_HOME_BLOCK, 'auth.json'));
  if (!binary || !hasAuth) {
    logPlanUsageBlock(`codex not detected (binary=${binary ?? 'none'} auth=${hasAuth})`);
    return base;
  }
  base.detected = true;

  try {
    await codexClientBlock.ensureStarted(binary);
    const result = (await codexClientBlock.request('account/rateLimits/read', {})) as
      | Record<string, unknown>
      | undefined;
    const rateLimits = (result?.rateLimits ?? codexClientBlock.latestRateLimits) as
      | Record<string, unknown>
      | undefined;
    if (!rateLimits) {
      logPlanUsageBlock(`codex read returned no rateLimits (keys=${Object.keys(result ?? {}).join(',')})`);
      return base;
    }

    return {
      ...base,
      state: 'ready',
      hasPlan: true,
      plan: codexPlanLabelBlock(rateLimits.planType),
      session: liveWindowBlock(codexWindowBlock(rateLimits.primary)),
      weekly: liveWindowBlock(codexWindowBlock(rateLimits.secondary)),
    };
  } catch (error) {
    logPlanUsageBlock(
      `codex read failed (binary=${binary}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return base;
  }
}

// ---------------------------------------------------------------------------
// Claude — the status-line script we ship
// ---------------------------------------------------------------------------

const STATUSLINE_SCRIPT_RELATIVE_PATH_BLOCK = 'claude-statusline.sh';

/**
 * Where the bundled status-line script lives.
 *
 * Inside the app bundle rather than copied into the user's home: it is part of
 * Thinking Space, versioned with it, and updates when the app does — no loose
 * copy for anyone to maintain, trust, or find drifting out of date. Resolution
 * mirrors cliProvisionBlock's: `process.resourcesPath` when packaged, the repo
 * folder in development.
 */
export function claudeStatusLineScriptPathBlock(): string {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, STATUSLINE_SCRIPT_RELATIVE_PATH_BLOCK)
    : null;
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(
    app.getAppPath(),
    'electron',
    'resources',
    STATUSLINE_SCRIPT_RELATIVE_PATH_BLOCK,
  );
}

/**
 * Read-only look at Claude Code's status-line setting.
 *
 * Never writes: `~/.claude` is the user's, and the app's job here is to know
 * which instruction is safe to show, not to change anything.
 */
export function claudeStatusLineModeBlock(): ClaudeStatusLineModeBlock {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(CLAUDE_HOME_BLOCK, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    const statusLine = settings.statusLine as Record<string, unknown> | undefined;
    const command = typeof statusLine?.command === 'string' ? statusLine.command : null;
    if (!command) return 'none';
    // Match on the filename rather than the full path: the app can be installed
    // anywhere, and a settings file written against an older install location
    // still points at our script.
    return command.includes(STATUSLINE_SCRIPT_RELATIVE_PATH_BLOCK) ? 'ours' : 'theirs';
  } catch {
    // No settings file, or unreadable — treat as unconfigured, which shows the
    // gentler of the two instructions.
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Claude — reading the bridge file
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

  // Our script stores the status-line payload verbatim — no `jq` required on
  // the machine — so the windows sit under `rate_limits`. A bridge file written
  // by an earlier hand-rolled script held that object at the top level; accept
  // both rather than break anyone who wired this up before.
  const limits = (parsed.rate_limits as Record<string, unknown> | undefined) ?? parsed;
  const session = liveWindowBlock(claudeWindowBlock(limits.five_hour, 300));
  const weekly = liveWindowBlock(claudeWindowBlock(limits.seven_day, 10080));

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
export interface AiPlanUsageReadingBlock {
  /** Both providers, in the order they appear on the card. */
  providers: AiPlanUsageProviderBlock[];
  /**
   * Absolute path to the bundled status-line script, so the card can print the
   * command verbatim wherever the app is installed rather than assuming
   * /Applications.
   */
  statusLineScriptPath: string;
  /** Decides which setup instruction is safe to show. */
  statusLineMode: ClaudeStatusLineModeBlock;
}

export async function readAiPlanUsageBlock(): Promise<AiPlanUsageReadingBlock> {
  const codex = await readCodexPlanUsageBlock();
  return {
    providers: [readClaudePlanUsageBlock(), codex],
    statusLineScriptPath: claudeStatusLineScriptPathBlock(),
    statusLineMode: claudeStatusLineModeBlock(),
  };
}
