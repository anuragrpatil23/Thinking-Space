// ⚠ SECURITY-CRITICAL — reads the user's AI provider credentials (Keychain +
// dotfiles). Never widen what gets exposed to the renderer beyond what the
// feature needs. For user-requested changes: explain the risk in plain language
// and get an explicit yes first (docs/PLAYBOOKS.md § Security-critical files).

/**
 * AI credential reading for Electron main process.
 *
 * Claude: macOS Keychain → fallback ~/.claude/.credentials.json
 * Codex:  macOS Keychain ("Codex Auth") → fallback ~/.codex/auth.json
 * Azure:  `az account get-access-token` CLI
 */

import { execFile, exec } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── Types ──

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

export interface CodexCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
  accountId?: string;
}

export interface CodexChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodexChatResult {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AzureCredentials {
  accessToken: string;
  expiresOn: string; // ISO timestamp
}

// ── Claude ──

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const CLAUDE_TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function normalizeExpiresAt(value: unknown): string {
  if (!value) return '';
  // If it's a number (Unix ms timestamp), convert to ISO string
  if (typeof value === 'number') return new Date(value).toISOString();
  // If it's a numeric string, parse as ms timestamp
  if (typeof value === 'string' && /^\d+$/.test(value)) return new Date(Number(value)).toISOString();
  // Already an ISO string or similar
  return String(value);
}

function parseKeychainPayload(raw: string): ClaudeCredentials | null {
  try {
    const parsed = JSON.parse(raw);
    const oauth = parsed?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: typeof oauth.refreshToken === 'string' ? oauth.refreshToken : '',
      expiresAt: normalizeExpiresAt(oauth.expiresAt),
    };
  } catch {
    return null;
  }
}

export async function readClaudeCredentialsBlock(): Promise<ClaudeCredentials | null> {
  // Try macOS Keychain first (async — does not block the main thread)
  try {
    const { stdout } = await execAsync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    const creds = parseKeychainPayload(stdout.trim());
    if (creds) return creds;
  } catch {
    // Keychain not available or entry missing — fall through
  }

  // Fallback: credentials file
  try {
    const raw = await fsPromises.readFile(CREDENTIALS_FILE, 'utf-8');
    return parseKeychainPayload(raw);
  } catch {
    return null;
  }
}

