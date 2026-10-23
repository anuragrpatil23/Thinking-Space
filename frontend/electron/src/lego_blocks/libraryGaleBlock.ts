// The library session: Gale (through the Austin Public Library's proxy) for
// the full text of articles whose own pages are paywalled.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer never sees the
// library card or password, and never names a URL. It asks for one of two
// things — a headline search in a known publication, or one article by its
// Gale document id — and this block builds every URL itself, on the library's
// hosts only. The credential is read from the macOS Keychain (the item the
// vault's library scripts already use) by a child process pinned to the vault.
//
// EZproxy drops an idle session after about 20 minutes; a page that comes
// back without what was asked for means "log in again", once.

import { app, session as electronSession } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { readPersistedVaultRootBlock } from './vaultRootPersistenceBlock';

const PROXY_LOGIN = 'https://atxlibrary.idm.oclc.org/login';
const GALE = 'https://go-gale-com.atxlibrary.idm.oclc.org/ps/i.do';
const GALE_ACCOUNT = 'txshrpub100020';
const KEYCHAIN_SERVICE = 'atxlibrary-austin';
const PARTITION = 'persist:library';
const PACE_MS = 1500;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** The publications a search may name (Gale's PU field), and the databases. */
const GALE_PUBLICATIONS = new Set([
  'The New York Times (Digital Edition)',
  'Washingtonpost.com',
  'The Guardian (London, England)',
  'WIRED',
  'The Economist',
]);
const GALE_DATABASES = new Set(['STND', 'ITOF']);

export interface LibraryGaleSearchPayload {
  publication: string
  words: string[]
  /** YYYY-MM-DD: the article's day; the search spans ± windowDays. */
  day: string
  db: string
  windowDays: number
}

export interface LibraryGaleHit {
  title: string
  docId: string
  sourceLine: string
}

export interface LibraryGaleArticle {
  text: string
  /** The library has only the citation, no text. */
  citationOnly: boolean
}

class LibraryLoginErrorBlock extends Error {}

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

async function keychainCredentialBlock(): Promise<{ card: string; password: string }> {
  const meta = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE]);
  const card = /"acct"<blob>="([^"]*)"/.exec(meta.stdout)?.[1];
  const secret = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']);
  const password = secret.stdout.trim();
  if (!meta.ok || !card || !secret.ok || !password) {
    throw new LibraryLoginErrorBlock('The library card is not in the Keychain (service atxlibrary-austin).');
  }
  return { card, password };
}

