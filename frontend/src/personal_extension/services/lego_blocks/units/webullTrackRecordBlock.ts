// A company's track record from the Webull statement CSVs: how its option
// purchases (short- and longer-dated) and its shares have actually turned out.
// Ported from kai-workspace/F9/tools/short_term_options_page.py so the numbers
// match that page exactly:
// - every option buy is one purchase; sells and expirations of the same
//   contract in the same account are matched to buys first in, first out;
// - NVDA split 10 for 1 in June 2024: contracts bought before the split and
//   closed after it go on the after-split strike and quantity;
// - purchases still open at the last month end are valued at that statement;
// - short-dated means bought with SHORT_DAYS days or fewer to expiry;
// - shares are counted per company as dollars: sold + still held − bought.

export const WEBULL_SHORT_DATED_DAYS_BLOCK = 120

export type CsvRowBlock = Record<string, string>

export interface WebullOptionLotBlock {
  ticker: string
  /** Trade date, YYYY-MM-DD */
  boughtOn: string
  daysToExpiry: number
  cost: number
  cameBack: number
  stillOpenValue: number
  net: number
  expiredAtZero: boolean
}

export interface WebullTrackSummaryBlock {
  purchases: number
  paid: number
  cameBack: number
  net: number
  /** Share of purchases that made money, 0–1. */
  madeMoney: number
  /** Share of purchases that expired worthless, 0–1. */
  expiredAtZero: number
  /** Net added up month by month in the order bought, for a sparkline. */
  running: Array<{ month: string; total: number }>
}

export interface WebullCompanyTrackRecordBlock {
  ticker: string
  shortDated: WebullTrackSummaryBlock | null
  longerDated: WebullTrackSummaryBlock | null
  stock: { bought: number; sold: number; held: number; net: number } | null
  /** The statement the open values come from, YYYY-MM-DD. */
  throughStatement: string
}

/** RFC 4180-ish CSV: quoted fields may hold commas and doubled quotes. */
export function parseCsvBlock(text: string): CsvRowBlock[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1 } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some(cell => cell !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(cell => cell !== '')) rows.push(row)
  const [header, ...body] = rows
  if (!header) return []
  return body.map(cells => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
}

const OPTION_PATTERN_BLOCK = /^(\S+) ([\d.]+) (call|put) (\d{4}-\d{2}-\d{2})$/

