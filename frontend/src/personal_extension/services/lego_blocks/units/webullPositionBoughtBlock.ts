// When a held position was bought, for the position tables: the buys still
// held, oldest first. One contract is often bought on several days, so a
// position carries a list of lots, not one date. The lots are worked out by
// the private folder from Webull's record of trades (the order history, the
// statements where it does not reach); without it there are none and the
// column stays empty.

export interface PositionBoughtLotBlock {
  /** YYYY-MM-DD */
  on: string
  qty: number
}

export interface PositionBoughtBlock {
  /** Buys still held, oldest first (sales take the oldest buys first). */
  lots: PositionBoughtLotBlock[]
  /** The latest buy on record, held or not. */
  lastBuyOn: string | null
}

/** How the lots are keyed: the account number, and the contract as the logs word it ("GOOG 335 call 2027-02-19"). */
export function positionBoughtKeyBlock(p: {
  account: string | null
  symbol: string | null
  isOption: boolean
  strike: string | number | null
  right: string | null
  expiry: string | null
}): string | null {
  const symbol = (p.symbol ?? '').trim().toUpperCase()
  if (!p.account || !symbol) return null
  if (!p.isOption) return `${p.account}|${symbol} stock`
  const strike = p.strike === null || p.strike === '' ? NaN : Number(p.strike)
  if (!Number.isFinite(strike) || !p.expiry) return null
  return `${p.account}|${symbol} ${strike} ${(p.right ?? '').toLowerCase() === 'put' ? 'put' : 'call'} ${p.expiry}`
}

export interface BoughtTrade {
  on: string
  side: 'buy' | 'sell'
  qty: number
}

/**
 * The buys still held after the sales, for one contract in one account. Each
 * day is taken net, so selling and buying back the same day (booking the
 * year's result) keeps the original buy days; a net sale takes the oldest
 * lots first.
 */
export function heldLotsBlock(trades: BoughtTrade[]): PositionBoughtBlock {
  const days = new Map<string, number>()
  let lastBuyOn: string | null = null
  for (const t of trades) {
    if (!(t.qty > 0)) continue
    days.set(t.on, (days.get(t.on) ?? 0) + (t.side === 'buy' ? t.qty : -t.qty))
    if (t.side === 'buy' && (!lastBuyOn || t.on > lastBuyOn)) lastBuyOn = t.on
  }
  const lots: PositionBoughtLotBlock[] = []
  for (const [on, net] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (net > 1e-9) lots.push({ on, qty: net })
    let left = -net
    while (left > 1e-9 && lots.length > 0) {
      const take = Math.min(left, lots[0].qty)
      lots[0].qty -= take
      left -= take
      if (lots[0].qty <= 1e-9) lots.shift()
    }
  }
  return { lots: lots.map(l => ({ ...l, qty: Number(l.qty.toFixed(6)) })), lastBuyOn }
}

export interface PositionBoughtViewBlock {
  /** 'lots': the buys add up to what is held. 'latest': they do not (a split, or a trade not on record yet), so only the latest buy is shown. */
  kind: 'lots' | 'latest'
  lots: PositionBoughtLotBlock[]
}

/** What the Bought cell shows for a position holding `quantity`. */
export function positionBoughtViewBlock(bought: PositionBoughtBlock | undefined, quantity: number | null): PositionBoughtViewBlock | null {
  if (!bought) return null
  const total = bought.lots.reduce((n, l) => n + l.qty, 0)
  if (bought.lots.length > 0 && quantity !== null && Math.abs(total - quantity) < 1e-6) return { kind: 'lots', lots: bought.lots }
  return bought.lastBuyOn ? { kind: 'latest', lots: [{ on: bought.lastBuyOn, qty: quantity ?? 0 }] } : null
}
