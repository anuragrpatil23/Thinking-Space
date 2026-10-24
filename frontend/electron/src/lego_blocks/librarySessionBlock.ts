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

/** A database's address as the proxy serves it: research.valueline.com → research-valueline-com.<proxy>. */
export function proxiedUrlBlock(raw: string): string {
  const url = new URL(raw);
  const proxy = new URL(PROXY_LOGIN).hostname;
  if (url.hostname.endsWith(proxy)) return url.toString();
  url.hostname = `${url.hostname.replace(/\./g, '-')}.${proxy}`;
  url.protocol = 'https:';
  return url.toString();
}

/** The target of a page's <meta http-equiv="refresh">, when it has one. */
export function metaRefreshTargetBlock(html: string, base: string): string | null {
  const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)["']/i.exec(html);
  if (!m) return null;
  try {
    return new URL(decodeEntitiesBlock(m[1].trim()), base).toString();
  } catch {
    return null;
  }
}

/** A page that moves a browser on by itself: a self-submitting form, a script redirect, a refresh. */
export type PageHopBlock =
  | { kind: 'form'; action: string; method: 'GET' | 'POST'; fields: Array<[string, string]> }
  | { kind: 'script' | 'refresh'; url: string }

function attrBlock(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntitiesBlock(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** How this page would move a browser on, if it would (only ever within the library's proxy). */
export function pageHopBlock(html: string, base: string): PageHopBlock | null {
  const proxySuffix = new URL(PROXY_LOGIN).hostname;
  const inProxy = (url: string) => {
    try {
      const host = new URL(url).hostname;
      return host === proxySuffix || host.endsWith(`.${proxySuffix}`);
    } catch {
      return false;
    }
  };
  const resolve = (raw: string) => {
    try { return new URL(raw, base).toString(); } catch { return null; }
  };
  const refresh = metaRefreshTargetBlock(html, base);
  if (refresh && inProxy(refresh)) return { kind: 'refresh', url: refresh };
  const formTag = /<form\b[^>]*>/i.exec(html)?.[0];
  if (formTag) {
    const body = html.slice(html.indexOf(formTag), html.search(/<\/form>/i) > 0 ? html.search(/<\/form>/i) : undefined);
    const inputs = [...body.matchAll(/<input\b[^>]*>/gi)].map(m => m[0]);
    const visible = inputs.some(tag => /type\s*=\s*["']?(text|password|email)/i.test(tag) || !/type\s*=/i.test(tag));
    const autoSubmits = /\.submit\s*\(\s*\)/.test(html) || /onload\s*=\s*["'][^"']*submit/i.test(html);
    const action = resolve(attrBlock(formTag, 'action') ?? base);
    if (action && inProxy(action) && !visible && (autoSubmits || inputs.length > 0)) {
      const fields = inputs.flatMap((tag): Array<[string, string]> => {
        const name = attrBlock(tag, 'name');
        return name ? [[name, attrBlock(tag, 'value') ?? '']] : [];
      });
      return { kind: 'form', action, method: (attrBlock(formTag, 'method') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET', fields };
    }
  }
  const script = /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/.exec(html);
  const target = script ? resolve(decodeEntitiesBlock(script[1] ?? script[2])) : null;
  if (target && inProxy(target)) return { kind: 'script', url: target };
  return null;
}

/**
 * What a page is, for the log, without what it holds: its type, size, title,
 * how it would move on (form target and field names, never values; a script
 * or refresh target), whether it is a login form, and its first visible words.
 */
function pageSummaryBlock(text: string, contentType: string | null, base: string): string {
  const title = /<title[^>]*>([^<]{0,120})/i.exec(text)?.[1]?.replace(/\s+/g, ' ').trim();
  const hop = pageHopBlock(text, base);
  const formTag = /<form\b[^>]*>/i.exec(text)?.[0];
  const formNames = formTag ? [...text.matchAll(/<input\b[^>]*\bname\s*=\s*["']?([\w.-]+)/gi)].map(m => m[1]).slice(0, 8) : [];
  const words = text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const parts = [
    contentType ? contentType.split(';')[0] : 'no type',
    `${text.length} chars`,
    /^\s*[[{]/.test(text) ? 'JSON' : null,
    title ? `title "${title}"` : null,
    hop ? (hop.kind === 'form' ? `a ${hop.method} form to ${urlForLogBlock(hop.action)}` : `${hop.kind === 'script' ? 'a script redirect' : 'a refresh'} to ${urlForLogBlock(hop.url)}`) : null,
    formTag && !hop ? `a form to ${urlForLogBlock(attrBlock(formTag, 'action') ?? '')}` : null,
    formNames.length ? `fields ${formNames.join(',')}` : null,
    /<script\b/i.test(text) ? 'scripts' : null,
    /name=["']pass["']/i.test(text) ? 'a login form' : null,
    words ? `text "${words}"` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

/** Follow a page's own hops (at most a few), the way a browser would; the last page reached. */
async function followHopsBlock(page: string, url: string): Promise<{ page: string; url: string }> {
  let current = { page, url };
  for (let hop = 0; hop < 4; hop += 1) {
    const next = pageHopBlock(current.page, current.url);
    if (!next) break;
    const init: RequestInit = next.kind === 'form' && next.method === 'POST'
      ? { method: 'POST', body: new URLSearchParams(next.fields).toString(), headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' } }
      : { headers: { 'User-Agent': BROWSER_UA } };
    const target = next.kind === 'form' && next.method === 'GET'
      ? `${next.action}${next.action.includes('?') ? '&' : '?'}${new URLSearchParams(next.fields).toString()}`
      : next.kind === 'form' ? next.action : next.url;
    const response = await loggedFetchBlock(`hop(${next.kind})`, target, init);
    current = { page: await response.text().catch(() => ''), url: response.url || target };
  }
  return current;
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
    // What the last answer was, when it was not what was asked for (for the log)
    let mismatch: string | null = null;
    const askOnce = async () => {
      const response = await loggedFetchBlock('ask', request.url, {
        method: request.method ?? 'GET',
        body: request.method === 'POST' ? '' : undefined,
        headers: { 'User-Agent': BROWSER_UA, ...request.headers },
      });
      const copy = response.clone();
      const value = await request.read(response);
      if (request.expect(value)) return { value, page: null as string | null, at: request.url };
      const page = await copy.text().catch(() => '');
      mismatch = pageSummaryBlock(page, copy.headers.get('content-type'), copy.url || request.url);
      return { value, page, at: copy.url || request.url };
    };
    const ask = async () => {
      const first = await askOnce();
      // The answer was a page that moves on by itself: follow it, then ask again
      if (first.page !== null && pageHopBlock(first.page, first.at)) {
        await followHopsBlock(first.page, first.at);
        return (await askOnce()).value;
      }
      return first.value;
    };
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
      const proxyHost = new URL(PROXY_LOGIN).hostname;
      let stayed = true;
      try {
        const at = new URL(landed.url || PROXY_LOGIN);
        stayed = at.hostname.endsWith(proxyHost) && !at.hostname.includes('-') && /\/login/i.test(at.pathname);
      } catch { /* keep: treat as not redirected */ }
      if (!stayed && loginUrl === request.url && (request.method ?? 'GET') === 'GET') return request.read(landed);
      const page = await landed.text().catch(() => '');
      if (stayed) {
        // The proxy answered without sending us on: a refresh page, or the
        // login form again. Finish the hop the way a browser would.
        libraryLogBlock(`after signing in, still at the proxy: ${pageSummaryBlock(page, landed.headers.get('content-type'), PROXY_LOGIN)}`);
        if (/name=["']pass["']/i.test(page)) {
          throw new LibraryLoginErrorBlock('The library did not accept the login (check Settings → Webull → Library login).');
        }
        await followHopsBlock(page, landed.url || PROXY_LOGIN);
        const start = await loggedFetchBlock('start', proxiedUrlBlock(loginUrl), { headers: { 'User-Agent': BROWSER_UA } });
        const startPage = await start.text().catch(() => '');
        const reached = await followHopsBlock(startPage, start.url || proxiedUrlBlock(loginUrl));
        libraryLogBlock(`start page: ${pageSummaryBlock(reached.page, null, reached.url)}`);
      }
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
      libraryLogBlock(`not the page asked for: ${urlForLogBlock(request.url)}${mismatch ? ` (got ${mismatch})` : ''}`);
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
