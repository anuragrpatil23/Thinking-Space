// Study orchestrator — loads F9 study records from the vault, enriches them with
// live prices (held positions from existing Webull overall cache; not-held watchlist
// stocks from Yahoo v8 chart), categorizes by range/validity, and returns a typed
// snapshot for the Study tab UI.

import {
  scanWebullStudyVaultBlock,
  type WebullStudyLoadedRecordBlock,
} from '../lego_blocks/integrations/webullStudyVaultBlock'
import {
  fetchYahooStockQuotesBlock,
  type YahooStockQuoteBlock,
} from '../lego_blocks/integrations/yahooQuoteBlock'
import { loadWebullOverallCacheOrch } from './webullExecutionOrch'
import { readWebullExecutionSettingsOrch } from './webullExecutionSettingsOrch'
import type {
  WebullStudyRecordBlock,
  WebullStudyOptionBlock,
} from '../lego_blocks/units/webullStudyRecordBlock'

export type WebullStudyPriceSourceOrch =
  | 'webull-holding'
  | 'webull-option-leg'
  | 'yahoo-chart'
  | 'unavailable'

export interface WebullStudyLivePriceOrch {
  value: number | null
  source: WebullStudyPriceSourceOrch
  note: string | null
  fetchedAt: string | null
  currency: string | null
  marketState: string | null
}

export interface WebullStudyOptionRowOrch {
  spec: WebullStudyOptionBlock
  livePrice: WebullStudyLivePriceOrch
  matchedHolding: boolean
}

export type WebullStudyCategoryOrch =
  | 'no-range'
  | 'in-range'
  | 'approaching'
  | 'above-range'
  | 'below-range'
  | 'restudy-soon'
  | 'stale'
  | 'too-hard'
  | 'no-study'

export interface WebullStudyRowOrch {
  /** Stable key, always uppercased ticker. */
  ticker: string
  /** Underlying study record. Null for "held but no study" placeholders. */
  record: WebullStudyRecordBlock | null
  /** True if at least one current holding matches this ticker (stock or option). */
  held: boolean
  /** True if the underlying stock itself is currently held (not just options). */
  heldStock: boolean
  /** True if any option on this ticker is currently held. */
  heldOptions: boolean
  /** Live stock price (may be null if unavailable). */
  livePrice: WebullStudyLivePriceOrch
  /** Per-option rows with their own price + holding match. */
  options: WebullStudyOptionRowOrch[]
  /** Days until valid_through; negative means already past. Null when not set. */
  daysToValidThrough: number | null
  /** Computed bucket for grouping in the UI. */
  category: WebullStudyCategoryOrch
  /** % distance from last price to range; positive = above high, negative = below low, 0 = inside. */
  rangeDeltaPct: number | null
}

export interface WebullStudySnapshotOrch {
  executionRoot: string
  loadedAt: string
  overallFetchedAt: string | null
  rows: WebullStudyRowOrch[]
  warnings: string[]
  errors: string[]
}

const APPROACHING_WINDOW_PCT_ORCH = 10
const RESTUDY_SOON_DAYS_ORCH = 30

interface HoldingsIndexOrch {
  stockLastPriceByTicker: Map<string, number>
  optionLegPriceByKey: Map<string, number>
  optionLegSet: Set<string>
  heldStockTickers: Set<string>
  heldOptionTickers: Set<string>
  heldUnderlyingTickers: Set<string>
}

