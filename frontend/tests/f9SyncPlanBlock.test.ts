import { describe, expect, it } from 'vitest'
import {
  entryDueBlock,
  planBlock,
  recordFailureBlock,
  recordResultBlock,
  tallyBlock,
  type F9SyncCompanyBlock,
  type F9SyncDatasetPlanBlock,
} from '@/personal_extension/services/lego_blocks/units/f9SyncPlanBlock'

// Tuesday 2026-11-10, 5:30 PM New York: the day has settled (22:00 UTC)
const now = new Date('2026-11-10T22:30:00Z')
const co = (ticker: string, yours: boolean, index = false): F9SyncCompanyBlock => ({ ticker, yours, index, folder: `/x/${ticker}`, pricesRoot: '/x' })
const companies = [co('ZM', false), co('NVDA', true), co('AAPL', true), co('SPY', true, true)]
const prices: F9SyncDatasetPlanBlock = { id: 'prices', cadence: 'daily', order: 10, covers: () => true }
const quotes: F9SyncDatasetPlanBlock = { id: 'live-quote', cadence: 'on-demand', order: 5, covers: c => c.yours }
const calls: F9SyncDatasetPlanBlock = { id: 'calls', cadence: 'daily', order: 60, covers: c => c.yours && !c.index }
const job: F9SyncDatasetPlanBlock = { id: 'back-issues', cadence: 'daily', order: 95, job: true, covers: () => false }

describe('when an item is due', () => {
  it('never synced is due; synced since the day settled is not', () => {
    expect(entryDueBlock(undefined, 'daily', now)).toBe(true)
    expect(entryDueBlock(recordResultBlock({ outcome: 'no-new' }, '2026-11-10T22:10:00Z'), 'daily', now)).toBe(false)
    expect(entryDueBlock(recordResultBlock({ outcome: 'fetched' }, '2026-11-10T15:00:00Z'), 'daily', now)).toBe(true)
  })
  it('a failure is tried again after half an hour, three times, then once per trading day', () => {
    const once = recordFailureBlock(recordResultBlock({ outcome: 'fetched' }, '2026-11-09T23:00:00Z'), 'HTTP 500', '2026-11-10T22:10:00Z')
    expect(once).toMatchObject({ okAt: '2026-11-09T23:00:00Z', fails: 1, error: 'HTTP 500' })
    expect(entryDueBlock(once, 'daily', now)).toBe(false)
    expect(entryDueBlock(once, 'daily', new Date('2026-11-10T22:41:00Z'))).toBe(true)
    const thrice = recordFailureBlock(recordFailureBlock(once, 'x', '2026-11-10T22:45:00Z'), 'x', '2026-11-10T23:20:00Z')
    expect(thrice.fails).toBe(3)
    expect(entryDueBlock(thrice, 'daily', new Date('2026-11-11T15:00:00Z'))).toBe(false)
    expect(entryDueBlock(thrice, 'daily', new Date('2026-11-11T22:05:00Z'))).toBe(true)
  })
  it('a sync that works clears the failure count', () => {
    const failed = recordFailureBlock(undefined, 'x', '2026-11-10T20:00:00Z')
    const again = recordFailureBlock(recordResultBlock({ outcome: 'fetched' }, '2026-11-10T21:00:00Z'), 'y', '2026-11-10T22:00:00Z')
    expect(failed.fails).toBe(1)
    expect(again.fails).toBe(1)
  })
  it('a company the source does not cover is asked again after a month', () => {
    const entry = recordResultBlock({ outcome: 'not-covered' }, '2026-10-20T00:00:00Z')
    expect(entryDueBlock(entry, 'daily', now)).toBe(false)
    expect(entryDueBlock(entry, 'daily', new Date('2026-11-25T00:00:00Z'))).toBe(true)
  })
})

describe('what a request asks for', () => {
  const fresh = recordResultBlock({ outcome: 'no-new' }, '2026-11-10T22:10:00Z')
  const ledgers = { prices: { NVDA: fresh, ZM: fresh }, calls: { AAPL: recordFailureBlock(undefined, 'x', '2026-11-10T22:20:00Z') } }
  const keys = (ask: Parameters<typeof planBlock>[3]) => planBlock([prices, quotes, calls, job], companies, ledgers, ask, now).map(i => i.key)

  it('the automatic check: only what is due, yours first, in dataset order', () => {
    expect(keys({ scope: 'everyone', mode: 'due' })).toEqual(['prices|AAPL', 'prices|SPY', 'calls|NVDA', 'back-issues|'])
  })
  it('Sync now for yours: what is due, what failed, and everything on demand; no one else, no job', () => {
    expect(keys({ scope: 'yours', mode: 'now' })).toEqual([
      'live-quote|AAPL', 'live-quote|NVDA', 'live-quote|SPY', 'prices|AAPL', 'prices|SPY', 'calls|AAPL', 'calls|NVDA',
    ])
  })
  it('a dataset forced: every company it covers, due or not', () => {
    expect(keys({ scope: 'everyone', mode: 'force', datasets: ['prices'] })).toEqual(['prices|AAPL', 'prices|NVDA', 'prices|SPY', 'prices|ZM'])
    expect(keys({ scope: 'yours', mode: 'force', datasets: ['back-issues'] })).toEqual(['back-issues|'])
  })
  it('one company', () => {
    expect(keys({ scope: 'yours', mode: 'force', tickers: ['nvda'] })).toEqual(['live-quote|NVDA', 'prices|NVDA', 'calls|NVDA'])
  })
})

describe('where a dataset stands', () => {
  it('counts fresh, due and failed, and the newest sync that worked', () => {
    const ledger = {
      NVDA: recordResultBlock({ outcome: 'fetched' }, '2026-11-10T22:10:00Z'),
      AAPL: recordFailureBlock(recordResultBlock({ outcome: 'fetched' }, '2026-11-09T23:00:00Z'), 'x', '2026-11-10T22:20:00Z'),
    }
    expect(tallyBlock(prices, companies, ledger, now)).toEqual({ total: 4, fresh: 1, due: 2, failed: 1, lastAt: '2026-11-10T22:10:00Z' })
  })
})
