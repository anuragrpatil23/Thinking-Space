// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createF9SyncOrch, F9SyncLaneStopBlock, type F9SyncDatasetBlock, type F9SyncDepsBlock } from '@/personal_extension/services/orchestrators/f9SyncOrch'
import type { F9SyncLedgerBlock, F9SyncResultBlock } from '@/personal_extension/services/lego_blocks/units/f9SyncPlanBlock'

// Tuesday 2026-11-10, 5:30 PM New York
const START = Date.parse('2026-11-10T22:30:00Z')

function rig(yours = ['AAPL', 'MSFT', 'NVDA']) {
  const vault: Record<string, F9SyncLedgerBlock> = {}
  const clock = { at: START }
  const pauses: number[] = []
  const deps: F9SyncDepsBlock = {
    now: () => new Date(clock.at),
    // A real turn of the event loop, so lanes interleave as they would
    sleep: (ms) => { pauses.push(ms); return new Promise(r => setTimeout(r, 0)) },
    root: async () => '/f9',
    readLedger: async (_root, id) => ({ ...vault[id] }),
    writeLedger: async (_root, id, ledger) => { vault[id] = { ...ledger } },
    readYours: async () => yours,
    writeYours: async () => undefined,
    tracked: async () => [],
  }
  const engine = createF9SyncOrch(deps)
  /** Sync now for yours, and wait for the run to close (the ledgers are written then). */
  const run = async () => {
    const closed = new Promise<void>(r => engine.onDrained(() => r()))
    const states = await engine.syncNow('yours')
    await closed
    return states
  }
  return { vault, clock, pauses, deps, engine, run }
}

/** A dataset whose sync is scripted per ticker and which records what ran together. */
function dataset(id: string, lane: string, over: Partial<F9SyncDatasetBlock> = {}, script: (ticker: string, nth: number) => F9SyncResultBlock | Error = () => ({ outcome: 'fetched' })) {
  const calls: string[] = []
  const seen = new Map<string, number>()
  const d: F9SyncDatasetBlock = {
    id, label: id, about: '', lane, cadence: 'daily', order: 10, covers: () => true, available: () => true,
    sync: async (company) => {
      const ticker = company?.ticker ?? ''
      const nth = (seen.get(ticker) ?? 0) + 1
      seen.set(ticker, nth)
      calls.push(ticker)
      trace.push(`+${id}|${ticker}`)
      await new Promise(r => setTimeout(r, 1))
      trace.push(`-${id}|${ticker}`)
      const result = script(ticker, nth)
      if (result instanceof Error) throw result
      return result
    },
    ...over,
  }
  return { d, calls }
}
let trace: string[] = []

/** The most items of `match` open at once in the trace. */
function mostAtOnce(match: (key: string) => boolean): number {
  let open = 0
  let most = 0
  for (const step of trace) {
    if (!match(step.slice(1))) continue
    open += step[0] === '+' ? 1 : -1
    most = Math.max(most, open)
  }
  return most
}

