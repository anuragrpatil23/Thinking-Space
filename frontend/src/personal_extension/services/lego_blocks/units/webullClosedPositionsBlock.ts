// A company's closed positions, from its archived_positions files: what each
// one cost, what it was worth the last time a sync saw it, and about when it
// closed. The sync has written the same position under more than one file name
// over time (a bare Webull id, then account::id), so copies are folded into one
// row. The copy with an account is the current sync's and wins (the newest of
// them); an older copy without one can hold every account's contracts together.

import type { WebullPositionSummaryBlock } from '../integrations/webullExecutionStorageBlock'

export interface WebullClosedPositionBlock {
  fileName: string
  /** The id Webull gave the position, without the account prefix */
  webullId: string | null
  symbol: string
  /** 'stock', or the option's type in lower case ('call', 'put') */
  kind: string
  strike: number | null
  expiry: string | null
  accountId: string | null
  accountNumber: string | null
  quantity: number | null
  cost: number | null
  /** Its value the last time a sync saw it open */
  lastValue: number | null
  /** lastValue − cost, when both are known */
  result: number | null
  /** YYYY-MM-DD, about when it closed */
  closedOn: string | null
}

const num = (v: string | null) => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The id Webull gave the position, without the account prefix newer files carry. */
const bareIdBlock = (p: WebullPositionSummaryBlock) => p.id.split('::').pop() || p.fileName

export function closedPositionsBlock(positions: WebullPositionSummaryBlock[]): WebullClosedPositionBlock[] {
  const byId = new Map<string, WebullPositionSummaryBlock[]>()
  for (const p of positions) {
    const key = bareIdBlock(p)
    byId.set(key, [...(byId.get(key) ?? []), p])
  }
  const rows = [...byId.values()].map((copies) => {
    const withAccount = copies.filter(c => c.accountId || c.accountNumber)
    const newest = [...(withAccount.length > 0 ? withAccount : copies)].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
    const cost = num(newest.cost)
    const lastValue = num(newest.marketValue)
    const optionType = (newest.optionType ?? '').toLowerCase()
    return {
      fileName: newest.fileName,
      webullId: bareIdBlock(newest),
      symbol: newest.symbol,
      kind: optionType || 'stock',
      strike: num(newest.optionExercisePrice),
      expiry: newest.optionExpireDate,
      accountId: newest.accountId,
      accountNumber: newest.accountNumber,
      quantity: num(newest.quantity),
      cost,
      lastValue,
      result: cost !== null && cost > 0 && lastValue !== null ? lastValue - cost : null,
      closedOn: newest.updatedAt ? newest.updatedAt.slice(0, 10) : null,
    }
  })
  // Most recently closed first.
  return rows.sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? '') || a.fileName.localeCompare(b.fileName))
}
