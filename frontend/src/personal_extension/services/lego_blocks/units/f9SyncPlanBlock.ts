// F9 sync, the part that only thinks: what one piece of work is, what the
// ledger remembers of it, when it is due, and which pieces a request asks for.
//
// The unit of work is one dataset for one company ("NVDA's prices"). The ledger
// keeps, per dataset, one entry per company: when it last synced and what came
// of it, or when it last failed and why. Everything the engine does and
// everything the panel shows is read off those entries; no pass keeps a record
// of its own.

import { cadenceDueBlock, lastSettleBlock, F9_SYNC_DAY_MS_BLOCK, type F9SyncCadenceBlock } from './f9SyncScheduleBlock'

/** What a sync of one item came to. A failure is thrown, not returned. */
export type F9SyncOutcomeBlock =
  /** Something new was saved */
  | 'fetched'
  /** Asked; nothing newer than what is saved */
  | 'no-new'
  /** Not asked: what is saved is already current */
  | 'current'
  /** The source has nothing for this company */
  | 'not-covered'

export interface F9SyncResultBlock {
  outcome: F9SyncOutcomeBlock
  /** "3 new days", "Sep 2026 report" */
  detail?: string
  /** What the sync learned about the company (its kind of listing), kept for every dataset to see */
  facts?: F9SyncFactsBlock
}

/**
 * What kind of thing a company is, learned once (from its price chart) and kept in
 * sync/companies.json. Datasets say what they cover in these terms, so a fund is
 * never asked for analyst estimates and a foreign listing never for SEC filings.
 */
export interface F9SyncFactsBlock {
  type?: 'stock' | 'fund' | 'index' | 'other'
  /** The currency it trades in: USD for a US listing */
  currency?: string
  exchange?: string
}

export interface F9SyncEntryBlock {
  /** The last sync that did not fail */
  okAt?: string
  outcome?: F9SyncOutcomeBlock
  detail?: string
  /** The last failure; cleared by the next sync that works */
  failedAt?: string
  error?: string
  /** Failures in a row */
  fails?: number
  /** The failure needs you (a sign-in): not tried again on its own, only when you ask */
  waitsForYou?: boolean
}

/** One dataset's ledger: ticker -> entry. A job (no company) is filed under ''. */
export type F9SyncLedgerBlock = Record<string, F9SyncEntryBlock>

export interface F9SyncCompanyBlock {
  ticker: string
  /** In your lists (held, watchlist, to research), not only watched */
  yours: boolean
  /** The folder that holds its files */
  folder: string
  /** The root its prices.csv is filed under (`<pricesRoot>/<TICKER>/prices.csv`) */
  pricesRoot: string
  /** A market line (SPY), not a company: prices and quotes only */
  index?: boolean
  /** Anything else a dataset's own code needs (the private folder's universe row) */
  extra?: unknown
  facts?: F9SyncFactsBlock
}

/** What the planner needs to know of a dataset. */
export interface F9SyncDatasetPlanBlock {
  id: string
  cadence: F9SyncCadenceBlock
  /** Lower goes first */
  order: number
  /** One piece of work with no company (the back-issue allowance) */
  job?: boolean
  covers(company: F9SyncCompanyBlock): boolean
}

export interface F9SyncItemBlock {
  key: string
  dataset: string
  /** '' for a job */
  ticker: string
  yours: boolean
}

export type F9SyncScopeBlock = 'yours' | 'everyone'

export interface F9SyncAskBlock {
  scope: F9SyncScopeBlock
  /**
   * due: only what is due (the automatic check).
   * now: what is due, what failed, and everything that is on demand (Sync now).
   * force: everything, due or not (a dataset's own Run).
   */
  mode: 'due' | 'now' | 'force'
  /** Only these datasets */
  datasets?: string[]
  /** Only these companies */
  tickers?: string[]
}

export const f9SyncKeyBlock = (dataset: string, ticker: string) => `${dataset}|${ticker}`

const RETRY_AFTER_MS = 30 * 60 * 1000
const QUICK_RETRIES = 3
const NOT_COVERED_RECHECK_MS = 30 * F9_SYNC_DAY_MS_BLOCK

/** Whether the entry's last attempt failed (and nothing has worked since). */
export function entryFailingBlock(entry: F9SyncEntryBlock | undefined): boolean {
  return Boolean(entry?.failedAt && (!entry.okAt || entry.failedAt > entry.okAt))
}

/**
 * Whether an item should run on its own now.
 * A failure is tried again after half an hour, three times; after that once per
 * trading day, so a source that is down is not asked all day. A company the
 * source does not cover is asked again after a month.
 */
