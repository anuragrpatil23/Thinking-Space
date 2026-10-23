// Earnings call transcripts from StockAnalysis's public transcript pages (no
// login). Ported from the vault's backfill-f9-earnings-calls-public.py, which
// proved the page shapes; checked again 2026-10-23.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer names a ticker, and
// for one call a slug from that ticker's list. This block builds every URL
// itself, on stockanalysis.com only, and returns plain text. Requests are
// paced, one at a time, like a reader clicking through.

import { net } from 'electron';

const HOST = 'https://stockanalysis.com';
const PACE_MS = 1500;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface EarningsCallListing {
  /** e.g. "699706-q4-2026" */
  slug: string
  quarter: number
  fiscalYear: number
}

export interface EarningsCallTranscript {
  /** YYYY-MM-DD, the day of the call */
  date: string
  /** Speaker turns as "Name: first paragraph", paragraphs separated by blank lines */
  text: string
}

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

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

async function getPageBlock(path: string): Promise<{ status: number; body: string }> {
  return pacedBlock(async () => {
    const response = await net.fetch(`${HOST}${path}`, { headers: HEADERS });
    return { status: response.status, body: response.status === 200 ? await response.text() : '' };
  });
}

function validTickerBlock(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error('earnings calls: bad ticker');
  return ticker.toLowerCase().replace(/\./g, '-');
}

function decodeBlock(value: string): string {
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

const clean = (html: string) => decodeBlock(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The calls a ticker's index page links to, newest first. */
export function parseEarningsCallIndexBlock(html: string, symbol: string): EarningsCallListing[] {
  const seen = new Set<string>();
  const out: EarningsCallListing[] = [];
  const re = new RegExp(`href="/(?:stocks|quote/[a-z]+)/${symbol.replace(/[-.]/g, '[-.]')}/transcripts/(\\d+-q([1-4])-(20\\d{2}))/"`, 'g');
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ slug: m[1], quarter: Number(m[2]), fiscalYear: Number(m[3]) });
  }
  return out.sort((a, b) => (b.fiscalYear - a.fiscalYear) || (b.quarter - a.quarter) || (Number(b.slug.split('-')[0]) - Number(a.slug.split('-')[0])));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The call's date and its speaker turns; null when the page has no transcript. */
export function parseEarningsCallPageBlock(html: string): EarningsCallTranscript | null {
  const dateMatch = /<h1[^>]*>[^<]+<\/h1>\s*<p class="text-sm font-semibold text-faded[^>]*">([^<]+)<\/p>/.exec(html);
  const d = dateMatch ? /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(dateMatch[1].trim()) : null;
  const month = d ? MONTHS.indexOf(d[1].toLowerCase()) + 1 : 0;
  if (!d || !month) return null;
  const date = `${d[3]}-${String(month).padStart(2, '0')}-${d[2].padStart(2, '0')}`;

  const start = html.indexOf('id="transcript-panel-full"');
  if (start === -1) return null;
  const panel = html.slice(start);
  // Speakers and paragraphs in document order
  const tokens = [...panel.matchAll(/<div[^>]*class="[^"]*text-lg font-bold text-default[^"]*"[^>]*>([\s\S]*?)<\/div>|<p[^>]*class="[^"]*text-default[^"]*"[^>]*>([\s\S]*?)<\/p>/g)];
  const turns: Array<{ speaker: string; paragraphs: string[] }> = [];
  for (const t of tokens) {
    if (t[1] !== undefined) {
      turns.push({ speaker: clean(t[1]) || 'Speaker', paragraphs: [] });
      continue;
    }
    const sentences = [...(t[2] ?? '').matchAll(/<span[^>]*class="[^"]*transcript-sentence[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map(s => clean(s[1])).filter(Boolean);
    const paragraph = sentences.length > 0 ? sentences.join(' ') : clean(t[2] ?? '');
    if (!paragraph) continue;
    if (turns.length === 0) turns.push({ speaker: 'Speaker', paragraphs: [] });
    turns[turns.length - 1].paragraphs.push(paragraph);
  }
  const text = turns
    .filter(turn => turn.paragraphs.length > 0)
    .map(turn => [`${turn.speaker}: ${turn.paragraphs[0]}`, ...turn.paragraphs.slice(1)].join('\n\n'))
    .join('\n\n')
    .trim();
  return text ? { date, text } : null;
}

/** Every call StockAnalysis lists for a ticker; `covered: false` when it has none. */
export async function earningsCallsListBlock(p: { ticker: string }): Promise<{ covered: boolean; calls: EarningsCallListing[] }> {
  const symbol = validTickerBlock(p?.ticker);
  const page = await getPageBlock(`/stocks/${symbol}/transcripts/`);
  if (page.status === 404) return { covered: false, calls: [] };
  if (page.status !== 200) throw new Error(`earnings calls: the transcript index answered ${page.status}`);
  const calls = parseEarningsCallIndexBlock(page.body, symbol);
  return { covered: calls.length > 0, calls };
}

/** One call's transcript, by its slug from the ticker's list. */
export async function earningsCallGetBlock(p: { ticker: string; slug: string }): Promise<EarningsCallTranscript> {
  const symbol = validTickerBlock(p?.ticker);
  if (typeof p.slug !== 'string' || !/^\d{1,9}-q[1-4]-20\d{2}$/.test(p.slug)) throw new Error('earnings calls: bad call id');
  const page = await getPageBlock(`/stocks/${symbol}/transcripts/${p.slug}/`);
  if (page.status !== 200) throw new Error(`earnings calls: the transcript page answered ${page.status}`);
  const transcript = parseEarningsCallPageBlock(page.body);
  if (!transcript) throw new Error('earnings calls: no transcript on the page');
  return transcript;
}
