// Option chains from Yahoo Finance's public options endpoint. The endpoint
// wants the cookie and "crumb" its own pages set, so this block keeps them in
// a private in-memory session (never the app's default one) and asks for a
// new crumb once when Yahoo turns one down.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer names a ticker and,
// optionally, an expiry as a whole number of seconds. This block builds every
// URL itself, on Yahoo's hosts only, and returns only the numbers the F9 drop
// view records: the price, the expiry dates, and each call's strike, bid, ask,
// last price, implied volatility, open interest and volume. Requests are paced,
// one at a time.

import { session as electronSession } from 'electron';

const PARTITION = 'yahoo-options';
const COOKIE_URL = 'https://fc.yahoo.com';
const CRUMB_URL = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const OPTIONS_URL = 'https://query1.finance.yahoo.com/v7/finance/options';
const PACE_MS = 800;
const LIMITED_WAITS_MS = [4_000, 15_000];
const CLASS_SYMBOLS: Record<string, string> = { BRKA: 'BRK-A', BRKB: 'BRK-B', BFA: 'BF-A', BFB: 'BF-B' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface YahooOptionCall {
  strike: number
  bid: number | null
  ask: number | null
  last: number | null
  /** As a fraction: 0.35 is 35% */
  iv: number | null
  openInterest: number | null
  volume: number | null
}

export interface YahooOptionChain {
  /** False when Yahoo lists no options for this ticker */
  covered: boolean
  price: number | null
  /** From the same quote: market value and price/earnings, null when Yahoo leaves them out */
  marketCap: number | null
  trailingPe: number | null
  forwardPe: number | null
  /** When the quote's price was set, seconds since 1970: tells the trading day it belongs to */
  marketTime: number | null
  /** Every listed expiry, seconds since 1970 */
  expirations: number[]
  /** The expiry these calls are for */
  expiry: number | null
  calls: YahooOptionCall[]
}

let crumb: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function sessionBlock() {
  return electronSession.fromPartition(PARTITION);
}

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

async function getBlock(url: string): Promise<{ status: number; body: string }> {
  const response = await sessionBlock().fetch(url, { headers: HEADERS });
  return { status: response.status, body: await response.text() };
}

async function freshCrumbBlock(): Promise<string> {
  await getBlock(COOKIE_URL).catch(() => undefined); // sets the cookie; the page itself is a 404
  const { status, body } = await getBlock(CRUMB_URL);
  const value = body.trim();
  if (status !== 200 || !value || value.length > 64 || /[\s<]/.test(value)) throw new Error(`yahoo options: no crumb (HTTP ${status})`);
  crumb = value;
  return value;
}

function validTickerBlock(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error('yahoo options: bad ticker');
  // Webull writes a share class without its separator (BRKB); Yahoo wants BRK-B.
  return CLASS_SYMBOLS[ticker] ?? ticker.replace(/\./g, '-');
}

function validExpiryBlock(expiry: unknown): number | null {
  if (expiry === undefined || expiry === null) return null;
  if (typeof expiry !== 'number' || !Number.isInteger(expiry) || expiry < 1e9 || expiry > 4e9) throw new Error('yahoo options: bad expiry');
  return expiry;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The compact chain from Yahoo's JSON; exported for tests. */
export function parseYahooOptionsBlock(body: string): YahooOptionChain {
  const empty: YahooOptionChain = { covered: false, price: null, marketCap: null, trailingPe: null, forwardPe: null, marketTime: null, expirations: [], expiry: null, calls: [] };
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return empty;
  }
  const result = (data as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as
    | { quote?: { regularMarketPrice?: unknown; regularMarketTime?: unknown; marketCap?: unknown; trailingPE?: unknown; forwardPE?: unknown }; expirationDates?: unknown[]; options?: Array<{ expirationDate?: unknown; calls?: unknown[] }> }
    | undefined;
  if (!result) return empty;
  const expirations = (result.expirationDates ?? []).map(num).filter((x): x is number => x !== null);
  const block = result.options?.[0];
  const calls = (block?.calls ?? []).flatMap((raw) => {
    const c = raw as Record<string, unknown>;
    const strike = num(c.strike);
    if (strike === null) return [];
    return [{
      strike,
      bid: num(c.bid),
      ask: num(c.ask),
      last: num(c.lastPrice),
      iv: num(c.impliedVolatility),
      openInterest: num(c.openInterest),
      volume: num(c.volume),
    }];
  });
  const q = result.quote;
  return {
    covered: expirations.length > 0,
    price: num(q?.regularMarketPrice),
    marketCap: num(q?.marketCap),
    trailingPe: num(q?.trailingPE),
    forwardPe: num(q?.forwardPE),
    marketTime: num(q?.regularMarketTime),
    expirations,
    expiry: num(block?.expirationDate),
    calls,
  };
}

export async function yahooOptionsChainBlock(payload: { ticker: unknown; expiry?: unknown }): Promise<YahooOptionChain> {
  const symbol = validTickerBlock(payload?.ticker);
  const expiry = validExpiryBlock(payload?.expiry);
  return pacedBlock(async () => {
    const url = (c: string) => `${OPTIONS_URL}/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(c)}${expiry ? `&date=${expiry}` : ''}`;
    let response = await getBlock(url(crumb ?? (await freshCrumbBlock())));
    if (response.status === 401 || response.status === 403) response = await getBlock(url(await freshCrumbBlock()));
    // Yahoo limits how fast it is asked: wait and ask again (the queue waits too).
    for (const wait of LIMITED_WAITS_MS) {
      if (response.status !== 429) break;
      await new Promise((r) => setTimeout(r, wait));
      response = await getBlock(url(crumb ?? (await freshCrumbBlock())));
    }
    if (response.status === 429) throw new Error('yahoo options: rate limited (HTTP 429)');
    if (response.status === 404) return { covered: false, price: null, marketCap: null, trailingPe: null, forwardPe: null, marketTime: null, expirations: [], expiry: null, calls: [] };
    if (response.status !== 200) throw new Error(`yahoo options: HTTP ${response.status}`);
    return parseYahooOptionsBlock(response.body);
  });
}
