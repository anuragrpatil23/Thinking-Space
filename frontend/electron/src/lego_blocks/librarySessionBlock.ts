// The library session: one signed-in session with the Austin Public Library's
// proxy (EZproxy), shared by every database reached through it — Gale for
// article text, Value Line for company reports.
//
// Trust boundary (docs/contracts/SECURITY.md): the card and PIN come from
// Settings → Webull → Library login (libraryCredentialStoreBlock.ts, safeStorage)
// or, when none is saved there, from the macOS Keychain item the vault's
// library scripts use, read by a child process pinned to the vault. They never
// leave main. Callers build
// their URLs on the library's hosts; the renderer never names one.
//
// EZproxy drops an idle session after about 20 minutes; a page that comes
// back without what was asked for means "log in again", once.

import { app, session as electronSession } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { readPersistedVaultRootBlock } from './vaultRootPersistenceBlock';
import {
  clearLibraryCredentialBlock,
  librarySecureStorageAvailableBlock,
  maskLibraryCardBlock,
  readLibraryCredentialBlock,
  saveLibraryCredentialBlock,
} from './libraryCredentialStoreBlock';

const PROXY_LOGIN = 'https://atxlibrary.idm.oclc.org/login';
const KEYCHAIN_SERVICE = 'atxlibrary-austin';
const PARTITION = 'persist:library';
const PACE_MS = 1500;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export class LibraryLoginErrorBlock extends Error {}

function childCwdBlock(): string {
  const vaultRoot = readPersistedVaultRootBlock();
  return vaultRoot && fs.existsSync(vaultRoot) ? vaultRoot : app.getPath('userData');
}

function securityBlock(args: string[]): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', args, { cwd: childCwdBlock(), timeout: 15_000 }, (error, stdout) => {
      resolve({ stdout: String(stdout ?? ''), ok: !error });
    });
  });
}

async function libraryCredentialBlock(): Promise<{ card: string; password: string }> {
  const saved = await readLibraryCredentialBlock();
  if (saved) return { card: saved.card, password: saved.pin };
  const meta = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE]);
  const card = /"acct"<blob>="([^"]*)"/.exec(meta.stdout)?.[1];
  const secret = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']);
  const password = secret.stdout.trim();
  if (!meta.ok || !card || !secret.ok || !password) {
    throw new LibraryLoginErrorBlock('No library login saved (Settings → Webull → Library login).');
  }
  return { card, password };
}

export interface LibraryCredentialStatusBlock {
  available: boolean
  /** Where the card comes from: saved in Settings, or the Keychain item the vault scripts use. */
  source: 'saved' | 'keychain' | null
  cardHint: string | null
  secureStorageAvailable: boolean
}

/** Whether a credential is stored, without reading the secret into the answer. */
export async function libraryCredentialStatusBlock(): Promise<LibraryCredentialStatusBlock> {
  const secureStorageAvailable = librarySecureStorageAvailableBlock();
  const saved = await readLibraryCredentialBlock();
  if (saved) return { available: true, source: 'saved', cardHint: maskLibraryCardBlock(saved.card), secureStorageAvailable };
  if (process.platform === 'darwin') {
    const meta = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE]);
    const card = meta.ok ? /"acct"<blob>="([^"]+)"/.exec(meta.stdout)?.[1] : undefined;
    if (card) return { available: true, source: 'keychain', cardHint: maskLibraryCardBlock(card), secureStorageAvailable };
  }
  return { available: false, source: null, cardHint: null, secureStorageAvailable };
}

/** Save or clear the card from Settings; the next request signs in with it. */
export async function saveLibraryCardBlock(input: { card: unknown; pin: unknown }): Promise<LibraryCredentialStatusBlock> {
  await saveLibraryCredentialBlock(input);
  loggedIn = false;
  return libraryCredentialStatusBlock();
}

export async function clearLibraryCardBlock(): Promise<LibraryCredentialStatusBlock> {
  await clearLibraryCredentialBlock();
  loggedIn = false;
  return libraryCredentialStatusBlock();
}

// One request at a time, paced, so the library sees a reader, not a crawler.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let loggedIn = false;

function pacedBlock<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + PACE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await work();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

function librarySessionBlock() {
  return electronSession.fromPartition(PARTITION);
}

/** Sign in; the proxy answers with the page at `firstUrl`. */
async function loginBlock(firstUrl: string): Promise<Response> {
  const { card, password } = await libraryCredentialBlock();
  const body = new URLSearchParams({ user: card, pass: password, url: firstUrl }).toString();
  return librarySessionBlock().fetch(PROXY_LOGIN, {
    method: 'POST',
    body,
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

export interface LibraryRequestBlock<T> {
  url: string
  /** POST requests carry no body; the databases take their arguments in the query. */
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  read: (response: Response) => Promise<T>
  /** Whether the response is what was asked for (not a login or error page). */
  expect: (value: T) => boolean
  /**
   * Where signing in should land. Defaults to `url`, whose page the proxy
   * then returns directly; a POST, or a database that sets up its own session
   * on its front page, signs in there and asks again.
   */
  loginUrl?: string
}

/** One library request; signs in first, or again when the session has lapsed. */
export function libraryRequestBlock<T>(request: LibraryRequestBlock<T>): Promise<T> {
  return pacedBlock(async () => {
    const ask = async () => request.read(await librarySessionBlock().fetch(request.url, {
      method: request.method ?? 'GET',
      body: request.method === 'POST' ? '' : undefined,
      headers: { 'User-Agent': BROWSER_UA, ...request.headers },
    }));
    if (loggedIn) {
      const value = await ask();
      if (request.expect(value)) return value;
    }
    const loginUrl = request.loginUrl ?? request.url;
    const landed = await loginBlock(loginUrl);
    let value: T;
    if (loginUrl === request.url && (request.method ?? 'GET') === 'GET') {
      value = await request.read(landed);
    } else {
      await landed.arrayBuffer();
      value = await ask();
    }
    if (!request.expect(value)) {
      loggedIn = false;
      throw new LibraryLoginErrorBlock('The library login did not return the page asked for (check the card, or the proxy is down).');
    }
    loggedIn = true;
    return value;
  });
}

export function decodeEntitiesBlock(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