describe('the F9 sync engine', () => {
  it('runs one item per site and one per company at a time, with sites side by side', async () => {
    trace = []
    const { engine } = rig()
    engine.registerDataset(dataset('prices', 'yahoo').d)
    engine.registerDataset(dataset('options', 'yahoo', { order: 20 }).d)
    engine.registerDataset(dataset('calls', 'stockanalysis', { order: 30 }).d)
    const states = await engine.syncNow('yours')
    expect(Object.keys(states)).toHaveLength(9)
    expect(mostAtOnce(k => !k.startsWith('calls'))).toBe(1)
    for (const ticker of ['AAPL', 'MSFT', 'NVDA']) expect(mostAtOnce(k => k.endsWith(`|${ticker}`))).toBe(1)
    expect(mostAtOnce(() => true)).toBe(2)
  })

  it('waits for what a dataset needs, and puts it off when that failed', async () => {
    trace = []
    const { engine, vault, run } = rig()
    engine.registerDataset(dataset('prices', 'yahoo', {}, t => (t === 'MSFT' ? new Error('HTTP 500') : { outcome: 'fetched' })).d)
    const options = dataset('options', 'other', { order: 20, needs: ['prices'] })
    engine.registerDataset(options.d)
    const states = await run()
    for (const ticker of ['AAPL', 'NVDA']) expect(trace.indexOf(`-prices|${ticker}`)).toBeLessThan(trace.indexOf(`+options|${ticker}`))
    expect(states).toMatchObject({ 'prices|MSFT': 'failed', 'options|MSFT': 'postponed', 'options|AAPL': 'fetched' })
    expect(options.calls).not.toContain('MSFT')
    // Put off is not a failure: nothing is written, so it stays due
    expect(vault.options.MSFT).toBeUndefined()
    expect(vault.prices.MSFT).toMatchObject({ error: 'HTTP 500', fails: 1 })
  })

  it('tries a failure once more at the end of the run before writing it down', async () => {
    trace = []
    const { engine, vault, run } = rig()
    const flaky = dataset('prices', 'yahoo', {}, (t, nth) => (t === 'AAPL' && nth === 1 ? new Error('socket hang up') : { outcome: 'fetched' }))
    engine.registerDataset(flaky.d)
    const states = await run()
    expect(flaky.calls).toEqual(['AAPL', 'MSFT', 'NVDA', 'AAPL'])
    expect(states['prices|AAPL']).toBe('fetched')
    expect(vault.prices.AAPL.failedAt).toBeUndefined()
    expect(engine.read().recent.some(e => e.state === 'retrying' && e.ticker === 'AAPL')).toBe(true)
  })

  it('gives a site that is limiting requests room, then leaves its lane for the next check', async () => {
    trace = []
    const { engine, pauses } = rig(['A', 'B', 'C', 'D', 'E'])
    const limited = dataset('prices', 'yahoo', {}, () => new Error('HTTP 429'))
    const other = dataset('calls', 'stockanalysis', { order: 30 })
    engine.registerDataset(limited.d)
    engine.registerDataset(other.d)
    const states = await engine.syncNow('yours')
    expect(limited.calls).toHaveLength(3)
    expect(pauses).toContain(20_000)
    expect(pauses).toContain(40_000)
    expect(Object.values(states).filter(s => s === 'postponed').length).toBeGreaterThan(0)
    expect(other.calls).toHaveLength(5)
    expect(engine.read().notices[0]).toMatch(/limiting requests/)
  })

  it('stops a lane at once when a dataset says every item would fail the same way', async () => {
    trace = []
    const { engine, vault, run } = rig()
    const library = dataset('value-line', 'library', {}, () => new F9SyncLaneStopBlock('The library login did not work'))
    engine.registerDataset(library.d)
    await run()
    expect(library.calls).toEqual(['AAPL'])
    expect(Object.keys(vault['value-line'])).toEqual(['AAPL'])
    expect(engine.read().notices).toEqual(['The library login did not work'])
  })

  it('syncs only what is due on its own, at most every ten minutes, and a second device finds nothing to do', async () => {
    trace = []
    const first = rig()
    const prices = dataset('prices', 'yahoo')
    const quotes = dataset('live-quote', 'yahoo', { cadence: 'on-demand', order: 5 })
    first.engine.registerDataset(prices.d)
    first.engine.registerDataset(quotes.d)
    const drained = new Promise<void>(r => first.engine.onDrained(() => r()))
    await first.engine.syncDue()
    await drained
    expect(prices.calls).toEqual(['AAPL', 'MSFT', 'NVDA'])
    expect(quotes.calls).toEqual([])
    await first.engine.syncDue()
    expect(prices.calls).toHaveLength(3)

    // Another device, same vault
    const second = rig()
    Object.assign(second.vault, first.vault)
    const again = dataset('prices', 'yahoo')
    second.engine.registerDataset(again.d)
    await second.engine.syncDue()
    await new Promise(r => setTimeout(r, 5))
    expect(again.calls).toEqual([])
    expect(second.engine.read().datasets[0].yours).toMatchObject({ total: 3, fresh: 3, due: 0 })
  })

  it('Stop ends the run after the item in hand; what was waiting stays due', async () => {
    trace = []
    const { engine, vault } = rig()
    const prices = dataset('prices', 'yahoo')
    engine.registerDataset(prices.d)
    const closed = new Promise<void>(r => engine.onDrained(() => r()))
    const done = engine.syncNow('yours')
    await new Promise(r => setTimeout(r, 0))
    engine.stop()
    const states = await done
    await closed
    expect(prices.calls).toEqual(['AAPL'])
    expect(states).toMatchObject({ 'prices|MSFT': 'postponed', 'prices|NVDA': 'postponed' })
    expect(Object.keys(vault.prices)).toEqual(['AAPL'])
    expect(engine.read().run).toBeNull()
  })

  it('lets a dataset write what it batched once, after its last item', async () => {
    trace = []
    const { engine } = rig()
    let flushed = 0
    engine.registerDataset(dataset('live-quote', 'yahoo', { cadence: 'on-demand', flush: async () => { flushed += 1 } }).d)
    await engine.syncNow('yours')
    expect(flushed).toBe(1)
  })
})
