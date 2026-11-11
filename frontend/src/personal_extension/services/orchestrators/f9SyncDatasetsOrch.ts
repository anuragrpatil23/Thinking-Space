// The datasets F9 sync keeps without the private folder: prices, Value Line
// reports and earnings calls. Each is only "bring this company up to date";
// the engine (f9SyncOrch) decides when, for whom, and in what order.

import { issueDetailBlock } from '@/services/lego_blocks/units/passQueueBlock'
import { F9SyncLaneStopBlock, type F9SyncEngineBlock } from './f9SyncOrch'
import { earningsCallsAvailableOrch, syncEarningsCallsOrch } from './webullEarningsCallsOrch'
import { pricesAvailableOrch, syncPricesOrch } from './webullPricesOrch'
import { syncValueLineOrch, valueLineAvailableOrch } from './webullValueLineOrch'

// A sign-in problem fails every company the same way: the lane stops at the first
const LIBRARY_SIGN_IN = /Keychain|login saved|desktop app|sign-in loops|library login did not/i

export function registerF9SyncDatasetsOrch(engine: F9SyncEngineBlock): void {
  engine.registerDataset({
    id: 'prices',
    label: 'Prices',
    about: 'Daily closes, five years back',
    lane: 'yahoo',
    // Between companies, so Yahoo sees a reader, not a crawler
    paceMs: 800,
    cadence: 'daily',
    order: 10,
    covers: () => true,
    available: pricesAvailableOrch,
    sync: async (company) => {
      const result = await syncPricesOrch(company!.pricesRoot, company!.ticker)
      if (result.outcome === 'error') throw new Error(result.error)
      return result.outcome === 'not-covered'
        ? { outcome: 'not-covered', detail: 'Yahoo has no prices for this symbol' }
        : { outcome: result.outcome, detail: result.detail }
    },
  })

  engine.registerDataset({
    id: 'value-line',
    label: 'Value Line',
    about: 'The newest report for each company, from the library',
    lane: 'library',
    cadence: 'daily',
    order: 50,
    covers: c => c.yours && !c.index,
    available: valueLineAvailableOrch,
    sync: async (company, { root }) => {
      const result = await syncValueLineOrch(root, company!.ticker)
      if (result.outcome === 'error') {
        if (LIBRARY_SIGN_IN.test(result.error ?? '')) throw new F9SyncLaneStopBlock(result.error)
        throw new Error(result.error)
      }
      return { outcome: result.outcome, detail: issueDetailBlock(result.issueDate) }
    },
  })

  engine.registerDataset({
    id: 'calls',
    label: 'Earnings calls',
    about: 'Call transcripts, four years back',
    lane: 'stockanalysis',
    cadence: 'daily',
    order: 60,
    covers: c => c.yours && !c.index,
    available: earningsCallsAvailableOrch,
    sync: async (company, { root }) => {
      const result = await syncEarningsCallsOrch(root, company!.ticker)
      if (result.outcome === 'error') throw new Error(result.error)
      const n = result.written?.length ?? 0
      return { outcome: result.outcome, detail: n > 0 ? `${n} ${n === 1 ? 'call' : 'calls'}` : undefined }
    },
  })
}
