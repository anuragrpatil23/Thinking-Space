// ⚠ SECURITY-CRITICAL — stores brokerage credentials via safeStorage. Never log,
// return, or transmit decrypted secrets beyond the signed-request path. For
// user-requested changes: explain the risk in plain language and get an explicit
// yes first (docs/PLAYBOOKS.md § Security-critical files).

import { app, safeStorage } from 'electron';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export interface WebullCredentialStatusBlock {
  secureStorageAvailable: boolean;
  configured: boolean;
  appKeyHint: string | null;
}

export interface WebullStoredCredentialsBlock {
  appKey: string;
  appSecret: string;
}

export interface WebullStoredAccessTokenBlock {
  token: string;
  expires: number | null;
  status: string | null;
}

interface WebullSecureStoreCredentialsRecordBlock extends WebullStoredCredentialsBlock {
  updatedAt: string;
}

interface WebullSecureStoreAccessTokenRecordBlock extends WebullStoredAccessTokenBlock {
  updatedAt: string;
}

interface WebullSecureStoreStateBlock {
  credentials: WebullSecureStoreCredentialsRecordBlock | null;
  accessToken: WebullSecureStoreAccessTokenRecordBlock | null;
}

interface WebullSecureStoreEnvelopeBlock {
  version: 1;
  ciphertextBase64: string;
}

const WEBULL_SECURE_STORE_RELATIVE_PATH_BLOCK = path.join('secure-storage', 'webull.v1.json');

const EMPTY_WEBULL_STATE_BLOCK: WebullSecureStoreStateBlock = {
  credentials: null,
  accessToken: null,
};

