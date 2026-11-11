// F9 sync: the one engine behind every F9 fetch.
//
// A dataset says how to bring one kind of data up to date for one company and
// nothing else: no loop, no pacing, no record of its own. The engine owns the
// rest, once:
//   - the plan: which (dataset, company) items are due, read off the ledger in
//     the vault (f9SyncPlanBlock, f9SyncLedgerBlock);
//   - lanes: a dataset names the site it asks; items of one lane go one at a
//     time, paced, so a site is never asked twice at once. Lanes run side by
//     side, at most three;
//   - one item per company at a time, so two datasets never write the same
//     company's files together, and a dataset that needs another's result for
//     the same company (options after prices) waits for it;
//   - failures: tried once more at the end of the run, then written to the
//     ledger and tried again by later checks (entryDueBlock). A site that is
//     limiting requests is given room, and after three such answers its lane
//     waits for the next check; a sign-in problem stops its lane at once;
//   - progress, the list of what just happened, and Stop.
// Nothing runs on a timer. The app asks for what is due when it comes to the
// front (useF9AppSyncBlock); everything else is asked for by a person.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { startActivity } from '@/services/lego_blocks/units/backgroundActivityBlock'
import { readWebullExecutionSettingsOrch } from './webullExecutionSettingsOrch'
import {
  f9TrackedTickersBlock,
  readF9SyncFactsBlock,
  readF9SyncLedgerBlock,
  readF9SyncYoursBlock,
  writeF9SyncFactsBlock,
  writeF9SyncLedgerBlock,
  writeF9SyncYoursBlock,
} from '../lego_blocks/integrations/f9SyncLedgerBlock'
import {
  entryDueBlock,
  entryFailingBlock,
  f9SyncKeyBlock,
  planBlock,
  recordFailureBlock,
  recordResultBlock,
  tallyBlock,
  type F9SyncAskBlock,
  type F9SyncCompanyBlock,
  type F9SyncDatasetPlanBlock,
  type F9SyncFactsBlock,
  type F9SyncItemBlock,
  type F9SyncLedgerBlock,
  type F9SyncOutcomeBlock,
  type F9SyncResultBlock,
  type F9SyncScopeBlock,
  type F9SyncTallyBlock,
} from '../lego_blocks/units/f9SyncPlanBlock'

export interface F9SyncDatasetBlock extends F9SyncDatasetPlanBlock {
  label: string
  /** One line: what it keeps */
  about: string
  /** The site it asks. Items of one lane go one at a time. */
  lane: string
  /** The pause after an item that asked the site */
  paceMs?: number
  /** Datasets that must be through for the same company first */
  needs?: string[]
  available(): boolean
  /** Bring one company up to date (null for a job). Throw on failure. */
  /** `byHand`: someone asked for it just now (it may do what needs them, like a sign-in) */
  sync(company: F9SyncCompanyBlock | null, ctx: { root: string; signal: AbortSignal; byHand: boolean }): Promise<F9SyncResultBlock>
  /** The dataset has nothing more waiting: write whatever it batched */
  flush?(root: string): Promise<void>
}

/** Thrown by a dataset when every item of its lane would fail the same way (not signed in). */
export class F9SyncLaneStopBlock extends Error {}

/**
 * Thrown by a dataset when the source answered but has nothing for this company
 * (a fund has no analyst estimates, a foreign listing no SEC filings). Not a
 * failure: the item is recorded as not covered and asked again in a month.
 */
export class F9SyncNotCoveredBlock extends Error {}

/**
 * Thrown when the failure needs you (a sign-in that expired). The lane stops, and
 * the item is not tried again on its own: only once you ask, after signing in.
 */
export class F9SyncNeedsYouBlock extends Error {}

/** Every company sync covers; `yours` is the tickers known to be in your lists. */
export type F9SyncRosterBlock = (root: string, yours: Set<string>) => Promise<F9SyncCompanyBlock[]>

