// ⚠ SECURITY-CRITICAL — stores the library card and PIN via safeStorage. Never
// log, return, or transmit the PIN beyond the proxy's login form
// (librarySessionBlock.ts). The renderer can save or clear it and read back a
// masked card hint, nothing more.
//
// Same shape as webullCredentialStoreBlock.ts: one encrypted JSON envelope in
// userData, written atomically with mode 0600, unreadable ciphertext treated
// as empty so the next save replaces it.

import { app, safeStorage } from 'electron';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export interface LibraryStoredCredentialBlock {
  card: string
  pin: string
}

const STORE_RELATIVE_PATH = path.join('secure-storage', 'library.v1.json');

function storePathBlock(): string {
  return path.join(app.getPath('userData'), STORE_RELATIVE_PATH);
}

export function librarySecureStorageAvailableBlock(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** The saved card and PIN, or null when none is saved (or it can't be read). */
export async function readLibraryCredentialBlock(): Promise<LibraryStoredCredentialBlock | null> {
  if (!librarySecureStorageAvailableBlock()) return null;
  let raw: string;
  try {
    raw = await fsPromises.readFile(storePathBlock(), 'utf-8');
  } catch {
    return null;
  }
  try {
    const envelope = JSON.parse(raw) as { version?: unknown; ciphertextBase64?: unknown };
    if (envelope.version !== 1 || typeof envelope.ciphertextBase64 !== 'string') return null;
    const state = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.ciphertextBase64, 'base64'))) as Partial<LibraryStoredCredentialBlock>;
    const card = typeof state.card === 'string' ? state.card.trim() : '';
    const pin = typeof state.pin === 'string' ? state.pin : '';
    return card && pin ? { card, pin } : null;
  } catch (error) {
    console.warn('[library] secure store unreadable, resetting on next save:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

export async function saveLibraryCredentialBlock(input: { card: unknown; pin: unknown }): Promise<void> {
  if (!librarySecureStorageAvailableBlock()) throw new Error('Secure storage is unavailable on this device/runtime.');
  const card = typeof input?.card === 'string' ? input.card.replace(/\s+/g, '') : '';
  const pin = typeof input?.pin === 'string' ? input.pin.trim() : '';
  if (!/^\S{2,64}$/.test(card)) throw new Error('Enter the library username.');
  if (!pin || pin.length > 128) throw new Error('Enter the library password.');
  const ciphertextBase64 = safeStorage.encryptString(JSON.stringify({ card, pin, updatedAt: new Date().toISOString() })).toString('base64');
  const storePath = storePathBlock();
  await fsPromises.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tempPath, JSON.stringify({ version: 1, ciphertextBase64 }), { encoding: 'utf-8', mode: 0o600 });
  await fsPromises.rename(tempPath, storePath);
}

export async function clearLibraryCredentialBlock(): Promise<void> {
  await fsPromises.rm(storePathBlock(), { force: true });
}

/** "…4821": enough to recognise the card. */
export function maskLibraryCardBlock(card: string): string {
  return card.length <= 4 ? '…' : `…${card.slice(-4)}`;
}
