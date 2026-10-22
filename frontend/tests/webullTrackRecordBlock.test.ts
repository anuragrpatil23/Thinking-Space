import { describe, expect, it } from 'vitest'
import { buildOptionLotsBlock, companyTrackRecordBlock, overallTrackRecordBlock, parseCsvBlock, stockByCompanyBlock } from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'

const TRADES = `account,trade_date,instrument,side,qty,net,note
A,2024-01-02,TSLA 300 call 2024-02-16,buy,2,-1000,
A,2024-01-10,TSLA 300 call 2024-02-16,buy,1,-600,
A,2024-01-20,TSLA 300 call 2024-02-16,sell,2,3000,
A,2024-02-16,TSLA 300 call 2024-02-16,sell,1,0,expired
A,2024-05-01,NVDA 1200 call 2025-01-17,buy,1,-5000,
A,2024-09-01,NVDA 120 call 2025-01-17,sell,10,9000,
A,2024-03-01,TSLA 400 call 2026-12-18,buy,1,-2000,
A,2023-01-05,TSLA stock,buy,10,-1500,
A,2023-06-05,TSLA stock,sell,4,800,"split, noted"
`
const ENDS = `account,period_end,instrument,qty,amount
A,2026-09-30,TSLA 400 call 2026-12-18,1,2500
A,2026-09-30,TSLA stock,6,2200
`

describe('webullTrackRecordBlock', () => {
  const trades = parseCsvBlock(TRADES)
  const ends = parseCsvBlock(ENDS)
  const { lots, lastStatement } = buildOptionLotsBlock(trades, ends)
  const stock = stockByCompanyBlock(trades, ends, lastStatement)
  const tsla = companyTrackRecordBlock({ ticker: 'TSLA', lots, stock, lastStatement })!

  it('parses quoted fields with commas', () => {
    expect(trades[8].note).toBe('split, noted')
  })

  it('matches sells to buys first in, first out, and counts expiries', () => {
    expect(tsla.shortDated?.purchases).toBe(2)
    // first lot: paid 1000, got the whole 2-contract sale (3000); second lot expired
    expect(tsla.shortDated?.net).toBeCloseTo(3000 - 1600)
    expect(tsla.shortDated?.madeMoney).toBeCloseTo(0.5)
    expect(tsla.shortDated?.expiredAtZero).toBeCloseTo(0.5)
  })

  it('values what is still open at the last statement', () => {
    expect(tsla.longerDated?.net).toBeCloseTo(500)
  })

  it('puts pre-split NVDA contracts on the after-split strike', () => {
    const nvda = companyTrackRecordBlock({ ticker: 'NVDA', lots, stock, lastStatement })!
    expect(nvda.longerDated?.net).toBeCloseTo(4000)
  })

  it('counts shares as sold + held − bought', () => {
    expect(tsla.stock?.net).toBeCloseTo(800 + 2200 - 1500)
  })
})

describe('overallTrackRecordBlock', () => {
  it('splits short- and longer-dated by year bought, and totals shares', () => {
    const trades = parseCsvBlock(TRADES)
    const ends = parseCsvBlock(ENDS)
    const { lots, lastStatement } = buildOptionLotsBlock(trades, ends)
    const overall = overallTrackRecordBlock({ lots, stock: stockByCompanyBlock(trades, ends, lastStatement), lastStatement })
    expect(overall.byYear).toEqual([{ year: '2024', shortDated: 1400, longerDated: 4500 }])
    expect(overall.stockNet).toBeCloseTo(1500)
    expect(overall.longerDated?.purchases).toBe(2)
  })
})
