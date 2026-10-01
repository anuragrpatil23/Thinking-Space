// A running price record for every Webull position, one row per position per
// sync, kept per ticker in <execution>/<TICKER>/position-marks.csv. Webull only
// ever reports a snapshot (quantity, average cost, last price, value), so this
// is how a position gets a price history at all: each refresh adds a point. A
// change in quantity or average cost between rows also shows an add or a trim.

export const POSITION_MARKS_FILE_NAME_BLOCK = 'position-marks.csv'

export const POSITION_MARKS_HEADER_BLOCK = 'at,position,quantity,cost_price,last_price,market_value,unrealized_profit_loss'

export interface PositionMarkBlock {
  at: string
  position: string
  quantity: string
  costPrice: string
  lastPrice: string
  marketValue: string
  unrealizedProfitLoss: string
}

function csvCellBlock(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function appendPositionMarksBlock(existing: string | null, marks: PositionMarkBlock[]): string {
  const base = existing && existing.trim() ? existing.replace(/\n*$/, '\n') : `${POSITION_MARKS_HEADER_BLOCK}\n`
  const rows = marks.map((m) => [m.at, m.position, m.quantity, m.costPrice, m.lastPrice, m.marketValue, m.unrealizedProfitLoss]
    .map(csvCellBlock).join(','))
  return rows.length === 0 ? base : `${base}${rows.join('\n')}\n`
}

export interface PositionMarkRowBlock {
  at: string
  quantity: number | null
  costPrice: number | null
  lastPrice: number | null
  marketValue: number | null
}

/** Rows for one position, oldest first. */
export function readPositionMarksBlock(csv: string, position: string): PositionMarkRowBlock[] {
  const num = (v: string | undefined) => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : null
  }
  return csv.split('\n').slice(1)
    .map((line) => line.split(','))
    .filter((cells) => cells[1] === position)
    .map((cells) => ({ at: cells[0], quantity: num(cells[2]), costPrice: num(cells[3]), lastPrice: num(cells[4]), marketValue: num(cells[5]) }))
    .sort((a, b) => a.at.localeCompare(b.at))
}
