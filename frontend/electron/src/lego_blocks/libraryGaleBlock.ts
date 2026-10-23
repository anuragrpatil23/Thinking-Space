// Gale, through the library session (librarySessionBlock.ts), for the full
// text of articles whose own pages are paywalled.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer asks for one of
// two things — a headline search in a known publication, or one article by its
// Gale document id — and this block builds every URL itself, on the library's
// hosts only.

import { decodeEntitiesBlock, libraryRequestBlock } from './librarySessionBlock';

export { libraryCredentialStatusBlock } from './librarySessionBlock';

const GALE = 'https://go-gale-com.atxlibrary.idm.oclc.org/ps/i.do';
const GALE_ACCOUNT = 'txshrpub100020';

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
  const body = await libraryRequestBlock({ url, read: (r) => r.text(), expect: (b) => b.slice(0, 2000).includes('<rss') });
  return parseGaleRssBlock(body);
}

/** One article's text by its Gale document id. */
export async function libraryGaleArticleBlock(p: { docId: string; db: string }): Promise<LibraryGaleArticle> {
  if (!p || typeof p.docId !== 'string' || !/^[A-Z0-9]{6,24}$/.test(p.docId)) throw new Error('library article: bad document id');
  if (!GALE_DATABASES.has(p.db)) throw new Error('library article: unknown database');
  const url = `${GALE}?p=${p.db}&u=${GALE_ACCOUNT}&v=2.1&it=r&id=GALE%7C${p.docId}`;
  const page = await libraryRequestBlock({ url, read: (r) => r.text(), expect: (b) => b.includes('document-summary') || b.includes('document-text') });
  const citationOnly = page.includes('value="CITATION" name="accessLevel"');
  return { text: citationOnly ? '' : extractGaleArticleTextBlock(page), citationOnly };
}
