// A company's daily prices, kept by the app: <executionRoot>/<TICKER>/prices.csv,
// one row per trading day, in the columns the old backfill script wrote (so
// everything that reads the file keeps working):
//
//   date,midday_price,prev_open,prev_close,rsi_14,mfi_14,source
//
// midday_price is the day's close (as the old backfill rows were), prev_open
// and prev_close the trading day before's, rsi_14 Wilder's 14-day RSI over the
// closes. mfi_14 needs volume and high/low, which are not kept: left blank.
// Rows already in the file are never rewritten; new days are added around them.

export const PRICES_CSV_HEADER_BLOCK = 'date,midday_price,prev_open,prev_close,rsi_14,mfi_14,source'
export const PRICES_SOURCE_BLOCK = 'yahoo-daily'
const RSI_PERIOD = 14

export interface PriceBarBlock {
  /** YYYY-MM-DD */
  date: string
  open: number | null
  close: number
}

interface CsvRowBlock {
  date: string
  close: number | null
  line: string
}

function parseRowsBlock(csv: string): { header: string; rows: CsvRowBlock[] } {
  const lines = csv.split(/\r?\n/).filter(line => line.trim())
  if (lines.length === 0) return { header: PRICES_CSV_HEADER_BLOCK, rows: [] }
  const header = lines[0].trim()
  const cells = header.toLowerCase().split(',').map(c => c.trim())
  const dateAt = cells.indexOf('date')
  const priceAt = ['midday_price', 'close', 'price'].map(n => cells.indexOf(n)).find(i => i >= 0) ?? -1
  const rows = lines.slice(1).flatMap((line) => {
    const parts = line.split(',')
    const date = parts[dateAt]?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
    const close = Number(parts[priceAt])
    return [{ date, close: Number.isFinite(close) && close > 0 ? close : null, line }]
  })
  return { header, rows }
}

/** The first and last dates in the file, or null when it has no rows. */
export function priceDateRangeBlock(csv: string | null): { first: string; last: string } | null {
  if (!csv) return null
  const dates = parseRowsBlock(csv).rows.map(r => r.date).sort()
  return dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null
}

/** Wilder's RSI for each close (null until there are enough). */
export function rsiSeriesBlock(closes: number[], period = RSI_PERIOD): Array<number | null> {
  const out: Array<number | null> = closes.map(() => null)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) gain += change
    else loss -= change
  }
  gain /= period
  loss /= period
  const rsi = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  out[period] = rsi()
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(change, 0)) / period
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period
    out[i] = rsi()
  }
  return out
}

const price = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '' : n.toFixed(4))

/**
 * The file with every bar it does not have yet, before or after the rows it
 * has; the rows already there stay exactly as written. A new file gets the
 * header. `added` counts the new rows.
 */
export function mergePriceBarsBlock(existing: string | null, bars: PriceBarBlock[], source = PRICES_SOURCE_BLOCK): { csv: string; added: number } {
  const { header, rows } = parseRowsBlock(existing ?? '')
  const have = new Set(rows.map(r => r.date))
  // One series for prev_* and the RSI: the file's own closes where it has them
  const byDate = new Map<string, { close: number; open: number | null }>()
  for (const bar of bars) byDate.set(bar.date, { close: bar.close, open: bar.open })
  for (const row of rows) if (row.close !== null) byDate.set(row.date, { close: row.close, open: byDate.get(row.date)?.open ?? null })
  const series = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  const rsi = rsiSeriesBlock(series.map(([, v]) => v.close))
  const fresh: CsvRowBlock[] = []
  series.forEach(([date, value], i) => {
    if (have.has(date)) return
    const prev = i > 0 ? series[i - 1][1] : null
    const r = rsi[i]
    fresh.push({ date, close: value.close, line: [date, price(value.close), price(prev?.open), price(prev?.close), r === null ? '' : r.toFixed(2), '', source].join(',') })
  })
  if (fresh.length === 0 && existing !== null) return { csv: existing, added: 0 }
  const all = [...rows, ...fresh].sort((a, b) => a.date.localeCompare(b.date))
  return { csv: `${header}\n${all.map(r => r.line).join('\n')}\n`, added: fresh.length }
}

/** Today in New York, and whether the day's session is over (a bar for today is final only then). */
export function marketDayBlock(now = new Date()): { today: string; closed: boolean } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now).map(p => [p.type, p.value]))
  return { today: `${parts.year}-${parts.month}-${parts.day}`, closed: Number(parts.hour) >= 17 }
}

/** Bars without today's, while the session is still open (its close is not yet the close). */
export function settledBarsBlock(bars: PriceBarBlock[], now = new Date()): PriceBarBlock[] {
  const { today, closed } = marketDayBlock(now)
  return bars.filter(bar => bar.date < today || (bar.date === today && closed))
}

export function pricesCsvPathBlock(executionRoot: string, ticker: string): string {
  return `${executionRoot.replace(/\/+$/, '')}/${ticker.toUpperCase()}/prices.csv`
}
