import { describe, expect, it } from 'vitest'
import { nextStatementPeriodBlock, statementAccountsBlock, statementPathBlock, statementRowsBlock } from '@/personal_extension/services/lego_blocks/units/webullStatementsBlock'

const PERIODS = 'account,period_start,period_end,statement\r\nA1,2026-07-01,2026-07-31,individual/2026-07.pdf\r\nA1,2026-09-01,2026-09-30,individual/2026-09.pdf\nB2,2026-09-01,2026-09-30,ira/2026-09.pdf\n'

describe('webullStatementsBlock', () => {
  const accounts = statementAccountsBlock({
    individual: ['2026-07.pdf', '2026-09.pdf', '2026-10.pdf', 'notes.txt'],
    'individual/apex': [],
    ira: ['2026-09.pdf'],
    tax: ['2023.pdf'],
  }, PERIODS)

  it('groups statements by account, with the months missing, those not read yet, and how far the CSVs go', () => {
    expect(accounts.map(a => a.folder)).toEqual(['individual', 'ira', 'tax'])
    expect(accounts[0]).toMatchObject({ periods: ['2026-07', '2026-09', '2026-10'], missing: ['2026-08'], waiting: ['individual/2026-10.pdf'], coveredTo: '2026-09-30' })
    expect(accounts[1]).toMatchObject({ missing: [], waiting: [], coveredTo: '2026-09-30' })
    expect(accounts[2]).toMatchObject({ periods: ['2023'], waiting: [] })
  })
  it('suggests the period after the latest, and files it where the skill expects it', () => {
    expect(nextStatementPeriodBlock(accounts[0])).toBe('2026-11')
    expect(nextStatementPeriodBlock(accounts[2])).toBe('2024')
    expect(nextStatementPeriodBlock(undefined, new Date(2026, 0, 10))).toBe('2025-12')
    expect(statementPathBlock('ira', '2026-10')).toBe('webull/ira/2026-10.pdf')
  })
  it('one row per statement and per missing month, newest first, with what the CSVs took from each', () => {
    const trades = 'account,trade_date,statement\r\nA1,2026-07-02,individual/2026-07.pdf\r\nA1,2026-07-09,individual/2026-07.pdf\r\n'
    expect(statementRowsBlock(accounts, PERIODS, trades).map(r => [r.period, r.account, r.status, r.trades, r.end])).toEqual([
      ['2026-10', 'Individual', 'waiting', 0, null],
      ['2026-09', 'Individual', 'read', 0, '2026-09-30'],
      ['2026-09', 'IRA', 'read', 0, '2026-09-30'],
      ['2026-08', 'Individual', 'missing', 0, null],
      ['2026-07', 'Individual', 'read', 2, '2026-07-31'],
      ['2023', 'Tax', 'filed', 0, null],
    ])
  })
})
