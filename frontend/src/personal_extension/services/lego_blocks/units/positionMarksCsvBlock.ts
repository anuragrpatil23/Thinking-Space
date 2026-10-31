// Webull's view of every position at each sync, kept per company in
// <execution>/<TICKER>/position-history/webull-YYYY-MM.csv. Webull only ever
// reports a snapshot (quantity, average cost, last price, value), so this is
// how a position gets a price history at all: each sync adds a row. A change
// in quantity or average cost between rows also shows an add or a trim.
//
// Beside it, position-history/market-YYYY-MM.csv holds the market's daily
// quote for the same contracts (followedOptionQuotesBlock): Webull's marks say
// what the broker valued it at, the market file what it traded at.
//
// Before 2026-10-31 the rows went to one position-marks.csv per company, keyed
// by the position file's name. Those were moved here that day; a sync that
// still finds one (written by an older build) moves its rows and removes it
// (see legacyPositionMarksBlock).

export const POSITION_HISTORY_DIR_BLOCK = 'position-history'
export const LEGACY_POSITION_MARKS_FILE_BLOCK = 'position-marks.csv'

export const POSITION_MARKS_HEADER_BLOCK = 'synced_at,position_id,account,kind,expiry,strike,right,quantity,avg_cost,last_price,market_value,unrealized_pl'

export interface PositionMarkBlock {
  /** ISO time of the sync */
  at: string
  /** Webull's position id, or the old file name for rows moved from position-marks.csv */
  positionId: string
  account: string
  /** 'stock' or 'option'; '' when an old row did not say */
  kind: string
  expiry: string
  strike: string
  /** 'call' or 'put' for an option */
  right: string
  quantity: string
  avgCost: string
  lastPrice: string
  marketValue: string
  unrealizedPl: string
}

/** The month's file for a sync at `at`, relative to the company folder. */
export const webullMarksMonthFileBlock = (at: string) => `${POSITION_HISTORY_DIR_BLOCK}/webull-${at.slice(0, 7)}.csv`

function csvCellBlock(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function appendPositionMarksBlock(existing: string | null, marks: PositionMarkBlock[]): string {
  const base = existing && existing.trim() ? existing.replace(/\n*$/, '\n') : `${POSITION_MARKS_HEADER_BLOCK}\n`
  const rows = marks.map((m) => [m.at, m.positionId, m.account, m.kind, m.expiry, m.strike, m.right, m.quantity, m.avgCost, m.lastPrice, m.marketValue, m.unrealizedPl]
    .map(csvCellBlock).join(','))
  return rows.length === 0 ? base : `${base}${rows.join('\n')}\n`
}

export interface PositionMarkRowBlock {
  at: string
  quantity: number | null
  avgCost: number | null
  lastPrice: number | null
  marketValue: number | null
}

/** Rows for one position, oldest first. */
export function readPositionMarksBlock(csv: string, positionId: string): PositionMarkRowBlock[] {
  const num = (v: string | undefined) => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : null
  }
  return csv.split('\n').slice(1)
    .map((line) => line.split(','))
    .filter((cells) => cells[1] === positionId)
    .map((cells) => ({ at: cells[0], quantity: num(cells[7]), avgCost: num(cells[8]), lastPrice: num(cells[9]), marketValue: num(cells[10]) }))
    .sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * The old position-marks.csv rows in the new shape, by month file. The old key
 * was the position file's name (MU1600-2027-12-17-CALL-5MQ31910, MUSTOCK-5MQ31910),
 * which says the contract and the account; a name that says neither is kept as
 * the id with the rest left blank.
 */
export function legacyPositionMarksBlock(csv: string): Map<string, PositionMarkBlock[]> {
  const out = new Map<string, PositionMarkBlock[]>()
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [at, position, quantity, costPrice, lastPrice, marketValue, unrealized] = line.split(',')
    if (!at || !position) continue
    const option = /^[A-Z.]+?(\d+(?:\.\d+)?)-(\d{4}-\d{2}-\d{2})-(CALL|PUT)(?:-([A-Z0-9]+))?$/.exec(position)
    const stock = /^[A-Z.]+STOCK(?:-([A-Z0-9]+))?$/.exec(position)
    const mark: PositionMarkBlock = {
      at,
      positionId: position,
      account: option?.[4] ?? stock?.[1] ?? '',
      kind: option ? 'option' : stock ? 'stock' : '',
      expiry: option?.[2] ?? '',
      strike: option?.[1] ?? '',
      right: option ? option[3].toLowerCase() : '',
      quantity: quantity ?? '',
      avgCost: costPrice ?? '',
      lastPrice: lastPrice ?? '',
      marketValue: marketValue ?? '',
      unrealizedPl: unrealized ?? '',
    }
    const file = webullMarksMonthFileBlock(at)
    out.set(file, [...(out.get(file) ?? []), mark])
  }
  return out
}