/** Whether a credential is stored, without reading the secret. */
export async function libraryCredentialStatusBlock(): Promise<{ available: boolean }> {
  if (process.platform !== 'darwin') return { available: false };
  const meta = await securityBlock(['find-generic-password', '-s', KEYCHAIN_SERVICE]);
  return { available: meta.ok && /"acct"<blob>="[^"]+"/.test(meta.stdout) };
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

async function getTextBlock(url: string): Promise<string> {
  const response = await librarySessionBlock().fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  return response.text();
}

async function loginBlock(firstUrl: string): Promise<string> {
  const { card, password } = await keychainCredentialBlock();
  const body = new URLSearchParams({ user: card, pass: password, url: firstUrl }).toString();
  const response = await librarySessionBlock().fetch(PROXY_LOGIN, {
    method: 'POST',
    body,
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.text();
}

/** Get a library page; log in first, or again when the session has lapsed. */
async function fetchLibraryPageBlock(url: string, expect: (body: string) => boolean): Promise<string> {
  return pacedBlock(async () => {
    if (loggedIn) {
      const body = await getTextBlock(url);
      if (expect(body)) return body;
    }
    const body = await loginBlock(url);
    if (!expect(body)) {
      loggedIn = false;
      throw new LibraryLoginErrorBlock('The library login did not return the page asked for (check the card, or the proxy is down).');
    }
    loggedIn = true;
    return body;
  });
}

function decodeEntitiesBlock(value: string): string {
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

export function parseGaleRssBlock(body: string): LibraryGaleHit[] {
  const hits: LibraryGaleHit[] = [];
  for (const chunk of body.split('<item>').slice(1)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(chunk)?.[1];
    const desc = /<description>([\s\S]*?)<\/description>/.exec(chunk)?.[1] ?? '';
    const docId = link ? /id=GALE%7C([A-Z0-9]+)/.exec(decodeEntitiesBlock(link))?.[1] : undefined;
    if (!title || !docId) continue;
    hits.push({ title: decodeEntitiesBlock(title).trim(), docId, sourceLine: decodeEntitiesBlock(desc).trim() });
  }
  return hits;
}

const SKIP_LINES_RE = /^(Save documents|Gale Document Number|Timestamp:|Source Citation|To stay on top|Full Text:)/i;

export function extractGaleArticleTextBlock(page: string): string {
  const start = page.indexOf('class="document-text"');
  if (start === -1) return '';
  let end = page.length;
  for (const marker of ['Gale Document Number', 'Source Citation', 'class="document-citation']) {
    const i = page.indexOf(marker, start);
    if (i !== -1) end = Math.min(end, i);
  }
  const paragraphs: string[] = [];
  for (const m of page.slice(start, end).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntitiesBlock(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text && !SKIP_LINES_RE.test(text)) paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

function shiftDayBlock(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function validateSearchBlock(p: LibraryGaleSearchPayload): void {
  if (!p || typeof p !== 'object') throw new Error('library search: payload must be an object');
  if (!GALE_PUBLICATIONS.has(p.publication)) throw new Error('library search: unknown publication');
  if (!GALE_DATABASES.has(p.db)) throw new Error('library search: unknown database');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.day)) throw new Error('library search: day must be YYYY-MM-DD');
  if (!Number.isInteger(p.windowDays) || p.windowDays < 0 || p.windowDays > 60) throw new Error('library search: windowDays out of range');
  if (!Array.isArray(p.words) || p.words.length === 0 || p.words.length > 4 || !p.words.every((w) => typeof w === 'string' && /^[a-z0-9]{2,30}$/.test(w))) {
    throw new Error('library search: words must be 1-4 lowercase words');
  }
}

/** Headline search in one publication, within a few days of the article. */
export async function libraryGaleSearchBlock(p: LibraryGaleSearchPayload): Promise<LibraryGaleHit[]> {
  validateSearchBlock(p);
  const params = new URLSearchParams({
    p: p.db, u: GALE_ACCOUNT, v: '2.1', it: 'rss', ty: 'bs',
    qt: `PU~"${p.publication}"${p.words.map((w) => `~~TI~${w}`).join('')}`,
    lm: `DA~1${shiftDayBlock(p.day, -p.windowDays)}-1${shiftDayBlock(p.day, p.windowDays)}`,
    sort: 'DA-SORT', searchType: 'BasicSearchForm',
  });
  const url = `${GALE}?${params.toString().replace(/%7E/g, '~')}`;
  const body = await fetchLibraryPageBlock(url, (b) => b.slice(0, 2000).includes('<rss'));
  return parseGaleRssBlock(body);
}

/** One article's text by its Gale document id. */
export async function libraryGaleArticleBlock(p: { docId: string; db: string }): Promise<LibraryGaleArticle> {
  if (!p || typeof p.docId !== 'string' || !/^[A-Z0-9]{6,24}$/.test(p.docId)) throw new Error('library article: bad document id');
  if (!GALE_DATABASES.has(p.db)) throw new Error('library article: unknown database');
  const url = `${GALE}?p=${p.db}&u=${GALE_ACCOUNT}&v=2.1&it=r&id=GALE%7C${p.docId}`;
  const page = await fetchLibraryPageBlock(url, (b) => b.includes('document-summary') || b.includes('document-text'));
  const citationOnly = page.includes('value="CITATION" name="accessLevel"');
  return { text: citationOnly ? '' : extractGaleArticleTextBlock(page), citationOnly };
}
