// Keeps a company's prices.csv (pricesCsvBlock) current from Yahoo's public
// chart API, through main's guarded public fetch (desktop only). The first
// time, five years in one request; after that, only the days since the last
// row. One company at a time: F9 sync (f9SyncOrch) decides when and for whom.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { fetchYahooDailyChartBlock, type YahooListingBlock } from '../lego_blocks/integrations/yahooQuoteBlock'
import {
  lastCloseBlock,
  marketDayBlock,
  mergePriceBarsBlock,
  priceDateRangeBlock,
  pricesCsvPathBlock,
  settledBarsBlock,
} from '../lego_blocks/units/pricesCsvBlock'
import { lastSettleBlock } from '../lego_blocks/units/f9SyncScheduleBlock'

/** How far back the first fill goes. */
export const PRICE_HISTORY_YEARS = 5

export type PricesOutcomeBlock = 'fetched' | 'no-new' | 'current' | 'not-covered' | 'error'

export interface PricesSyncResultBlock {
  ticker: string
  outcome: PricesOutcomeBlock
  /** "5 years", "3 new days" */
  detail?: string
  error?: string
  /** What kind of thing the symbol is, when Yahoo was asked */
  listing?: YahooListingBlock | null
}

export function pricesAvailableOrch(): boolean {
  return Boolean(window.electronAPI?.isElectron && window.electronAPI.fetchText)
}

function readChecksBlock(): Record<string, string> {
  return getJsonStorageItem<Record<string, string>>(STORAGE_KEYS.pricesChecks, {})
}

function writeCheckBlock(ticker: string): void {
  setJsonStorageItem(STORAGE_KEYS.pricesChecks, { ...readChecksBlock(), [ticker]: new Date().toISOString() })
}

function shiftDayBlock(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Bring one company's prices.csv up to date. */
export async function syncPricesOrch(executionRoot: string, rawTicker: string, opts: { needListing?: boolean } = {}): Promise<PricesSyncResultBlock> {
  const ticker = rawTicker.toUpperCase()
  if (!pricesAvailableOrch()) return { ticker, outcome: 'error', error: 'Prices are fetched from the desktop app only.' }
  const path = pricesCsvPathBlock(executionRoot, ticker)
  const fs = getVaultFS()
  const existing = await fs.read(path).catch(() => null)
  const range = priceDateRangeBlock(existing)
  const { today } = marketDayBlock()
  const historyStart = shiftDayBlock(today, -Math.round(PRICE_HISTORY_YEARS * 365.25))
  // The file starts later than five years back (the old 90-day backfill): fill the whole span once
  const headMissing = !range || range.first > shiftDayBlock(historyStart, 10)
  const checkedAt = readChecksBlock()[ticker]
  // Asked since the last trading day settled: there is no newer close to fetch
  const current = !headMissing && checkedAt && Date.parse(checkedAt) >= lastSettleBlock(new Date()).getTime()
  if (current && !opts.needListing) return { ticker, outcome: 'current' }
  const from = headMissing ? historyStart : shiftDayBlock(range!.last, -7)
  try {
    // Current, but its kind of listing is not known yet: one small ask for it
    const chart = await fetchYahooDailyChartBlock(ticker, current ? shiftDayBlock(today, -5) : from, today)
    if (current) return { ticker, outcome: 'current', listing: chart.listing }
    const bars = settledBarsBlock(chart.bars)
    const listing = chart.listing
    writeCheckBlock(ticker)
    if (bars.length === 0) return range ? { ticker, outcome: 'no-new', listing } : { ticker, outcome: 'not-covered', listing }
    const { csv, added } = mergePriceBarsBlock(existing, bars)
    if (added === 0) return { ticker, outcome: 'no-new', listing }
    await fs.write(path, csv)
    return { ticker, outcome: 'fetched', detail: headMissing ? `${PRICE_HISTORY_YEARS} years` : `${added} new ${added === 1 ? 'day' : 'days'}`, listing }
  } catch (err) {
    return { ticker, outcome: 'error', error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }
  }
}

export interface SyncedPriceBlock {
  price: number
  /** The trading day it belongs to */
  day: string
  /** A quote taken during the day (market/live.json), not a close */
  live: boolean
  /** When the quote was taken (ISO); null for a close */
  at: string | null
}

/**
 * Each company's latest price as F9 sync keeps it, without fetching: the last
 * close in its prices.csv (its own folder, or market/<TICKER>/), and a quote of
 * the day laid over it when one was taken after that close.
 */
export async function readSyncedPricesOrch(executionRoot: string, tickers: string[]): Promise<Map<string, SyncedPriceBlock>> {
  const root = executionRoot.replace(/\/+$/, '')
  const fs = getVaultFS()
  const read = (path: string) => fs.read(path).catch(() => null)
  let quotes: Record<string, { day?: string; price?: number; at?: string }> = {}
  try {
    quotes = (JSON.parse((await read(`${root}/market/live.json`)) ?? '{}') as { quotes?: typeof quotes }).quotes ?? {}
  } catch { /* no quotes taken */ }
  const out = new Map<string, SyncedPriceBlock>()
  await Promise.all([...new Set(tickers.map(t => t.toUpperCase()))].map(async (ticker) => {
    const close = lastCloseBlock(await read(pricesCsvPathBlock(root, ticker)) ?? await read(`${root}/market/${ticker}/prices.csv`))
    const quote = quotes[ticker]
    if (quote && typeof quote.price === 'number' && typeof quote.day === 'string' && (!close || quote.day > close.date)) {
      out.set(ticker, { price: quote.price, day: quote.day, live: true, at: quote.at ?? null })
    } else if (close) {
      out.set(ticker, { price: close.close, day: close.date, live: false, at: null })
    }
  }))
  return out
}