function asRecordOrch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumberOrNullOrch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asStringOrNullOrch(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asRecordArrayOrch(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
}

/** Build an option-leg matching key: TICKER|TYPE|STRIKE|EXPIRE. */
function optionLegKeyOrch(
  ticker: string,
  optionType: 'CALL' | 'PUT' | null,
  strike: number | null,
  expireDate: string | null,
): string | null {
  if (!ticker || !optionType || strike === null || !expireDate) return null
  return `${ticker.toUpperCase()}|${optionType}|${strike.toFixed(2)}|${expireDate}`
}

function indexHoldingsOrch(holdings: Array<Record<string, unknown>>): HoldingsIndexOrch {
  const stockLastPriceByTicker = new Map<string, number>()
  const optionLegPriceByKey = new Map<string, number>()
  const optionLegSet = new Set<string>()
  const heldStockTickers = new Set<string>()
  const heldOptionTickers = new Set<string>()
  const heldUnderlyingTickers = new Set<string>()

  for (const h of holdings) {
    const instrumentType = asStringOrNullOrch(h.instrument_type)
    const symbol = (asStringOrNullOrch(h.symbol) ?? asStringOrNullOrch(h.ticker) ?? '').toUpperCase()
    if (!symbol) continue

    if (instrumentType === 'EQUITY' || instrumentType === 'STOCK') {
      const last = asNumberOrNullOrch(h.last_price)
      if (last !== null) stockLastPriceByTicker.set(symbol, last)
      heldStockTickers.add(symbol)
      heldUnderlyingTickers.add(symbol)
      continue
    }

    if (instrumentType === 'OPTION') {
      heldUnderlyingTickers.add(symbol)
      heldOptionTickers.add(symbol)
      const legs = asRecordArrayOrch(h.legs)
      for (const leg of legs) {
        const legSymbol = (asStringOrNullOrch(leg.symbol) ?? symbol).toUpperCase()
        const rawType = asStringOrNullOrch(leg.option_type)?.toUpperCase() ?? null
        const optionType: 'CALL' | 'PUT' | null =
          rawType === 'CALL' || rawType === 'PUT' ? rawType : null
        const strike = asNumberOrNullOrch(leg.option_exercise_price)
        const expireDate = asStringOrNullOrch(leg.option_expire_date)
        const legPrice = asNumberOrNullOrch(leg.last_price)
        const key = optionLegKeyOrch(legSymbol, optionType, strike, expireDate)
        if (!key) continue
        optionLegSet.add(key)
        if (legPrice !== null) optionLegPriceByKey.set(key, legPrice)
      }
    }
  }

  return {
    stockLastPriceByTicker,
    optionLegPriceByKey,
    optionLegSet,
    heldStockTickers,
    heldOptionTickers,
    heldUnderlyingTickers,
  }
}

function extractHoldingsArrayOrch(assetsPositions: unknown): Array<Record<string, unknown>> {
  // overall.json structure (matches readWebullOverallCacheOrch payload):
  //   assetsPositions.holdings[]  OR  accounts[].assetsPositions.holdings[]
  // We accept both shapes.
  const direct = asRecordOrch(assetsPositions)
  if (direct && Array.isArray(direct.holdings)) {
    return asRecordArrayOrch(direct.holdings)
  }
  return []
}

function daysBetweenOrch(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / (1000 * 60 * 60 * 24))
}

function categorizeRowOrch(
  record: WebullStudyRecordBlock | null,
  livePrice: number | null,
  daysToValidThrough: number | null,
): { category: WebullStudyCategoryOrch; rangeDeltaPct: number | null } {
  if (!record) return { category: 'no-study', rangeDeltaPct: null }
  if (record.status === 'too-hard') return { category: 'too-hard', rangeDeltaPct: null }

  // Validity buckets take precedence for restudy/stale signaling, but only if
  // the user marked the record as something other than too-hard (handled above).
  if (daysToValidThrough !== null && daysToValidThrough < 0) {
    return { category: 'stale', rangeDeltaPct: null }
  }

  const range = record.currentRange
  if (!range) {
    if (daysToValidThrough !== null && daysToValidThrough <= RESTUDY_SOON_DAYS_ORCH) {
      return { category: 'restudy-soon', rangeDeltaPct: null }
    }
    return { category: 'no-range', rangeDeltaPct: null }
  }

  if (livePrice === null) {
    if (daysToValidThrough !== null && daysToValidThrough <= RESTUDY_SOON_DAYS_ORCH) {
      return { category: 'restudy-soon', rangeDeltaPct: null }
    }
    return { category: 'no-range', rangeDeltaPct: null }
  }

  const midpoint = (range.low + range.high) / 2
  // Displayed delta is always vs. the range midpoint so percentages are
  // comparable across in/below/above states. Classification still uses the
  // bound-relative percentage for the "approaching" threshold semantics.
  const rangeDeltaPct: number | null = midpoint > 0
    ? ((livePrice - midpoint) / midpoint) * 100
    : null
  let category: WebullStudyCategoryOrch
  if (livePrice >= range.low && livePrice <= range.high) {
    category = 'in-range'
  } else if (livePrice > range.high) {
    const aboveBoundPct = ((livePrice - range.high) / range.high) * 100
    category = aboveBoundPct <= APPROACHING_WINDOW_PCT_ORCH ? 'approaching' : 'above-range'
  } else {
    category = 'below-range'
  }

  // Restudy-soon overrides "approaching"/"above" if the date is more urgent.
  if (
    daysToValidThrough !== null &&
    daysToValidThrough <= RESTUDY_SOON_DAYS_ORCH &&
    category !== 'in-range'
  ) {
    category = 'restudy-soon'
  }

  return { category, rangeDeltaPct }
}

