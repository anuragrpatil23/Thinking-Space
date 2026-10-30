import { describe, expect, it } from 'vitest'
import { closedPositionsBlock } from '@/personal_extension/services/lego_blocks/units/webullClosedPositionsBlock'
import type { WebullPositionSummaryBlock } from '@/personal_extension/services/lego_blocks/integrations/webullExecutionStorageBlock'

const position = (over: Partial<WebullPositionSummaryBlock>): WebullPositionSummaryBlock => ({
  id: 'X', fileName: 'x.md', symbol: 'AAPL', status: 'archived', source: 'webull',
  accountId: null, accountNumber: null, cashCurrency: null, instrumentType: 'OPTION',
  optionType: 'CALL', optionExpireDate: '2026-12-18', optionExercisePrice: '200.00',
  quantity: '1', cost: '8360.00', proportion: null, lastPrice: null, unrealizedProfitLoss: null,
  dayProfitLoss: null, marketValue: '7500.00', updatedAt: '2026-07-17T15:27:29.503Z',
  linkedIdeaId: null, relatedNodes: [], tags: [], projectPresetTags: [],
  ...over,
})

describe('closedPositionsBlock', () => {
  it('folds copies of one position into a row, the copy with an account winning even when older', () => {
    const rows = closedPositionsBlock([
      position({ id: 'ACC::P1', fileName: 'a.md', accountId: 'ACC', quantity: '1', cost: '1040.00', marketValue: '5587.50', updatedAt: '2026-10-30T16:06:23.589Z' }),
      position({ id: 'P1', fileName: 'b.md', quantity: '2', cost: '2080.00', marketValue: '2935.00', updatedAt: '2026-10-30T16:06:31.495Z' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ fileName: 'a.md', accountId: 'ACC', kind: 'call', strike: 200, quantity: 1, cost: 1040, lastValue: 5587.5, closedOn: '2026-10-30' })
    expect(rows[0].result).toBeCloseTo(4547.5)
  })

  it('takes the newest copy when none has an account', () => {
    const rows = closedPositionsBlock([
      position({ id: 'P1', fileName: 'a.md', marketValue: '7500.00', updatedAt: '2026-07-17T15:27:29.503Z' }),
      position({ id: 'P1', fileName: 'b.md', marketValue: '7440.00', updatedAt: '2026-07-18T06:04:41.195Z' }),
    ])
    expect(rows.map(r => r.lastValue)).toEqual([7440])
  })

  it('leaves the result out without a cost, and puts the latest closed first', () => {
    const rows = closedPositionsBlock([
      position({ id: 'S', fileName: 's.md', instrumentType: 'STOCK', optionType: null, cost: '', updatedAt: '2026-06-25T23:01:29.749Z' }),
      position({ id: 'Q', fileName: 'q.md', updatedAt: '2026-10-30T16:06:31.495Z' }),
    ])
    expect(rows.map(r => r.fileName)).toEqual(['q.md', 's.md'])
    expect(rows[1]).toMatchObject({ kind: 'stock', cost: null, result: null })
  })
})