export function entryDueBlock(entry: F9SyncEntryBlock | undefined, cadence: F9SyncCadenceBlock, now: Date): boolean {
  if (cadence === 'on-demand') return false
  if (!entry) return true
  if (entryFailingBlock(entry)) {
    if (entry.waitsForYou) return false
    const failedAt = Date.parse(entry.failedAt!)
    if ((entry.fails ?? 1) < QUICK_RETRIES) return now.getTime() - failedAt >= RETRY_AFTER_MS
    return failedAt < lastSettleBlock(now).getTime()
  }
  const okAt = entry.okAt ? Date.parse(entry.okAt) : NaN
  if (!Number.isFinite(okAt)) return true
  if (entry.outcome === 'not-covered') return now.getTime() - okAt > NOT_COVERED_RECHECK_MS
  return cadenceDueBlock(cadence, okAt, now)
}

export function recordResultBlock(result: F9SyncResultBlock, at: string): F9SyncEntryBlock {
  return { okAt: at, outcome: result.outcome, ...(result.detail ? { detail: result.detail } : {}) }
}

/** A failure keeps what last worked: the panel still says when the data is from. */
export function recordFailureBlock(entry: F9SyncEntryBlock | undefined, error: string, at: string, waitsForYou = false): F9SyncEntryBlock {
  const { waitsForYou: _was, ...rest } = entry ?? {}
  return { ...rest, failedAt: at, error, fails: (entryFailingBlock(entry) ? entry?.fails ?? 1 : 0) + 1, ...(waitsForYou ? { waitsForYou } : {}) }
}

/** The general kinds datasets cover, from what is known of a company (unknown counts as covered). */
export const isFundBlock = (c: F9SyncCompanyBlock) => c.facts?.type === 'fund'
/** A company, not a fund or an index: what has estimates, calls, reports */
export const isOperatingCompanyBlock = (c: F9SyncCompanyBlock) => !c.index && c.facts?.type !== 'fund' && c.facts?.type !== 'index'
/** Listed in the US (trades in dollars): what the SEC has filings for */
export const isUsListingBlock = (c: F9SyncCompanyBlock) => !c.facts?.currency || c.facts.currency === 'USD'

/** The items a request asks for: yours first, then by dataset order, then A to Z. */
export function planBlock(
  datasets: F9SyncDatasetPlanBlock[],
  companies: F9SyncCompanyBlock[],
  ledgers: Record<string, F9SyncLedgerBlock | undefined>,
  ask: F9SyncAskBlock,
  now: Date,
): F9SyncItemBlock[] {
  const only = ask.tickers ? new Set(ask.tickers.map(t => t.toUpperCase())) : null
  const wanted = (entry: F9SyncEntryBlock | undefined, cadence: F9SyncCadenceBlock) =>
    ask.mode === 'force'
    || entryDueBlock(entry, cadence, now)
    || (ask.mode === 'now' && (cadence === 'on-demand' || entryFailingBlock(entry)))
  const items: Array<F9SyncItemBlock & { order: number }> = []
  for (const d of datasets) {
    if (ask.datasets && !ask.datasets.includes(d.id)) continue
    const ledger = ledgers[d.id] ?? {}
    if (d.job) {
      // A job belongs to no company: it comes with everyone, or when named
      if ((ask.scope === 'everyone' || ask.datasets) && !only && wanted(ledger[''], d.cadence)) {
        items.push({ key: f9SyncKeyBlock(d.id, ''), dataset: d.id, ticker: '', yours: false, order: d.order })
      }
      continue
    }
    for (const c of companies) {
      if (ask.scope === 'yours' && !c.yours) continue
      if (only && !only.has(c.ticker)) continue
      if (!d.covers(c) || !wanted(ledger[c.ticker], d.cadence)) continue
      items.push({ key: f9SyncKeyBlock(d.id, c.ticker), dataset: d.id, ticker: c.ticker, yours: c.yours, order: d.order })
    }
  }
  return items
    .sort((a, b) => Number(b.yours) - Number(a.yours) || a.order - b.order || a.ticker.localeCompare(b.ticker))
    .map(({ order: _order, ...item }) => item)
}

export interface F9SyncTallyBlock {
  /** Companies the dataset covers */
  total: number
  /** Synced and not due */
  fresh: number
  due: number
  /** Last attempt failed */
  failed: number
  /** The newest sync that worked */
  lastAt: string | null
}

/** Where a dataset stands across a set of companies. */
export function tallyBlock(dataset: F9SyncDatasetPlanBlock, companies: F9SyncCompanyBlock[], ledger: F9SyncLedgerBlock | undefined, now: Date): F9SyncTallyBlock {
  const tally: F9SyncTallyBlock = { total: 0, fresh: 0, due: 0, failed: 0, lastAt: null }
  const count = (entry: F9SyncEntryBlock | undefined) => {
    tally.total += 1
    if (entry?.okAt && (!tally.lastAt || entry.okAt > tally.lastAt)) tally.lastAt = entry.okAt
    if (entryFailingBlock(entry)) tally.failed += 1
    else if (entryDueBlock(entry, dataset.cadence, now)) tally.due += 1
    else if (entry) tally.fresh += 1
  }
  if (dataset.job) count(ledger?.[''])
  else for (const c of companies) if (dataset.covers(c)) count(ledger?.[c.ticker])
  return tally
}