function daysBetweenBlock(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function contractKeyBlock(account: string, ticker: string, strike: number, kind: string, expiry: string): string {
  return [account, ticker, strike.toFixed(4), kind, expiry].join('|')
}

export function buildOptionLotsBlock(trades: CsvRowBlock[], monthEnds: CsvRowBlock[]): { lots: WebullOptionLotBlock[]; lastStatement: string } {
  const lastStatement = monthEnds.reduce((latest, row) => (row.period_end > latest ? row.period_end : latest), '')

  const held = new Map<string, { qty: number; amount: number }>()
  for (const row of monthEnds) {
    const match = row.instrument.match(OPTION_PATTERN_BLOCK)
    if (!match || row.period_end !== lastStatement) continue
    held.set(contractKeyBlock(row.account, match[1], Number(match[2]), match[3], match[4]), { qty: Number(row.qty), amount: Number(row.amount) })
  }

  type TradeBlock = { key: string; ticker: string; expiry: string; date: string; side: string; qty: number; net: number; expired: boolean }
  const byContract = new Map<string, TradeBlock[]>()
  for (const row of trades) {
    const match = row.instrument.match(OPTION_PATTERN_BLOCK)
    if (!match) continue
    const [, ticker, strikeText, kind, expiry] = match
    let strike = Number(strikeText)
    let qty = Number(row.qty)
    if (ticker === 'NVDA' && row.trade_date < '2024-06-10' && expiry > '2024-06-07') {
      strike /= 10
      qty *= 10
    }
    const key = contractKeyBlock(row.account, ticker, strike, kind, expiry)
    const list = byContract.get(key) ?? []
    list.push({ key, ticker, expiry, date: row.trade_date, side: row.side, qty, net: Number(row.net), expired: row.note === 'expired' })
    byContract.set(key, list)
  }

  type LotBlock = WebullOptionLotBlock & { qty: number; remaining: number; zeroQty: number }
  const lots: LotBlock[] = []
  for (const [key, list] of byContract) {
    list.sort((a, b) => a.date.localeCompare(b.date) || Number(a.side !== 'buy') - Number(b.side !== 'buy'))
    const queue: LotBlock[] = []
    for (const trade of list) {
      if (trade.side === 'buy') {
        const lot: LotBlock = {
          ticker: trade.ticker, boughtOn: trade.date, daysToExpiry: daysBetweenBlock(trade.date, trade.expiry),
          cost: -trade.net, cameBack: 0, stillOpenValue: 0, net: 0, expiredAtZero: false,
          qty: trade.qty, remaining: trade.qty, zeroQty: 0,
        }
        queue.push(lot)
        lots.push(lot)
        continue
      }
      let need = trade.qty
      while (need > 1e-9 && queue.length > 0) {
        const lot = queue[0]
        const take = Math.min(need, lot.remaining)
        lot.cameBack += (trade.net * take) / trade.qty
        lot.remaining -= take
        need -= take
        if (trade.expired) lot.zeroQty += take
        if (lot.remaining < 1e-9) queue.shift()
      }
    }
    const left = queue.reduce((sum, lot) => sum + lot.remaining, 0)
    const position = held.get(key)
    if (left > 1e-9 && position && Math.abs(position.qty - left) < 1e-6) {
      for (const lot of queue) lot.stillOpenValue = (position.amount * lot.remaining) / left
    }
  }

  return {
    lastStatement,
    lots: lots.map(({ qty, remaining: _remaining, zeroQty, ...lot }) => ({
      ...lot,
      net: lot.cameBack + lot.stillOpenValue - lot.cost,
      expiredAtZero: zeroQty >= qty - 1e-9,
    })),
  }
}

export function summarizeLotsBlock(lots: WebullOptionLotBlock[]): WebullTrackSummaryBlock | null {
  if (lots.length === 0) return null
  const paid = lots.reduce((sum, lot) => sum + lot.cost, 0)
  const cameBack = lots.reduce((sum, lot) => sum + lot.cameBack + lot.stillOpenValue, 0)
  const byMonth = new Map<string, number>()
  for (const lot of lots) byMonth.set(lot.boughtOn.slice(0, 7), (byMonth.get(lot.boughtOn.slice(0, 7)) ?? 0) + lot.net)
  let total = 0
  const running = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, net]) => {
    total += net
    return { month, total }
  })
  return {
    purchases: lots.length,
    paid,
    cameBack,
    net: cameBack - paid,
    madeMoney: lots.filter(lot => lot.net > 0).length / lots.length,
    expiredAtZero: lots.filter(lot => lot.expiredAtZero).length / lots.length,
    running,
  }
}

export function stockByCompanyBlock(trades: CsvRowBlock[], monthEnds: CsvRowBlock[], lastStatement: string): Map<string, { bought: number; sold: number; held: number; net: number }> {
  const out = new Map<string, { bought: number; sold: number; held: number; net: number }>()
  const entry = (ticker: string) => {
    let value = out.get(ticker)
    if (!value) { value = { bought: 0, sold: 0, held: 0, net: 0 }; out.set(ticker, value) }
    return value
  }
  for (const row of trades) {
    if (!row.instrument.endsWith(' stock')) continue
    const value = entry(row.instrument.slice(0, -6))
    if (row.side === 'buy') value.bought += Math.abs(Number(row.net))
    else value.sold += Math.abs(Number(row.net))
  }
  for (const row of monthEnds) {
    if (row.period_end === lastStatement && row.instrument.endsWith(' stock')) entry(row.instrument.slice(0, -6)).held += Number(row.amount)
  }
  for (const value of out.values()) value.net = value.sold + value.held - value.bought
  return out
}