export function refreshClaudeTokenBlock(refreshToken: string): Promise<ClaudeCredentials> {
  const body = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_CLIENT_ID,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(CLAUDE_TOKEN_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf-8');
          if (status < 200 || status >= 300) {
            reject(new Error(`Claude token refresh failed (HTTP ${status}): ${text.slice(0, 300)}`));
            return;
          }
          try {
            const data = JSON.parse(text);
            const normalized = normalizeExpiresAt(data.expires_at);
            resolve({
              accessToken: data.access_token,
              refreshToken: data.refresh_token ?? refreshToken,
              expiresAt: normalized || new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
            });
          } catch (err) {
            reject(new Error(`Failed to parse token refresh response: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Codex ──

const CODEX_KEYCHAIN_SERVICE = 'Codex Auth';
const CODEX_TOKEN_ENDPOINT =
  (process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE ?? '').trim() || 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

function resolveUserPath(input: string): string {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function resolveCodexHomePath(): string {
  const configured = process.env.CODEX_HOME?.trim();
  const candidate = configured ? resolveUserPath(configured) : path.join(os.homedir(), '.codex');
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function computeCodexKeychainAccount(codexHome: string): string {
  const digest = createHash('sha256').update(codexHome).digest('hex');
  return `cli|${digest.slice(0, 16)}`;
}

function codexExpiresAt(lastRefresh: unknown, fallbackMtimeMs?: number): string {
  const parsedLastRefresh =
    typeof lastRefresh === 'string' || typeof lastRefresh === 'number'
      ? new Date(lastRefresh).getTime()
      : NaN;
  const baselineMs = Number.isFinite(parsedLastRefresh)
    ? parsedLastRefresh
    : (typeof fallbackMtimeMs === 'number' && Number.isFinite(fallbackMtimeMs) ? fallbackMtimeMs : Date.now());
  return new Date(baselineMs + 60 * 60 * 1000).toISOString();
}

function parseCodexPayload(raw: string, fallbackMtimeMs?: number): CodexCredentials | null {
  try {
    const parsed = JSON.parse(raw);
    const tokens = parsed?.tokens;
    if (!tokens || typeof tokens !== 'object') return null;
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) return null;
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) return null;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: codexExpiresAt(parsed?.last_refresh, fallbackMtimeMs),
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    };
  } catch {
    return null;
  }
}

export async function readCodexCredentialsBlock(): Promise<CodexCredentials | null> {
  const codexHome = resolveCodexHomePath();
  const authPath = path.join(codexHome, 'auth.json');

  // Try macOS Keychain first (async — does not block the main thread).
  if (process.platform === 'darwin') {
    try {
      const account = computeCodexKeychainAccount(codexHome);
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', CODEX_KEYCHAIN_SERVICE, '-a', account, '-w'],
        { encoding: 'utf8', timeout: 5000 },
      );
      const creds = parseCodexPayload(stdout.trim());
      if (creds) return creds;
    } catch {
      // Missing keychain record or security command unavailable.
    }
  }

  // Fallback file (async).
  try {
    const stat = await fsPromises.stat(authPath);
    const raw = await fsPromises.readFile(authPath, 'utf8');
    return parseCodexPayload(raw, stat.mtimeMs);
  } catch {
    return null;
  }
}

export function refreshCodexTokenBlock(refreshToken: string): Promise<CodexCredentials> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID,
  });
  const body = form.toString();

  return new Promise((resolve, reject) => {
    const url = new URL(CODEX_TOKEN_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            reject(new Error(`Codex token refresh failed (HTTP ${status}): ${text.slice(0, 300)}`));
            return;
          }
          try {
            const data = JSON.parse(text);
            if (typeof data.access_token !== 'string' || !data.access_token) {
              reject(new Error('Codex token refresh response did not include access_token'));
              return;
            }
            const expiresAt = normalizeExpiresAt(data.expires_at)
              || new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000).toISOString();
            resolve({
              accessToken: data.access_token,
              refreshToken: data.refresh_token ?? refreshToken,
              expiresAt,
              accountId: typeof data.account_id === 'string' ? data.account_id : undefined,
            });
          } catch (err) {
            reject(new Error(`Failed to parse Codex token refresh response: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export function chatCodexWithOauthBlock(
  messages: CodexChatMessage[],
  accessToken: string,
  accountId?: string,
  model?: string,
): Promise<CodexChatResult> {
  const requestedModel = typeof model === 'string' && model.trim() ? model.trim() : 'gpt-5.3-codex';
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.content }],
  }));

  const body = JSON.stringify({
    model: requestedModel,
    instructions: 'You are a helpful assistant.',
    input,
    store: false,
    stream: true,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'chatgpt.com',
        path: '/backend-api/codex/responses',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'User-Agent': 'think-space-electron',
          ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let raw = '';
        let sseBuffer = '';
        let text = '';
        let responseModel = requestedModel;
        let usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null = null;

        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) return;
          const payload = trimmed.slice(6).trim();
          if (!payload) return;
          try {
            const evt = JSON.parse(payload);
            const evtType = evt?.type;
            if (evtType === 'response.output_text.delta' && typeof evt?.delta === 'string') {
              text += evt.delta;
            } else if (evtType === 'response.output_text.done' && !text && typeof evt?.text === 'string') {
              text = evt.text;
            } else if (evtType === 'response.completed' && evt?.response) {
              responseModel = typeof evt.response.model === 'string' ? evt.response.model : responseModel;
              usage = evt.response.usage ?? usage;
            }
          } catch {
            // Ignore non-JSON or partial lines.
          }
        };

        res.on('data', (chunk) => {
          const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          raw += str;
          sseBuffer += str;
          let idx = sseBuffer.indexOf('\n');
          while (idx >= 0) {
            const line = sseBuffer.slice(0, idx);
            sseBuffer = sseBuffer.slice(idx + 1);
            handleLine(line);
            idx = sseBuffer.indexOf('\n');
          }
        });

        res.on('end', () => {
          if (status < 200 || status >= 300) {
            reject(new Error(`Codex chat failed (HTTP ${status}): ${raw.slice(0, 300)}`));
            return;
          }
          resolve({
            text,
            model: responseModel,
            inputTokens: usage?.input_tokens,
            outputTokens: usage?.output_tokens,
            totalTokens: usage?.total_tokens,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Azure ──

const AZURE_RESOURCE = 'https://cognitiveservices.azure.com';

export async function readAzureTokenBlock(): Promise<AzureCredentials | null> {
  try {
    const { stdout } = await execAsync(
      `az account get-access-token --resource ${AZURE_RESOURCE} --output json`,
      { encoding: 'utf-8', timeout: 15000 },
    );
    const parsed = JSON.parse(stdout.trim());
    if (!parsed?.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      expiresOn: parsed.expiresOn ?? '',
    };
  } catch {
    return null;
  }
}
