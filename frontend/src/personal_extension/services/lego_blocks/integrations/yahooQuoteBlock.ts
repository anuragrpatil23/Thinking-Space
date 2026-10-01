// Yahoo Finance v8 chart endpoint — stock quotes without auth.
// Used for tickers we don't already have a Webull-side last_price for
// (i.e., not-held watchlist tickers). Routed through Electron's main-process
// fetcher to bypass CORS. On non-Electron surfaces, returns nulls gracefully.

import { isElectron } from '@/services/orchestrators/runtimeOrch'

export interface YahooStockQuoteBlock {
  symbol: string
  lastPrice: number | null
  previousClose: number | null
  currency: string | null
  exchangeName: string | null
  marketState: string | null
  fetchedAt: string
}

export interface YahooQuoteBatchResultBlock {
  ok: boolean
  quotes: Record<string, YahooStockQuoteBlock>
  errors: Record<string, string>
}

const YAHOO_CHART_BASE_BLOCK = 'https://query1.finance.yahoo.com/v8/finance/chart'
const YAHOO_FETCH_TIMEOUT_MS_BLOCK = 8_000

function raceTimeoutBlock<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(handle)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(handle)
        reject(err)
      },
    )
  })
}

async function fetchTextThroughElectronBlock(url: string): Promise<{ status: number; body: string }> {
  if (isElectron() && window.electronAPI?.fetchText) {
    return await raceTimeoutBlock(
      window.electronAPI.fetchText(url),
      YAHOO_FETCH_TIMEOUT_MS_BLOCK,
      `Yahoo fetch timed out after ${Math.round(YAHOO_FETCH_TIMEOUT_MS_BLOCK / 1000)}s`,
    )
  }
  throw new Error('Yahoo quote fetch requires Electron runtime (main-process HTTP).')
}

function asNumberOrNullBlock(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function asStringOrNullBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseChartResponseBlock(symbol: string, body: string): YahooStockQuoteBlock | null {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const chart = (data as { chart?: unknown }).chart
  if (!chart || typeof chart !== 'object') return null
  const result = (chart as { result?: unknown }).result
  if (!Array.isArray(result) || result.length === 0) return null
  const meta = (result[0] as { meta?: unknown }).meta
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  return {
    symbol,
    lastPrice: asNumberOrNullBlock(m.regularMarketPrice),
    previousClose: asNumberOrNullBlock(m.chartPreviousClose ?? m.previousClose),
    currency: asStringOrNullBlock(m.currency),
    exchangeName: asStringOrNullBlock(m.exchangeName ?? m.fullExchangeName),
    marketState: asStringOrNullBlock(m.marketState),
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchOneYahooStockQuoteBlock(symbol: string): Promise<YahooStockQuoteBlock | null> {
  const normalized = symbol.trim().toUpperCase()
  if (!normalized) return null
  const url = `${YAHOO_CHART_BASE_BLOCK}/${encodeURIComponent(normalized)}?interval=1d&range=1d`
  const response = await fetchTextThroughElectronBlock(url)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Yahoo chart HTTP ${response.status} for ${normalized}`)
  }
  return parseChartResponseBlock(normalized, response.body)
}

export async function fetchYahooStockQuotesBlock(symbols: string[]): Promise<YahooQuoteBatchResultBlock> {
  const normalized = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  )
  const quotes: Record<string, YahooStockQuoteBlock> = {}
  const errors: Record<string, string> = {}

  if (!isElectron() || !window.electronAPI?.fetchText) {
    for (const s of normalized) errors[s] = 'Electron runtime required for live quotes.'
    return { ok: false, quotes, errors }
  }

  // Yahoo v8 chart is per-symbol; run in parallel with a soft cap.
  const CONCURRENCY = 6
  let index = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(CONCURRENCY, normalized.length); w++) {
    workers.push((async () => {
      while (index < normalized.length) {
        const i = index++
        const sym = normalized[i]
        try {
          const quote = await fetchOneYahooStockQuoteBlock(sym)
          if (quote) {
            quotes[sym] = quote
          } else {
            errors[sym] = 'no chart data in response'
          }
        } catch (err) {
          errors[sym] = err instanceof Error ? err.message : String(err)
        }
      }
    })())
  }
  await Promise.all(workers)
  return { ok: Object.keys(errors).length === 0, quotes, errors }
}

export interface YahooDailyCloseBlock {
  /** YYYY-MM-DD (UTC day of the bar). */
  date: string
  close: number
}

export function parseYahooDailyClosesBlock(body: string): YahooDailyCloseBlock[] {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  const result = (data as { chart?: { result?: unknown } } | null)?.chart?.result
  if (!Array.isArray(result) || result.length === 0) return []
  const first = result[0] as { timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }
  const timestamps = Array.isArray(first.timestamp) ? first.timestamp : []
  const closes = first.indicators?.quote?.[0]?.close
  if (!Array.isArray(closes)) return []
  const out: YahooDailyCloseBlock[] = []
  timestamps.forEach((ts, i) => {
    const close = asNumberOrNullBlock(closes[i])
    if (typeof ts !== 'number' || close === null) return
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close })
  })
  return out
}

/** Daily closes for [fromDay, toDay] (YYYY-MM-DD). Electron-only, like the quote fetch. */
export async function fetchYahooDailyClosesBlock(
  symbol: string,
  fromDay: string,
  toDay: string,
): Promise<YahooDailyCloseBlock[]> {
  const normalized = symbol.trim().toUpperCase()
  if (!normalized) return []
  const period1 = Math.floor(Date.parse(`${fromDay}T00:00:00Z`) / 1000)
  const period2 = Math.floor(Date.parse(`${toDay}T23:59:59Z`) / 1000)
  const url = `${YAHOO_CHART_BASE_BLOCK}/${encodeURIComponent(normalized)}?interval=1d&period1=${period1}&period2=${period2}`
  const response = await fetchTextThroughElectronBlock(url)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Yahoo chart HTTP ${response.status} for ${normalized}`)
  }
  return parseYahooDailyClosesBlock(response.body)
}