export function companyTrackRecordBlock(params: {
  ticker: string
  lots: WebullOptionLotBlock[]
  stock: Map<string, { bought: number; sold: number; held: number; net: number }>
  lastStatement: string
}): WebullCompanyTrackRecordBlock | null {
  const ticker = params.ticker.toUpperCase()
  const mine = params.lots.filter(lot => lot.ticker.toUpperCase() === ticker)
  const shortDated = summarizeLotsBlock(mine.filter(lot => lot.daysToExpiry <= WEBULL_SHORT_DATED_DAYS_BLOCK))
  const longerDated = summarizeLotsBlock(mine.filter(lot => lot.daysToExpiry > WEBULL_SHORT_DATED_DAYS_BLOCK))
  const stock = params.stock.get(ticker) ?? null
  if (!shortDated && !longerDated && !stock) return null
  return { ticker, shortDated, longerDated, stock, throughStatement: params.lastStatement }
}

export interface WebullOverallTrackRecordBlock {
  shortDated: WebullTrackSummaryBlock | null
  longerDated: WebullTrackSummaryBlock | null
  stockNet: number
  stockCompanies: number
  /** Net of what was bought in each year, short- and longer-dated. */
  byYear: Array<{ year: string; shortDated: number; longerDated: number }>
  /** Each company's net across its options and shares. */
  byTicker: Array<{ ticker: string; net: number }>
  throughStatement: string
}

export function overallTrackRecordBlock(params: {
  lots: WebullOptionLotBlock[]
  stock: Map<string, { bought: number; sold: number; held: number; net: number }>
  lastStatement: string
}): WebullOverallTrackRecordBlock {
  const shortLots = params.lots.filter(lot => lot.daysToExpiry <= WEBULL_SHORT_DATED_DAYS_BLOCK)
  const longLots = params.lots.filter(lot => lot.daysToExpiry > WEBULL_SHORT_DATED_DAYS_BLOCK)
  const years = new Map<string, { shortDated: number; longerDated: number }>()
  for (const lot of params.lots) {
    const year = lot.boughtOn.slice(0, 4)
    const entry = years.get(year) ?? { shortDated: 0, longerDated: 0 }
    if (lot.daysToExpiry <= WEBULL_SHORT_DATED_DAYS_BLOCK) entry.shortDated += lot.net
    else entry.longerDated += lot.net
    years.set(year, entry)
  }
  const tickers = new Map<string, number>()
  for (const lot of params.lots) tickers.set(lot.ticker.toUpperCase(), (tickers.get(lot.ticker.toUpperCase()) ?? 0) + lot.net)
  for (const [ticker, value] of params.stock) tickers.set(ticker.toUpperCase(), (tickers.get(ticker.toUpperCase()) ?? 0) + value.net)
  return {
    byTicker: [...tickers.entries()].map(([ticker, net]) => ({ ticker, net })),
    shortDated: summarizeLotsBlock(shortLots),
    longerDated: summarizeLotsBlock(longLots),
    stockNet: [...params.stock.values()].reduce((sum, value) => sum + value.net, 0),
    stockCompanies: params.stock.size,
    byYear: [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => ({ year, ...value })),
    throughStatement: params.lastStatement,
  }
}

/** Signed money in K/M for track-record figures: +$1.2K, −$72.6K, +$1.05M. */
export function f9SignedMoneyKBlock(value: number): string {
  const abs = Math.abs(value)
  const text = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M` : abs >= 1000 ? `$${(abs / 1000).toFixed(1)}K` : `$${Math.round(abs)}`
  return `${value < 0 ? '−' : '+'}${text}`
}
