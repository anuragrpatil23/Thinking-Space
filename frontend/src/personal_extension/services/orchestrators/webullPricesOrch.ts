// Keeps every tracked company's prices.csv (pricesCsvBlock) current from
// Yahoo's public chart API, through main's guarded public fetch (desktop
// only). The first time, five years in one request; after that, only the days
// since the last row. Runs in the daily pass beside Value Line and the
// earnings calls (useValueLinePassBlock), or on "Check now". No timers.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { setPassItemBlock, type PassItemBlock, type PassItemStateBlock } from '@/services/lego_blocks/units/passQueueBlock'
import { fetchYahooDailyBarsBlock } from '../lego_blocks/integrations/yahooQuoteBlock'
import {
  marketDayBlock,
  mergePriceBarsBlock,
  priceDateRangeBlock,
  pricesCsvPathBlock,
  settledBarsBlock,
} from '../lego_blocks/units/pricesCsvBlock'

/** How far back the first fill goes. */
export const PRICE_HISTORY_YEARS = 5
/** A company checked this recently is left alone until the next pass. */
const RECHECK_MS = 12 * 60 * 60 * 1000
export const PRICES_PASS_STALE_MS = 24 * 60 * 60 * 1000
/** Between companies, so Yahoo sees a reader, not a crawler. */
const PACE_MS = 800

export type PricesOutcomeBlock = 'fetched' | 'no-new' | 'current' | 'not-covered' | 'error'

export interface PricesSyncResultBlock {
  ticker: string
  outcome: PricesOutcomeBlock
  /** "5 years", "3 new days" */
  detail?: string
  error?: string
}

export interface PricesPassBlock {
  at: string
  fetched: string[]
  failed: string[]
  error: string | null
  items?: PassItemBlock[]
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
  if (!headMissing && checkedAt && Date.now() - Date.parse(checkedAt) < RECHECK_MS) return { ticker, outcome: 'current' }
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

export function readLastPricesPassOrch(): PricesPassBlock | null {
  return getJsonStorageItem<PricesPassBlock | null>(STORAGE_KEYS.pricesPassLast, null)
}

export function pricesPassDueOrch(now = Date.now()): boolean {
  const last = readLastPricesPassOrch()
  return !last || now - Date.parse(last.at) > PRICES_PASS_STALE_MS
}

export interface PricesPassProgressBlock {
  done: number
  total: number
  fetched: number
  items: PassItemBlock[]
}
let progress: PricesPassProgressBlock | null = null
const listeners = new Set<() => void>()
function setProgressBlock(next: PricesPassProgressBlock | null): void {
  progress = next
  for (const listener of listeners) listener()
}

export function readPricesPassProgressOrch(): PricesPassProgressBlock | null {
  return progress
}

export function subscribePricesPassOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// What the daily pass covers (set by the F9 page), so "Check now" can run it on demand
let passTarget: { executionRoot: string; tickers: string[] } | null = null

export function setPricesPassTargetOrch(executionRoot: string, tickers: string[]): void {
  passTarget = { executionRoot, tickers }
}

export function checkPricesNowOrch(): Promise<PricesPassBlock> | null {
  return passTarget ? runPricesPassOrch(passTarget.executionRoot, passTarget.tickers) : null
}

let running: Promise<PricesPassBlock> | null = null

/** One pass over the tracked companies; a company that fails is tried once more at the end. */
export function runPricesPassOrch(executionRoot: string, tickers: string[]): Promise<PricesPassBlock> {
  if (running) return running
  running = (async () => {
    const pass: PricesPassBlock = { at: new Date().toISOString(), fetched: [], failed: [], error: null }
    const unique = [...new Set(tickers.map(t => t.toUpperCase()))]
    let items: PassItemBlock[] = unique.map(ticker => ({ ticker, state: 'waiting' as const }))
    let done = 0
    const mark = (ticker: string, state: PassItemStateBlock, detail?: string) => {
      items = setPassItemBlock(items, ticker, state, detail)
      setProgressBlock({ done, total: unique.length, fetched: pass.fetched.length, items })
    }
    const describe = (result: PricesSyncResultBlock, last: boolean) => {
      if (result.outcome === 'fetched') mark(result.ticker, 'fetched', result.detail)
      else if (result.outcome === 'no-new') mark(result.ticker, 'no-new')
      else if (result.outcome === 'current') mark(result.ticker, 'skipped')
      else if (result.outcome === 'not-covered') mark(result.ticker, 'not-covered', 'Yahoo has no prices for this symbol')
      else mark(result.ticker, last ? 'failed' : 'retrying', result.error)
    }
    const retry: string[] = []
    setProgressBlock({ done, total: unique.length, fetched: 0, items })
    for (const ticker of unique) {
      mark(ticker, 'working')
      const result = await syncPricesOrch(executionRoot, ticker)
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'error') retry.push(ticker)
      done += 1
      describe(result, false)
      if (result.outcome !== 'current') await new Promise(r => setTimeout(r, PACE_MS))
    }
    for (const ticker of retry) {
      mark(ticker, 'working')
      const result = await syncPricesOrch(executionRoot, ticker)
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'error') {
        pass.failed.push(ticker)
        pass.error = `${ticker}: ${result.error}`
      }
      describe(result, true)
    }
    pass.items = items
    setJsonStorageItem(STORAGE_KEYS.pricesPassLast, pass)
    return pass
  })().finally(() => {
    running = null
    setProgressBlock(null)
  })
  return running
}