export type F9SyncItemStateBlock = F9SyncOutcomeBlock | 'failed' | 'retrying' | 'postponed'

export interface F9SyncEventBlock {
  at: string
  dataset: string
  ticker: string
  state: F9SyncItemStateBlock
  detail?: string
  /** For one of your companies */
  yours: boolean
}

export interface F9SyncDatasetViewBlock {
  id: string
  label: string
  about: string
  cadence: F9SyncDatasetBlock['cadence']
  available: boolean
  yours: F9SyncTallyBlock
  everyone: F9SyncTallyBlock
  /** Items of this dataset still waiting in the run */
  waiting: number
  /** Of those, the ones for your companies */
  waitingYours: number
  /** The company being synced right now ('' for a job), or null */
  working: string | null
  failures: Array<{ ticker: string; error: string; at: string; yours: boolean }>
  /** Each of your companies the dataset covers, A to Z, and where it stands: one mark each in the panel */
  cells: Array<{ ticker: string; state: F9SyncCellStateBlock }>
}

export type F9SyncCellStateBlock = 'fresh' | 'due' | 'failed' | 'working' | 'waiting' | 'never'

export interface F9SyncRunBlock {
  reason: 'auto' | 'user'
  startedAt: string
  total: number
  done: number
  failed: number
}

export interface F9SyncSnapshotBlock {
  /** The roster and ledgers have been read */
  ready: boolean
  /** Fetching is possible here (the desktop app) */
  canSync: boolean
  companies: { yours: number; everyone: number }
  datasets: F9SyncDatasetViewBlock[]
  run: F9SyncRunBlock | null
  /** Companies with something still to do in the run: yours, and everyone else */
  left: { yours: number; others: number }
  /** What each lane is on */
  working: Array<{ dataset: string; ticker: string }>
  /** What just happened, newest first */
  recent: F9SyncEventBlock[]
  /** Lanes that stopped early in the last run, and why */
  notices: string[]
}

export interface F9SyncDepsBlock {
  now(): Date
  /** Resolves after `ms`; 0 still lets the app breathe between items */
  sleep(ms: number): Promise<void>
  root(): Promise<string | null>
  readLedger(root: string, dataset: string): Promise<F9SyncLedgerBlock>
  writeLedger(root: string, dataset: string, ledger: F9SyncLedgerBlock): Promise<void>
  readFacts(root: string): Promise<Record<string, F9SyncFactsBlock>>
  writeFacts(root: string, facts: Record<string, F9SyncFactsBlock>): Promise<void>
  readYours(root: string): Promise<string[]>
  writeYours(root: string, tickers: string[]): Promise<void>
  tracked(root: string): Promise<string[]>
  /** Named while a run is on, so a main-thread stall is put down to it */
  activity?(label: string): { end(): void }
}

const MAX_LANES = 3
const AUTO_EVERY_MS = 10 * 60 * 1000
const LEDGER_WRITE_EVERY_MS = 20_000
const RECENT_KEPT = 120
const FAILURES_SHOWN = 40
const TRIES_PER_RUN = 2
const LIMIT_STRIKES = 3
const LIMIT_COOL_MS = 20_000
const LIMITED = /\b429\b|too many requests|rate.?limit|limiting requests/i

const EMPTY: F9SyncSnapshotBlock = { ready: false, canSync: false, companies: { yours: 0, everyone: 0 }, datasets: [], run: null, left: { yours: 0, others: 0 }, working: [], recent: [], notices: [] }

const errorTextBlock = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type QueuedBlock = F9SyncItemBlock & { byHand: boolean; again: boolean }