function buildRowOrch(
  ticker: string,
  loaded: WebullStudyLoadedRecordBlock | null,
  holdingsIndex: HoldingsIndexOrch,
  yahooQuotesByTicker: Map<string, YahooStockQuoteBlock>,
  nowIso: string,
): WebullStudyRowOrch {
  const record = loaded?.record ?? null
  const tickerUpper = ticker.toUpperCase()
  const heldStock = holdingsIndex.heldStockTickers.has(tickerUpper)
  const heldOptions = holdingsIndex.heldOptionTickers.has(tickerUpper)
  const heldUnderlying = holdingsIndex.heldUnderlyingTickers.has(tickerUpper)
  const held = heldUnderlying

  // Live stock price: prefer Webull holding, else Yahoo.
  let livePrice: WebullStudyLivePriceOrch
  const heldLast = holdingsIndex.stockLastPriceByTicker.get(tickerUpper)
  if (heldLast !== undefined) {
    livePrice = {
      value: heldLast,
      source: 'webull-holding',
      note: null,
      fetchedAt: null,
      currency: 'USD',
      marketState: null,
    }
  } else {
    const yahoo = yahooQuotesByTicker.get(tickerUpper)
    if (yahoo && yahoo.lastPrice !== null) {
      livePrice = {
        value: yahoo.lastPrice,
        source: 'yahoo-chart',
        note: null,
        fetchedAt: yahoo.fetchedAt,
        currency: yahoo.currency,
        marketState: yahoo.marketState,
      }
    } else {
      livePrice = {
        value: null,
        source: 'unavailable',
        note: yahoo ? 'Yahoo response had no chart data.' : null,
        fetchedAt: null,
        currency: null,
        marketState: null,
      }
    }
  }

  // Per-option rows.
  const optionRows: WebullStudyOptionRowOrch[] = (record?.options ?? []).map((spec) => {
    const key = optionLegKeyOrch(tickerUpper, spec.optionType, spec.exercisePrice, spec.expireDate)
    const matchedHolding = !!key && holdingsIndex.optionLegSet.has(key)
    const legPrice = key ? holdingsIndex.optionLegPriceByKey.get(key) : undefined
    if (legPrice !== undefined) {
      return {
        spec,
        matchedHolding,
        livePrice: {
          value: legPrice,
          source: 'webull-option-leg',
          note: null,
          fetchedAt: null,
          currency: 'USD',
          marketState: null,
        },
      }
    }
    return {
      spec,
      matchedHolding,
      livePrice: {
        value: null,
        source: 'unavailable',
        note: 'Not held; live option quotes not wired yet.',
        fetchedAt: null,
        currency: null,
        marketState: null,
      },
    }
  })

  const daysToValidThrough =
    record?.validThrough ? daysBetweenOrch(nowIso, record.validThrough) : null

  const { category, rangeDeltaPct } = categorizeRowOrch(record, livePrice.value, daysToValidThrough)

  // Override category: held but no study record.
  const finalCategory: WebullStudyCategoryOrch = !record ? 'no-study' : category

  return {
    ticker: tickerUpper,
    record,
    held,
    heldStock,
    heldOptions,
    livePrice,
    options: optionRows,
    daysToValidThrough,
    category: finalCategory,
    rangeDeltaPct,
  }
}