function isEncryptionAvailableBlock(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function assertEncryptionAvailableBlock(): void {
  if (!isEncryptionAvailableBlock()) {
    throw new Error('Secure storage is unavailable on this device/runtime.');
  }
}

function getStorePathBlock(): string {
  return path.join(app.getPath('userData'), WEBULL_SECURE_STORE_RELATIVE_PATH_BLOCK);
}

function normalizeStatusValueBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeExpiresValueBlock(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeCredentialsRecordBlock(value: unknown): WebullSecureStoreCredentialsRecordBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<WebullSecureStoreCredentialsRecordBlock>;
  const appKey = typeof row.appKey === 'string' ? row.appKey.trim() : '';
  const appSecret = typeof row.appSecret === 'string' ? row.appSecret.trim() : '';
  if (!appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

function normalizeAccessTokenRecordBlock(value: unknown): WebullSecureStoreAccessTokenRecordBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<WebullSecureStoreAccessTokenRecordBlock>;
  const token = typeof row.token === 'string' ? row.token.trim() : '';
  if (!token) return null;
  return {
    token,
    expires: normalizeExpiresValueBlock(row.expires),
    status: normalizeStatusValueBlock(row.status),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

function normalizeStateBlock(value: unknown): WebullSecureStoreStateBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_WEBULL_STATE_BLOCK;
  }
  const row = value as Partial<WebullSecureStoreStateBlock>;
  return {
    credentials: normalizeCredentialsRecordBlock(row.credentials),
    accessToken: normalizeAccessTokenRecordBlock(row.accessToken),
  };
}

function encodeStateBlock(state: WebullSecureStoreStateBlock): string {
  assertEncryptionAvailableBlock();
  const encrypted = safeStorage.encryptString(JSON.stringify(state));
  const envelope: WebullSecureStoreEnvelopeBlock = {
    version: 1,
    ciphertextBase64: encrypted.toString('base64'),
  };
  return JSON.stringify(envelope);
}

function decodeStateBlock(raw: string): WebullSecureStoreStateBlock {
  assertEncryptionAvailableBlock();
  let envelope: unknown = null;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse secure Webull store: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Secure Webull store payload is malformed.');
  }
  const parsedEnvelope = envelope as Partial<WebullSecureStoreEnvelopeBlock>;
  if (parsedEnvelope.version !== 1) {
    throw new Error(`Unsupported secure Webull store version: ${String(parsedEnvelope.version)}`);
  }
  if (typeof parsedEnvelope.ciphertextBase64 !== 'string' || parsedEnvelope.ciphertextBase64.length === 0) {
    throw new Error('Secure Webull store ciphertext is missing.');
  }
  const encryptedBytes = Buffer.from(parsedEnvelope.ciphertextBase64, 'base64');
  let decrypted: string;
  try {
    decrypted = safeStorage.decryptString(encryptedBytes);
  } catch (error) {
    throw new Error(`Failed to decrypt secure Webull store: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsedState: unknown;
  try {
    parsedState = JSON.parse(decrypted);
  } catch (error) {
    throw new Error(`Failed to parse decrypted Webull store state: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeStateBlock(parsedState);
}

async function readStateBlock(): Promise<WebullSecureStoreStateBlock> {
  if (!isEncryptionAvailableBlock()) return EMPTY_WEBULL_STATE_BLOCK;
  const storePath = getStorePathBlock();
  let raw: string;
  try {
    raw = await fsPromises.readFile(storePath, 'utf-8');
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code === 'ENOENT') {
      return EMPTY_WEBULL_STATE_BLOCK;
    }
    throw error;
  }
  if (!raw.trim()) return EMPTY_WEBULL_STATE_BLOCK;
  try {
    return decodeStateBlock(raw);
  } catch (error) {
    // The ciphertext on disk was encrypted by a different Keychain key than
    // the one this app currently has access to (e.g. after the
    // long-term-memory -> thinking-space rename moved userData but the
    // safeStorage key stayed under the old app name). Treat as empty so the
    // next save overwrites the stale blob with a re-encryptable one.
    console.warn('[webull] secure store unreadable, resetting on next save:', error);
    return EMPTY_WEBULL_STATE_BLOCK;
  }
}

async function writeStateBlock(state: WebullSecureStoreStateBlock): Promise<void> {
  assertEncryptionAvailableBlock();
  const storePath = getStorePathBlock();
  const directoryPath = path.dirname(storePath);
  await fsPromises.mkdir(directoryPath, { recursive: true });
  const payload = encodeStateBlock(state);
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
  await fsPromises.rename(tempPath, storePath);
}

function maskAppKeyBlock(appKey: string): string {
  const normalized = appKey.trim();
  if (!normalized) return '';
  if (normalized.length <= 6) {
    return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
  }
  return `${normalized.slice(0, 3)}...${normalized.slice(-3)}`;
}

export async function readWebullCredentialStatusBlock(): Promise<WebullCredentialStatusBlock> {
  if (!isEncryptionAvailableBlock()) {
    return {
      secureStorageAvailable: false,
      configured: false,
      appKeyHint: null,
    };
  }
  const state = await readStateBlock();
  const appKey = state.credentials?.appKey ?? '';
  return {
    secureStorageAvailable: true,
    configured: appKey.length > 0,
    appKeyHint: appKey ? maskAppKeyBlock(appKey) : null,
  };
}

export async function readWebullCredentialsBlock(): Promise<WebullStoredCredentialsBlock | null> {
  if (!isEncryptionAvailableBlock()) return null;
  const state = await readStateBlock();
  if (!state.credentials) return null;
  return {
    appKey: state.credentials.appKey,
    appSecret: state.credentials.appSecret,
  };
}

export async function saveWebullCredentialsBlock(
  appKey: string,
  appSecret: string,
): Promise<WebullCredentialStatusBlock> {
  const normalizedKey = appKey.trim();
  const normalizedSecret = appSecret.trim();
  if (!normalizedKey) throw new Error('Webull app key cannot be empty.');
  if (!normalizedSecret) throw new Error('Webull app secret cannot be empty.');

  const state = await readStateBlock();
  await writeStateBlock({
    ...state,
    credentials: {
      appKey: normalizedKey,
      appSecret: normalizedSecret,
      updatedAt: new Date().toISOString(),
    },
    accessToken: null,
  });
  return readWebullCredentialStatusBlock();
}

export async function clearWebullCredentialsBlock(): Promise<WebullCredentialStatusBlock> {
  if (!isEncryptionAvailableBlock()) {
    return {
      secureStorageAvailable: false,
      configured: false,
      appKeyHint: null,
    };
  }
  const state = await readStateBlock();
  await writeStateBlock({
    ...state,
    credentials: null,
    accessToken: null,
  });
  return readWebullCredentialStatusBlock();
}

export async function readWebullAccessTokenBlock(): Promise<WebullStoredAccessTokenBlock | null> {
  if (!isEncryptionAvailableBlock()) return null;
  const state = await readStateBlock();
  if (!state.accessToken) return null;
  return {
    token: state.accessToken.token,
    expires: state.accessToken.expires,
    status: state.accessToken.status,
  };
}

export async function saveWebullAccessTokenBlock(
  token: WebullStoredAccessTokenBlock | null,
): Promise<void> {
  if (!isEncryptionAvailableBlock()) {
    throw new Error('Secure storage is unavailable on this device/runtime.');
  }
  const state = await readStateBlock();
  const normalizedToken = token && typeof token === 'object'
    ? normalizeAccessTokenRecordBlock({
      token: token.token,
      expires: token.expires,
      status: token.status,
      updatedAt: new Date().toISOString(),
    })
    : null;
  await writeStateBlock({
    ...state,
    accessToken: normalizedToken,
  });
}