export function createF9SyncOrch(deps: F9SyncDepsBlock) {
  const datasets = new Map<string, F9SyncDatasetBlock>()
  let roster: F9SyncRosterBlock = async (root, yours) =>
    [...yours].sort().map(ticker => ({ ticker, yours: true, folder: `${root}/${ticker}`, pricesRoot: root }))

  // -- What is known -----------------------------------------------------------
  let root: string | null = null
  let companies: F9SyncCompanyBlock[] = []
  let byTicker = new Map<string, F9SyncCompanyBlock>()
  const ledgers: Record<string, F9SyncLedgerBlock> = {}
  const unsaved = new Set<string>()
  let facts: Record<string, F9SyncFactsBlock> = {}
  let factsUnsaved = false
  let lastLedgerWrite = 0
  let loading: Promise<void> | null = null
  let ready = false

  async function loadBlock(): Promise<void> {
    root = (await deps.root())?.replace(/\/+$/, '') || null
    if (!root) {
      companies = []
      byTicker = new Map()
      ready = true
      return touch()
    }
    const at = root
    const [published, tracked, known] = await Promise.all([deps.readYours(at), deps.tracked(at), deps.readFacts(at)])
    if (!factsUnsaved) facts = known
    companies = (await roster(at, new Set([...published, ...tracked]))).map(c => (facts[c.ticker] ? { ...c, facts: { ...facts[c.ticker], ...c.facts } } : c))
    byTicker = new Map(companies.map(c => [c.ticker, c]))
    // A ledger with unsaved entries is newer than its file
    await Promise.all([...datasets.keys()].filter(id => !unsaved.has(id)).map(async (id) => { ledgers[id] = await deps.readLedger(at, id) }))
    ready = true
    touch()
  }
  const loadedBlock = () => (loading ??= loadBlock().catch(() => { loading = null }))
  /** Read the vault again (another device may have synced); never under a run. */
  const refreshBlock = () => (run ? loadedBlock() : (loading = loadBlock().catch(() => { loading = null })))

  async function writeLedgersBlock(): Promise<void> {
    if (!root) return
    lastLedgerWrite = deps.now().getTime()
    if (factsUnsaved) {
      factsUnsaved = false
      await deps.writeFacts(root, facts).catch(() => { factsUnsaved = true })
    }
    const ids = [...unsaved]
    unsaved.clear()
    await Promise.all(ids.map(id => deps.writeLedger(root!, id, ledgers[id] ?? {}).catch(() => { unsaved.add(id) })))
  }

  // -- The run -------------------------------------------------------------------
  let queue: QueuedBlock[] = []
  /** Keys waiting or being worked on */
  const pending = new Set<string>()
  /** Items left per dataset, to know when one has had its last */
  const left = new Map<string, number>()
  const working = new Map<string, QueuedBlock>()
  const busy = new Set<string>()
  const lanesOn = new Set<string>()
  const tries = new Map<string, number>()
  /** Items that failed or were put off in this run: what needs them is put off too */
  const unmet = new Set<string>()
  const parked = new Map<string, string>()
  const strikes = new Map<string, number>()
  let run: (F9SyncRunBlock & { everyone: boolean }) | null = null
  let recent: F9SyncEventBlock[] = []
  let stopping = false
  let abort = new AbortController()
  let activity: { end(): void } | null = null
  let lastAuto = 0
  const asks = new Set<{ keys: Set<string>; states: Record<string, F9SyncItemStateBlock>; done(states: Record<string, F9SyncItemStateBlock>): void }>()
  const savedListeners = new Set<(ticker: string, dataset: string) => void>()
  const drainedListeners = new Set<(run: { reason: 'auto' | 'user'; everyone: boolean; done: number; failed: number }) => void>()

  const sortQueueBlock = () => {
    const order = (i: QueuedBlock) => datasets.get(i.dataset)?.order ?? 99
    queue.sort((a, b) => Number(a.again) - Number(b.again) || Number(b.byHand) - Number(a.byHand)
      || Number(b.yours) - Number(a.yours) || order(a) - order(b) || a.ticker.localeCompare(b.ticker))
  }

  function logBlock(item: F9SyncItemBlock, state: F9SyncItemStateBlock, detail?: string): void {
    recent = [{ at: deps.now().toISOString(), dataset: item.dataset, ticker: item.ticker, state, yours: item.yours, ...(detail ? { detail } : {}) }, ...recent].slice(0, RECENT_KEPT)
  }

  /** An item is through, one way or another. */
  function finishBlock(item: F9SyncItemBlock, state: F9SyncItemStateBlock, detail?: string, quiet = false): void {
    pending.delete(item.key)
    left.set(item.dataset, (left.get(item.dataset) ?? 1) - 1)
    if (run) {
      run.done += 1
      if (state === 'failed') run.failed += 1
    }
    if (state === 'failed' || state === 'postponed') unmet.add(item.key)
    if (!quiet && state !== 'current') logBlock(item, state, detail)
    for (const ask of asks) {
      if (!ask.keys.delete(item.key)) continue
      ask.states[item.key] = state
      if (ask.keys.size === 0) {
        asks.delete(ask)
        ask.done(ask.states)
      }
    }
    touch()
  }

  function parkBlock(lane: string, why: string): void {
    parked.set(lane, why)
    const [gone, kept] = [queue.filter(i => datasets.get(i.dataset)?.lane === lane), queue.filter(i => datasets.get(i.dataset)?.lane !== lane)]
    queue = kept
    for (const item of gone) finishBlock(item, 'postponed', undefined, true)
  }

  /** The lane's next item that can start now; items whose need fell through are put off on the way. */
  function pickBlock(lane: string): QueuedBlock | null {
    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i]
      const dataset = datasets.get(item.dataset)
      if (!dataset || dataset.lane !== lane) continue
      if (item.ticker && busy.has(item.ticker)) continue
      const needs = (dataset.needs ?? []).map(n => f9SyncKeyBlock(n, item.ticker))
      if (needs.some(k => unmet.has(k))) {
        queue.splice(i, 1)
        i -= 1
        finishBlock(item, 'postponed', undefined, true)
        continue
      }
      if (needs.some(k => pending.has(k))) continue
      queue.splice(i, 1)
      return item
    }
    return null
  }

  /** Works one item; returns how long the lane should rest before its next. */
  async function workBlock(item: QueuedBlock, lane: string): Promise<number> {
    const dataset = datasets.get(item.dataset)!
    const company = item.ticker ? byTicker.get(item.ticker) ?? null : null
    let pause = 0
    if (item.ticker && !company) {
      finishBlock(item, 'postponed', undefined, true)
    } else if (company && !dataset.covers(company)) {
      // Learned since the plan was made (a fund, a foreign listing): not this dataset's
      finishBlock(item, 'current', undefined, true)
    } else {
      working.set(lane, item)
      if (item.ticker) busy.add(item.ticker)
      touch()
      try {
        const result: F9SyncResultBlock = await dataset.sync(company, { root: root!, signal: abort.signal, byHand: item.byHand })
          .catch((err: unknown) => {
            // Nothing there for this company: not a failure
            if (err instanceof F9SyncNotCoveredBlock) return { outcome: 'not-covered' as const, detail: errorTextBlock(err) }
            throw err
          })
        if (result.facts && company) {
          facts = { ...facts, [company.ticker]: { ...facts[company.ticker], ...result.facts } }
          company.facts = facts[company.ticker]
          factsUnsaved = true
        }
        ledgers[dataset.id] = { ...ledgers[dataset.id], [item.ticker]: recordResultBlock(result, deps.now().toISOString()) }
        unsaved.add(dataset.id)
        strikes.delete(lane)
        if (result.outcome !== 'current') pause = dataset.paceMs ?? 0
        working.delete(lane)
        busy.delete(item.ticker)
        finishBlock(item, result.outcome, result.detail)
        if (result.outcome === 'fetched') for (const l of savedListeners) l(item.ticker, dataset.id)
      } catch (err) {
        const message = errorTextBlock(err)
        const needsYou = err instanceof F9SyncNeedsYouBlock
        const laneStop = needsYou || err instanceof F9SyncLaneStopBlock
        const tried = (tries.get(item.key) ?? 0) + 1
        tries.set(item.key, tried)
        working.delete(lane)
        busy.delete(item.ticker)
        pause = dataset.paceMs ?? 0
        if (!laneStop && !stopping && tried < TRIES_PER_RUN) {
          // Once more, after everything else
          queue.push({ ...item, again: true })
          logBlock(item, 'retrying', message)
          touch()
        } else {
          ledgers[dataset.id] = { ...ledgers[dataset.id], [item.ticker]: recordFailureBlock(ledgers[dataset.id]?.[item.ticker], message, deps.now().toISOString(), needsYou) }
          unsaved.add(dataset.id)
          finishBlock(item, 'failed', message)
        }
        if (laneStop) {
          parkBlock(lane, message)
        } else if (LIMITED.test(message)) {
          const n = (strikes.get(lane) ?? 0) + 1
          strikes.set(lane, n)
          if (n >= LIMIT_STRIKES) parkBlock(lane, `${dataset.label}: the site is limiting requests. The rest waits for the next check.`)
          else pause = LIMIT_COOL_MS * n
        }
      }
      // The dataset's last item of the run: let it write what it batched
      if (dataset.flush && (left.get(dataset.id) ?? 0) <= 0) await dataset.flush(root!).catch(() => undefined)
      if (unsaved.size > 0 && deps.now().getTime() - lastLedgerWrite > LEDGER_WRITE_EVERY_MS) await writeLedgersBlock()
    }
    return stopping ? 0 : pause
  }

  async function runLaneBlock(lane: string): Promise<void> {
    lanesOn.add(lane)
    let worked = false
    try {
      for (let item = pickBlock(lane); item; item = pickBlock(lane)) {
        worked = true
        const pause = await workBlock(item, lane)
        // Finishing may have freed a company or a need another lane was waiting on
        kickBlock()
        await deps.sleep(pause)
      }
    } finally {
      lanesOn.delete(lane)
    }
    if (worked) kickBlock()
    else void settleBlock()
  }

  function kickBlock(): void {
    for (const item of queue) {
      if (lanesOn.size >= MAX_LANES) return
      const lane = datasets.get(item.dataset)?.lane
      if (lane && !lanesOn.has(lane) && !parked.has(lane)) void runLaneBlock(lane)
    }
    if (lanesOn.size === 0) void settleBlock()
  }

  let settling = false
  /** No lane is on: either the run is through, or what is left can never start. */
  async function settleBlock(): Promise<void> {
    if (settling || lanesOn.size > 0 || !run) return
    settling = true
    try {
      // Nothing can be waiting on anything now; anything left is stuck, and is put off rather than left hanging
      const stuck = queue
      queue = []
      for (const item of stuck) finishBlock(item, 'postponed', undefined, true)
      await writeLedgersBlock()
    } finally {
      settling = false
    }
    // Something was asked for while the ledgers were being written: the run goes on
    if (queue.length > 0 || lanesOn.size > 0) return kickBlock()
    const done = { reason: run.reason, everyone: run.everyone, done: run.done, failed: run.failed }
    run = null
    stopping = false
    tries.clear()
    unmet.clear()
    strikes.clear()
    pending.clear()
    left.clear()
    activity?.end()
    activity = null
    touch()
    for (const l of drainedListeners) l(done)
  }

  async function requestBlock(ask: F9SyncAskBlock, reason: 'auto' | 'user'): Promise<Record<string, F9SyncItemStateBlock>> {
    await loadedBlock()
    if (!root || stopping) return {}
    const items = planBlock([...datasets.values()].filter(d => d.available()), companies, ledgers, ask, deps.now())
    if (items.length === 0) return {}
    if (!run) {
      run = { reason, startedAt: deps.now().toISOString(), total: 0, done: 0, failed: 0, everyone: false }
      abort = new AbortController()
      parked.clear()
      activity = deps.activity?.('F9 sync') ?? null
    }
    if (reason === 'user') {
      // Asked for by hand: a lane that stopped earlier gets another go
      run.reason = 'user'
      parked.clear()
      strikes.clear()
    }
    if (items.some(i => !i.yours)) run.everyone = true
    for (const item of items) {
      const queued = queue.find(q => q.key === item.key)
      if (queued) queued.byHand ||= reason === 'user'
      if (pending.has(item.key)) continue
      pending.add(item.key)
      left.set(item.dataset, (left.get(item.dataset) ?? 0) + 1)
      queue.push({ ...item, byHand: reason === 'user', again: false })
      run.total += 1
    }
    sortQueueBlock()
    const result = new Promise<Record<string, F9SyncItemStateBlock>>((done) => {
      asks.add({ keys: new Set(items.map(i => i.key)), states: {}, done })
    })
    touch()
    kickBlock()
    return result
  }

  // -- What the panel reads --------------------------------------------------------
  let snapshot = EMPTY
  let stale = true
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  function rebuildBlock(): void {
    stale = false
    const now = deps.now()
    const yours = companies.filter(c => c.yours)
    const views = [...datasets.values()].sort((a, b) => a.order - b.order).map((d): F9SyncDatasetViewBlock => {
      const ledger = ledgers[d.id]
      const failures = Object.entries(ledger ?? {})
        .filter(([ticker, entry]) => entryFailingBlock(entry) && (d.job ? ticker === '' : Boolean(byTicker.get(ticker) && d.covers(byTicker.get(ticker)!))))
        .map(([ticker, entry]) => ({ ticker, error: entry.error ?? 'failed', at: entry.failedAt!, yours: byTicker.get(ticker)?.yours ?? false }))
        .sort((a, b) => Number(b.yours) - Number(a.yours) || a.ticker.localeCompare(b.ticker))
      const on = [...working.values()].find(i => i.dataset === d.id)
      const cells = d.job ? [] : yours.filter(c => !c.index && d.covers(c)).map((c) => {
        const key = f9SyncKeyBlock(d.id, c.ticker)
        const entry = ledger?.[c.ticker]
        const state: F9SyncCellStateBlock = on?.key === key ? 'working' : pending.has(key) ? 'waiting'
          : entryFailingBlock(entry) ? 'failed' : entryDueBlock(entry, d.cadence, now) ? 'due' : entry ? 'fresh' : 'never'
        return { ticker: c.ticker, state }
      }).sort((a, b) => a.ticker.localeCompare(b.ticker))
      return {
        id: d.id,
        label: d.label,
        about: d.about,
        cadence: d.cadence,
        available: d.available(),
        yours: d.job ? { total: 0, fresh: 0, due: 0, failed: 0, lastAt: null } : tallyBlock(d, yours, ledger, now),
        everyone: tallyBlock(d, companies, ledger, now),
        waiting: queue.reduce((n, i) => n + Number(i.dataset === d.id), 0),
        waitingYours: queue.reduce((n, i) => n + Number(i.dataset === d.id && i.yours), 0),
        working: on ? on.ticker : null,
        failures: failures.slice(0, FAILURES_SHOWN),
        cells,
      }
    })
    const leftYours = new Set<string>()
    const leftOthers = new Set<string>()
    for (const item of [...queue, ...working.values()]) if (item.ticker) (item.yours ? leftYours : leftOthers).add(item.ticker)
    snapshot = {
      ready,
      canSync: views.some(v => v.available),
      companies: { yours: yours.filter(c => !c.index).length, everyone: companies.filter(c => !c.index).length },
      datasets: views,
      run: run ? { reason: run.reason, startedAt: run.startedAt, total: run.total, done: run.done, failed: run.failed } : null,
      left: { yours: leftYours.size, others: leftOthers.size },
      working: [...working.values()].map(i => ({ dataset: i.dataset, ticker: i.ticker })),
      recent,
      notices: [...parked.values()],
    }
  }

  /** Something changed. While a run is on, the panel is redrawn at most five times a second. */
  function touch(): void {
    stale = true
    if (listeners.size === 0 || timer) return
    timer = setTimeout(() => {
      timer = null
      rebuildBlock()
      for (const l of listeners) l()
    }, run ? 200 : 0)
  }

  return {
    registerDataset(dataset: F9SyncDatasetBlock): void {
      datasets.set(dataset.id, dataset)
      loading = null
      touch()
    },
    setRoster(next: F9SyncRosterBlock): void {
      roster = next
      loading = null
      touch()
    },
    read(): F9SyncSnapshotBlock {
      if (stale && !timer) rebuildBlock()
      return snapshot
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      void loadedBlock()
      return () => { listeners.delete(listener) }
    },
    /** A company's files changed (something new was saved). */
    onSaved(listener: (ticker: string, dataset: string) => void): () => void {
      savedListeners.add(listener)
      return () => { savedListeners.delete(listener) }
    },
    /** A run ended. */
    onDrained(listener: (run: { reason: 'auto' | 'user'; everyone: boolean; done: number; failed: number }) => void): () => void {
      drainedListeners.add(listener)
      return () => { drainedListeners.delete(listener) }
    },
    /** The automatic check: everything that is due, at most every ten minutes. */
    async syncDue(): Promise<void> {
      const now = deps.now().getTime()
      if (now - lastAuto < AUTO_EVERY_MS) return
      lastAuto = now
      await refreshBlock()
      void requestBlock({ scope: 'everyone', mode: 'due' }, 'auto')
    },
    /** By hand. Resolves when what was asked for is through, with each item's end state by key. */
    sync(ask: F9SyncAskBlock): Promise<Record<string, F9SyncItemStateBlock>> {
      return requestBlock(ask, 'user')
    },
    /** Asked for by the app, not a person (a page opening): it never does what needs you. */
    syncAuto(ask: F9SyncAskBlock): Promise<Record<string, F9SyncItemStateBlock>> {
      return requestBlock(ask, 'auto')
    },
    /** Sync now: what is due, what failed, and everything on demand. */
    syncNow(scope: F9SyncScopeBlock): Promise<Record<string, F9SyncItemStateBlock>> {
      return requestBlock({ scope, mode: 'now' }, 'user')
    },
    /** End the run after the items being worked on; what was waiting stays due. */
    stop(): void {
      if (!run) return
      stopping = true
      abort.abort()
      const left = queue
      queue = []
      for (const item of left) finishBlock(item, 'postponed', undefined, true)
      touch()
      if (lanesOn.size === 0) void settleBlock()
    },
    /** The companies in your lists, as the F9 page sees them; kept in the vault for every device. */
    async publishYours(tickers: string[]): Promise<void> {
      await loadedBlock()
      if (!root || tickers.length === 0) return
      const next = [...new Set(tickers.map(t => t.toUpperCase()))].sort()
      const before = [...(await deps.readYours(root))].sort()
      if (before.join(',') === next.join(',')) return
      await deps.writeYours(root, next)
      await refreshBlock()
    },
  }
}

export type F9SyncEngineBlock = ReturnType<typeof createF9SyncOrch>

/** The app's engine. Datasets are added by loadF9SyncEngineBlock, the one place that composes it. */
export const f9SyncOrch = createF9SyncOrch({
  now: () => new Date(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  root: async () => {
    // Without a vault there is nothing to sync
    try { getVaultFS() } catch { return null }
    return (await readWebullExecutionSettingsOrch()).executionFolderPath || null
  },
  readLedger: readF9SyncLedgerBlock,
  writeLedger: writeF9SyncLedgerBlock,
  readFacts: readF9SyncFactsBlock,
  writeFacts: writeF9SyncFactsBlock,
  readYours: readF9SyncYoursBlock,
  writeYours: writeF9SyncYoursBlock,
  tracked: f9TrackedTickersBlock,
  activity: label => startActivity({ kind: 'generic', channel: 'ambient', label }),
})