export async function loadWebullStudySnapshotOrch(): Promise<WebullStudySnapshotOrch> {
  const loadedAt = new Date().toISOString()
  const warnings: string[] = []
  const errors: string[] = []

  // Execution root from existing settings.
  const settings = await readWebullExecutionSettingsOrch()
  const executionRoot = settings.executionFolderPath.trim().replace(/\/+$/, '')
  if (!executionRoot) {
    return {
      executionRoot: '',
      loadedAt,
      overallFetchedAt: null,
      rows: [],
      warnings: ['Execution folder path is not configured (Settings > Webull).'],
      errors: [],
    }
  }

  // 1) Scan vault for study records.
  const scan = await scanWebullStudyVaultBlock(executionRoot)
  warnings.push(...scan.warnings)

  // 2) Read overall.json cache for held-position prices.
  let overallFetchedAt: string | null = null
  let holdingsRaw: Array<Record<string, unknown>> = []
  try {
    const cache = await loadWebullOverallCacheOrch()
    if (cache) {
      overallFetchedAt = cache.fetchedAt || null
      holdingsRaw = extractHoldingsArrayOrch(cache.assetsPositions)
      if (holdingsRaw.length === 0 && Array.isArray(cache.accounts)) {
        // Fallback: merge per-account assetsPositions if top-level was empty.
        for (const acct of cache.accounts) {
          const acctRec = asRecordOrch(acct)
          if (!acctRec) continue
          holdingsRaw.push(...extractHoldingsArrayOrch(acctRec.assetsPositions))
        }
      }
    } else {
      warnings.push('No Webull overall cache found; held-position prices will be empty.')
    }
  } catch (err) {
    errors.push(
      `Failed to read Webull overall cache: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const holdingsIndex = indexHoldingsOrch(holdingsRaw)

  // 3) Determine which tickers need Yahoo lookups (record exists, not held as stock).
  const recordedTickers = new Set(scan.records.map((r) => r.record.ticker.toUpperCase()))
  const yahooSymbols: string[] = []
  for (const ticker of recordedTickers) {
    if (!holdingsIndex.stockLastPriceByTicker.has(ticker)) {
      yahooSymbols.push(ticker)
    }
  }
  const yahooByTicker = new Map<string, YahooStockQuoteBlock>()
  if (yahooSymbols.length > 0) {
    try {
      const result = await fetchYahooStockQuotesBlock(yahooSymbols)
      for (const [k, v] of Object.entries(result.quotes)) yahooByTicker.set(k, v)
      for (const [sym, msg] of Object.entries(result.errors)) {
        warnings.push(`Yahoo quote for ${sym}: ${msg}`)
      }
    } catch (err) {
      errors.push(
        `Yahoo quote batch failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // 4) Build rows: one per recorded ticker, plus held-without-record placeholders.
  const recordsByTicker = new Map<string, WebullStudyLoadedRecordBlock>()
  for (const loaded of scan.records) {
    recordsByTicker.set(loaded.record.ticker.toUpperCase(), loaded)
  }

  const allTickers = new Set<string>([
    ...recordsByTicker.keys(),
    ...holdingsIndex.heldUnderlyingTickers,
  ])

  const rows: WebullStudyRowOrch[] = []
  for (const ticker of allTickers) {
    const loaded = recordsByTicker.get(ticker) ?? null
    rows.push(buildRowOrch(ticker, loaded, holdingsIndex, yahooByTicker, loadedAt))
  }

  // Stable sort: by category bucket priority, then ticker ascending.
  const categoryOrder: Record<WebullStudyCategoryOrch, number> = {
    'in-range': 0,
    'approaching': 1,
    'restudy-soon': 2,
    'stale': 3,
    'below-range': 4,
    'above-range': 5,
    'no-range': 6,
    'no-study': 7,
    'too-hard': 8,
  }
  rows.sort((a, b) => {
    const c = categoryOrder[a.category] - categoryOrder[b.category]
    if (c !== 0) return c
    return a.ticker.localeCompare(b.ticker)
  })

  return {
    executionRoot,
    loadedAt,
    overallFetchedAt,
    rows,
    warnings,
    errors,
  }
}
