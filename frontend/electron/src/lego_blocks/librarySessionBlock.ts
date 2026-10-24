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

// A plain log of library requests (~/.thinking-space/logs/library.log), so a
// failing session can be read after the fact: what was asked, what came back,
// where the redirects landed. Never the login form or anything in it: a URL is
// logged as host, path and the names of its query parameters.
const LOG_MAX_BYTES = 1_000_000;

function logPathBlock(): string {
  return `${app.getPath('home')}/.thinking-space/logs/library.log`;
}

function urlForLogBlock(raw: string): string {
  try {
    const url = new URL(raw);
    const keys = [...url.searchParams.keys()];
    return `${url.host}${url.pathname}${keys.length ? `?${keys.join('&')}` : ''}`;
  } catch {
    return '(bad url)';
  }
}

export function libraryLogBlock(line: string): void {
  try {
    const path = logPathBlock();
    fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
    if (fs.existsSync(path) && fs.statSync(path).size > LOG_MAX_BYTES) fs.renameSync(path, `${path}.1`);
    fs.appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging never breaks a request */ }
}

/** A session fetch that leaves a line in the log: status and landing, or the error. */
async function loggedFetchBlock(label: string, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    const response = await librarySessionBlock().fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const landed = response.url && response.url !== url ? ` landed ${urlForLogBlock(response.url)}` : '';
    libraryLogBlock(`${label} ${init.method ?? 'GET'} ${urlForLogBlock(url)} -> ${response.status}${landed}`);
    return response;
  } catch (err) {
    libraryLogBlock(`${label} ${init.method ?? 'GET'} ${urlForLogBlock(url)} -> ${String(err).slice(0, 200)}`);
    throw err;
  }
}

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
// A request the user is waiting on (a click on a company page) goes ahead of
// background work (filling articles, the daily pass), and every request has a
// time limit, so one that hangs fails instead of holding up all the others.
let lastRequestAt = 0;
let loggedIn = false;
/** For a set of start pages, the one that last signed in without looping. */
const workingLoginUrls = new Map<string, string>();
const REQUEST_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 45_000;
const JOB_TIMEOUT_MS = 90_000;

interface LibraryJobBlock {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  urgent: boolean
}
const jobs: LibraryJobBlock[] = [];
let working = false;

async function pumpBlock(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const wait = lastRequestAt + PACE_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        // A job (sign-in and a retry included) never holds the queue longer than this
        job.resolve(await Promise.race([
          job.run(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('The library did not answer in time.')), JOB_TIMEOUT_MS)),
        ]));
      } catch (err) {
        if (err instanceof Error && /did not answer in time|aborted|timeout/i.test(err.message)) libraryLogBlock(`gave up waiting: ${err.message}`);
        job.reject(err);
      } finally {
        lastRequestAt = Date.now();
      }
    }
  } finally {
    working = false;
  }
}

function pacedBlock<T>(work: () => Promise<T>, urgent = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: LibraryJobBlock = { run: work, resolve: resolve as (v: unknown) => void, reject, urgent };
    if (urgent) {
      // After any other waiting urgent requests, ahead of the background ones
      const at = jobs.findIndex((j) => !j.urgent);
      if (at === -1) jobs.push(job);
      else jobs.splice(at, 0, job);
    } else {
      jobs.push(job);
    }
    void pumpBlock();
  });
}

function librarySessionBlock() {
  return electronSession.fromPartition(PARTITION);
}

/** Sign in; the proxy answers with the page at `firstUrl`. */
async function loginBlock(firstUrl: string): Promise<Response> {
  const { card, password } = await libraryCredentialBlock();
  const body = new URLSearchParams({ user: card, pass: password, url: firstUrl }).toString();
  return loggedFetchBlock(`login(${urlForLogBlock(firstUrl)})`, PROXY_LOGIN, {
    method: 'POST',
    body,
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
  }, LOGIN_TIMEOUT_MS);
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
   * on its front page, signs in there and asks again. Several are tried in
   * order when one loops (a database that moved its front page); the one
   * that worked is tried first next time.
   */
  loginUrl?: string | string[]
  /** The user is waiting on it: goes ahead of background requests */
  urgent?: boolean
}

/** One library request; signs in first, or again when the session has lapsed. */
export function libraryRequestBlock<T>(request: LibraryRequestBlock<T>): Promise<T> {
  return pacedBlock(async () => {
    const ask = async () => request.read(await loggedFetchBlock('ask', request.url, {
      method: request.method ?? 'GET',
      body: request.method === 'POST' ? '' : undefined,
      headers: { 'User-Agent': BROWSER_UA, ...request.headers },
    }));
    if (loggedIn) {
      try {
        const value = await ask();
        if (request.expect(value)) return value;
      } catch {
        // A lapsed session can answer with a redirect loop instead of a login page
      }
    }
    const candidates = Array.isArray(request.loginUrl) ? request.loginUrl : [request.loginUrl ?? request.url];
    const groupKey = candidates.join(' ');
    const preferred = workingLoginUrls.get(groupKey);
    const ordered = preferred && candidates.includes(preferred) ? [preferred, ...candidates.filter(c => c !== preferred)] : candidates;
    const signInAndAsk = async (loginUrl: string): Promise<T> => {
      const landed = await loginBlock(loginUrl);
      if (loginUrl === request.url && (request.method ?? 'GET') === 'GET') return request.read(landed);
      await landed.arrayBuffer();
      return ask();
    };
    const loops = (err: unknown) => /ERR_TOO_MANY_REDIRECTS/.test(String(err));
    let value: T | undefined;
    let lastLoop: unknown = null;
    for (const [index, loginUrl] of ordered.entries()) {
      try {
        value = await signInAndAsk(loginUrl);
      } catch (err) {
        if (!loops(err)) throw err;
        // Stale cookies can keep the proxy and the database bouncing between
        // each other; start from a clean session and sign in once more.
        libraryLogBlock(`redirect loop signing in at ${urlForLogBlock(loginUrl)}: clearing cookies, signing in again`);
        await librarySessionBlock().clearStorageData({ storages: ['cookies'] });
        try {
          value = await signInAndAsk(loginUrl);
        } catch (again) {
          if (!loops(again)) throw again;
          lastLoop = again;
          if (index < ordered.length - 1) libraryLogBlock(`still looping at ${urlForLogBlock(loginUrl)}: trying the next start page`);
          continue;
        }
      }
      if (ordered.length > 1) workingLoginUrls.set(groupKey, loginUrl);
      break;
    }
    if (value === undefined) {
      libraryLogBlock(`every start page loops: ${ordered.map(urlForLogBlock).join(', ')}`);
      loggedIn = false;
      throw new LibraryLoginErrorBlock(`The library sign-in loops (${String(lastLoop).slice(0, 80)}). The database may have moved its page; try the library's own link in a browser.`);
    }
    if (!request.expect(value)) {
      libraryLogBlock(`not the page asked for: ${urlForLogBlock(request.url)}`);
      loggedIn = false;
      throw new LibraryLoginErrorBlock('The library login did not return the page asked for (check the card, or the proxy is down).');
    }
    loggedIn = true;
    return value;
  }, request.urgent === true);
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
