// Value Line company reports, through the library session
// (librarySessionBlock.ts): the library's Investment Survey Plus edition.
//
// Its Historical Reports page answers a ticker with every issue of that
// company's report (quarterly, back to the 1990s), each a PDF behind an
// encrypted File/Handler key; a ticker Value Line doesn't cover answers
// "Report not found". Checked 2026-10-23.
//
// Trust boundary (docs/contracts/SECURITY.md): the renderer names a ticker,
// and for a report an issue date from that ticker's list. The keys stay in
// main; every URL is built here, on the proxied Value Line host only.

import { decodeEntitiesBlock, libraryRequestBlock } from './librarySessionBlock';

const VALUE_LINE = 'https://www3-valueline-com.atxlibrary.idm.oclc.org';
/** The edition's front page: signing in lands here, which also opens Value Line's own session. */
const VALUE_LINE_FRONT = 'http://www3.valueline.com/secure/vlispdf/stk5000/index.aspx';
const AJAX_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/html; charset=utf-8' };

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

/** The issues listed for a ticker, newest first; null when the answer is not a listing at all. */
export function parseValueLineIssuesBlock(body: string, ticker: string): LibraryValueLineIssue[] | null {
  if (/Report not found for the ticker/i.test(body)) return [];
  const table = body.indexOf('tableSearchedByTicker');
  if (table === -1) return null;
  const issues: LibraryValueLineIssue[] = [];
  for (const row of body.slice(table).split(/<tr[\s>]/).slice(1)) {
    const title = /title=['"]Report of ([^'"]+?) for ([^'"]+)['"]/.exec(row);
    const href = /href=['"](\/File\/Handler\?productCode=investment-survey&(?:amp;)?key=reports[^'"]+)['"]/.exec(row);
    if (!title || !href || title[1].toUpperCase() !== ticker) continue;
    const issueDate = isoFromIssueLabelBlock(decodeEntitiesBlock(title[2]));
    const key = /key=(reports[^&'"]+)/.exec(decodeEntitiesBlock(href[1]))?.[1];
    if (issueDate && key) issues.push({ issueDate, key });
  }
  return issues.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

function validTickerBlock(ticker: unknown): string {
  if (typeof ticker !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error('value line: bad ticker');
  return ticker;
}

// The keys from each ticker's latest listing, so a report request names only a date
const keysByTicker = new Map<string, Map<string, string>>();

async function listIssuesBlock(ticker: string): Promise<LibraryValueLineIssue[]> {
  const params = new URLSearchParams({ ticker, companyName: '', issueDate: '', exactMatch: 'true' });
  const issues = await libraryRequestBlock({
    url: `${VALUE_LINE}/stk5000/HistoricalReportsData?${params.toString()}`,
    method: 'POST',
    headers: AJAX_HEADERS,
    loginUrl: VALUE_LINE_FRONT,
    read: async (r) => parseValueLineIssuesBlock(await r.text(), ticker),
    expect: (parsed) => parsed !== null,
  });
  const list = issues ?? [];
  keysByTicker.set(ticker, new Map(list.map((i) => [i.issueDate, i.key])));
  return list;
}

/** Every issue of a ticker's report; `covered: false` when Value Line has none. */
export async function libraryValueLineIssuesBlock(p: { ticker: string }): Promise<LibraryValueLineIssues> {
  const ticker = validTickerBlock(p?.ticker);
  const issues = await listIssuesBlock(ticker);
  return { covered: issues.length > 0, issues: issues.map(({ issueDate }) => ({ issueDate })) };
}

/** One issue's report PDF, base64. */
export async function libraryValueLineReportBlock(p: { ticker: string; issueDate: string }): Promise<{ pdfBase64: string }> {
  const ticker = validTickerBlock(p?.ticker);
  if (typeof p.issueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate)) throw new Error('value line: issueDate must be YYYY-MM-DD');
  if (!keysByTicker.get(ticker)?.has(p.issueDate)) await listIssuesBlock(ticker);
  const key = keysByTicker.get(ticker)?.get(p.issueDate);
  if (!key) throw new Error(`value line: no ${ticker} issue on ${p.issueDate}`);
  const bytes = await libraryRequestBlock({
    url: `${VALUE_LINE}/File/Handler?productCode=investment-survey&key=${key}`,
    loginUrl: VALUE_LINE_FRONT,
    read: async (r) => Buffer.from(await r.arrayBuffer()),
    expect: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  });
  return { pdfBase64: bytes.toString('base64') };
}
