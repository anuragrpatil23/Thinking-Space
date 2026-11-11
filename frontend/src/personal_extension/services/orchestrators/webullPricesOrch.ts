// Keeps a company's prices.csv (pricesCsvBlock) current from Yahoo's public
// chart API, through main's guarded public fetch (desktop only). The first
// time, five years in one request; after that, only the days since the last
// row. One company at a time: F9 sync (f9SyncOrch) decides when and for whom.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { fetchYahooDailyBarsBlock } from '../lego_blocks/integrations/yahooQuoteBlock'
import {
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
export async function syncPricesOrch(executionRoot: string, rawTicker: string): Promise<PricesSyncResultBlock> {
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
  if (!headMissing && checkedAt && Date.parse(checkedAt) >= lastSettleBlock(new Date()).getTime()) return { ticker, outcome: 'current' }
  const from = headMissing ? historyStart : shiftDayBlock(range!.last, -7)
  try {
    const bars = settledBarsBlock(await fetchYahooDailyBarsBlock(ticker, from, today))
    writeCheckBlock(ticker)
    if (bars.length === 0) return range ? { ticker, outcome: 'no-new' } : { ticker, outcome: 'not-covered' }
    const { csv, added } = mergePriceBarsBlock(existing, bars)
    if (added === 0) return { ticker, outcome: 'no-new' }
    await fs.write(path, csv)
    return { ticker, outcome: 'fetched', detail: headMissing ? `${PRICE_HISTORY_YEARS} years` : `${added} new ${added === 1 ? 'day' : 'days'}` }
  } catch (err) {
    return { ticker, outcome: 'error', error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }
  }
}
