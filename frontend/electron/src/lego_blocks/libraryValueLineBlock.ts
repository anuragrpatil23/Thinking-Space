// Value Line company reports, through the library session
// (librarySessionBlock.ts): Value Line's Research Center
// (research.valueline.com), where the library's subscription lives since
// Value Line retired the old Investment Survey pages in October 2026 (their
// front page now loops through the proxy).
//
// A company's PDF reports module (app com_13_4) answers JSON wrapping an HTML
// table: one row per issue, a link to /secure/api/report?documentID=…&
// format=PDF&symbol=… dated "Sep 18, 2026". About the last 18 months are
// listed (MU: 7 issues). A ticker it does not cover lists none. Checked
// 2026-10-23 in the browser.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer names a ticker,
// and for a report an issue date from that ticker's list. The document ids
// stay in main; every URL is built here, on the proxied Research Center only.

import { decodeEntitiesBlock, libraryRequestBlock } from './librarySessionBlock';

const VALUE_LINE = 'https://research-valueline-com.atxlibrary.idm.oclc.org';
/** Where the library signs in to the Research Center (its own link's target). */
const VALUE_LINE_FRONT = 'https://research.valueline.com/secure/research';
const AJAX_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' };

export interface LibraryValueLineIssue {
  /** YYYY-MM-DD */
  issueDate: string
  key: string
}

export interface LibraryValueLineIssues {
  covered: boolean
  /** Newest first, without the keys. */
  issues: Array<{ issueDate: string }>
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoFromIssueLabelBlock(label: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(label.trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!m || !month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * The issues listed for a ticker, newest first; null when the answer is not
 * the reports module at all (a login page, an error page).
 */
export function parseValueLineIssuesBlock(body: string, ticker: string): LibraryValueLineIssue[] | null {
  let html: unknown;
  try {
    html = (JSON.parse(body) as { apps?: Array<{ html?: unknown }> })?.apps?.[0]?.html;
  } catch {
    return null;
  }
  if (typeof html !== 'string') return null;
  const byDate = new Map<string, string>();
  const link = /<a\b[^>]*\bhref=["']\/secure\/api\/report\?([^"']+)["'][^>]*>\s*([^<]+?)\s*<\/a>/gi;
  for (let m = link.exec(html); m; m = link.exec(html)) {
    const params = new URLSearchParams(decodeEntitiesBlock(m[1]));
    const key = params.get('documentID');
    const symbol = (params.get('symbol') ?? '').toUpperCase();
    const issueDate = isoFromIssueLabelBlock(decodeEntitiesBlock(m[2]));
    if (!key || !issueDate || (params.get('format') ?? 'PDF').toUpperCase() !== 'PDF') continue;
    if (symbol && symbol !== ticker) continue;
    if (!byDate.has(issueDate)) byDate.set(issueDate, key);
  }
  return [...byDate.entries()].map(([issueDate, key]) => ({ issueDate, key })).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

function validTickerBlock(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error('value line: bad ticker');
  return ticker;
}

// The keys from each ticker's latest listing, so a report request names only a date
const keysByTicker = new Map<string, Map<string, string>>();

async function listIssuesBlock(ticker: string, urgent = false): Promise<LibraryValueLineIssue[]> {
  const params = JSON.stringify([{
    appId: 'com_13_4',
    context: { Symbol: ticker, ListId: 'recent', ReportType: 'Company', StartMonth: '1', EndMonth: '12', SelectedYear: '' },
  }]);
  const issues = await libraryRequestBlock({
    url: `${VALUE_LINE}/secure/f2/apps/json?params=${encodeURIComponent(params)}`,
    headers: AJAX_HEADERS,
    loginUrl: VALUE_LINE_FRONT,
    urgent,
    read: async (r) => parseValueLineIssuesBlock(await r.text(), ticker),
    expect: (parsed) => parsed !== null,
  });
  const list = issues ?? [];
  keysByTicker.set(ticker, new Map(list.map((i) => [i.issueDate, i.key])));
  return list;
}

/** Every issue of a ticker's report; `covered: false` when Value Line has none. */
export async function libraryValueLineIssuesBlock(p: { ticker: string; interactive?: boolean }): Promise<LibraryValueLineIssues> {
  const ticker = validTickerBlock(p?.ticker);
  const issues = await listIssuesBlock(ticker, p?.interactive === true);
  return { covered: issues.length > 0, issues: issues.map(({ issueDate }) => ({ issueDate })) };
}

/** One issue's report PDF, base64. */
export async function libraryValueLineReportBlock(p: { ticker: string; issueDate: string; interactive?: boolean }): Promise<{ pdfBase64: string }> {
  const urgent = p?.interactive === true;
  const ticker = validTickerBlock(p?.ticker);
  if (typeof p.issueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate)) throw new Error('value line: issueDate must be YYYY-MM-DD');
  if (!keysByTicker.get(ticker)?.has(p.issueDate)) await listIssuesBlock(ticker, urgent);
  const key = keysByTicker.get(ticker)?.get(p.issueDate);
  if (!key) throw new Error(`value line: no ${ticker} issue on ${p.issueDate}`);
  const bytes = await libraryRequestBlock({
    url: `${VALUE_LINE}/secure/api/report?${new URLSearchParams({ documentID: key, format: 'PDF', symbol: ticker }).toString()}`,
    loginUrl: VALUE_LINE_FRONT,
    urgent,
    read: async (r) => Buffer.from(await r.arrayBuffer()),
    expect: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  });
  return { pdfBase64: bytes.toString('base64') };
}
