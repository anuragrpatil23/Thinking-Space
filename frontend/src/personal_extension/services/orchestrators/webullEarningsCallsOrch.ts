// Keep each tracked company's recent earnings calls in
// F9-execution/<TICKER>/calls/YYYY-MM.md, from StockAnalysis's public pages.
//
// Same shape as webullValueLineOrch: desktop only, when asked (opening a
// company, or the F9 page once a day), no timers. A company is asked only when
// it has no call yet or the newest is past due (earningsCallPlanBlock). The
// history goes back four years (EARNINGS_CALL_HISTORY_QUARTERS_BLOCK): the
// newest call is fetched to learn its quarter, then the list is walked one
// quarter per call and only quarters missing from the vault are fetched (each
// page still says its real date, so an off-cadence call lands where it
// belongs). A company with a short history is looked at again weekly even when
// its newest call is recent. A file is never overwritten: the vault's copy may
// be a longer transcript.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { listFolderEntries } from '@/services/orchestrators/fileSystemOrch'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import {
  EARNINGS_CALLS_FOLDER_NAME_BLOCK,
  earningsCallBucketBlock,
  EARNINGS_CALL_HISTORY_QUARTERS_BLOCK,
  earningsCallPlanBlock,
  parseResearchDateKeyBlock,
  shiftCallMonthBlock,
  sortResearchFilesBlock,
  type ValueLineCheckBlock,
  type WebullResearchFileBlock,
} from '../lego_blocks/units/webullCompanyDossierBlock'

/** Pages fetched for one company in one go (sixteen quarters and a spare). */
const MAX_PAGES_PER_SYNC = 18
/** Fewer calls than this in four years counts as a short history. */
const FULL_HISTORY_CALLS = 14
const SHORT_HISTORY_RECHECK_MS = 7 * 24 * 60 * 60 * 1000
export const EARNINGS_CALLS_PASS_STALE_MS = 24 * 60 * 60 * 1000

export type EarningsCallOutcomeBlock = 'current' | 'fetched' | 'no-new' | 'not-covered' | 'error'

export interface EarningsCallSyncResultBlock {
  ticker: string
  outcome: EarningsCallOutcomeBlock
  /** Files written, e.g. ["2026-08"] */
  written?: string[]
  error?: string
}

export interface EarningsCallPassBlock {
  at: string
  fetched: string[]
  notCovered: string[]
  failed: string[]
  error: string | null
}

export function earningsCallsAvailableOrch(): boolean {
  const api = window.electronAPI
  return Boolean(api?.isElectron && api.earningsCallsList && api.earningsCallGet)
}

function readChecksBlock(): Record<string, ValueLineCheckBlock> {
  return getJsonStorageItem<Record<string, ValueLineCheckBlock>>(STORAGE_KEYS.earningsCallChecks, {})
}

function writeCheckBlock(ticker: string, result: ValueLineCheckBlock['result']): void {
  setJsonStorageItem(STORAGE_KEYS.earningsCallChecks, { ...readChecksBlock(), [ticker]: { at: new Date().toISOString(), result } })
}

export function earningsCallsNotCoveredOrch(ticker: string): boolean {
  return earningsCallPlanBlock(null, readChecksBlock()[ticker.toUpperCase()], new Date()) === 'not-covered'
}

export function readLastEarningsCallPassOrch(): EarningsCallPassBlock | null {
  return getJsonStorageItem<EarningsCallPassBlock | null>(STORAGE_KEYS.earningsCallPassLast, null)
}

export function earningsCallPassDueOrch(now = Date.now()): boolean {
  const last = readLastEarningsCallPassOrch()
  return !last || now - Date.parse(last.at) > EARNINGS_CALLS_PASS_STALE_MS
}

const inflight = new Map<string, Promise<EarningsCallSyncResultBlock>>()

/** Bring one company's calls up to date. Concurrent calls for a ticker share the work. */
export function syncEarningsCallsOrch(executionRoot: string, rawTicker: string): Promise<EarningsCallSyncResultBlock> {
  const ticker = rawTicker.toUpperCase()
  const existing = inflight.get(ticker)
  if (existing) return existing
  const work = syncBlock(executionRoot.replace(/\/+$/, ''), ticker).finally(() => inflight.delete(ticker))
  inflight.set(ticker, work)
  return work
}

async function syncBlock(executionRoot: string, ticker: string): Promise<EarningsCallSyncResultBlock> {
  const api = window.electronAPI
  if (!earningsCallsAvailableOrch() || !api?.earningsCallsList || !api.earningsCallGet) {
    return { ticker, outcome: 'error', error: 'Earnings calls are fetched from the desktop app only.' }
  }
  const folder = `${executionRoot}/${ticker}/${EARNINGS_CALLS_FOLDER_NAME_BLOCK}`
  const names = await listFolderEntries(folder).then(e => e.files).catch(() => [] as string[])
  const saved = new Set(names.filter(n => /^\d{4}-\d{2}\.md$/.test(n)).map(n => n.slice(0, 7)))
  const files: WebullResearchFileBlock[] = [...saved].map(month => ({ path: `${folder}/${month}.md`, name: month, dateKey: parseResearchDateKeyBlock(`${month}.md`) }))
  const latest = sortResearchFilesBlock(files)[0] ?? null
  const now = new Date()
  const cutoff = shiftCallMonthBlock(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, -EARNINGS_CALL_HISTORY_QUARTERS_BLOCK * 3)
  const check = readChecksBlock()[ticker]
  let plan = earningsCallPlanBlock(latest, check, now)
  const historyCount = [...saved].filter(month => month >= cutoff).length
  if (plan === 'current' && historyCount < FULL_HISTORY_CALLS && check?.result !== 'not-covered'
    && (!check || now.getTime() - Date.parse(check.at) > SHORT_HISTORY_RECHECK_MS)) plan = 'ask'
  if (plan === 'current') return { ticker, outcome: 'current' }
  if (plan === 'checked') return { ticker, outcome: 'no-new' }
  if (plan === 'not-covered') return { ticker, outcome: 'not-covered' }
  try {
    const { covered, calls } = await api.earningsCallsList({ ticker })
    if (!covered) {
      writeCheckBlock(ticker, 'not-covered')
      return { ticker, outcome: 'not-covered' }
    }
    const written: string[] = []
    let pages = 0
    const fetchAndSave = async (slug: string): Promise<string | null> => {
      pages += 1
      const transcript = await api.earningsCallGet!({ ticker, slug })
      const month = earningsCallBucketBlock(transcript.date, ticker)
      if (month && month >= cutoff && !saved.has(month)) {
        await getVaultFS().write(`${folder}/${month}.md`, `Date: ${transcript.date}\n\n${transcript.text.trim()}\n`)
        saved.add(month)
        written.push(month)
      }
      return month
    }
    // The newest call says which quarter the list starts at
    const newest = calls[0] ? await fetchAndSave(calls[0].slug) : null
    if (newest) {
      for (let i = 1; i < calls.length && pages < MAX_PAGES_PER_SYNC; i += 1) {
        const expected = shiftCallMonthBlock(newest, -3 * i)
        if (expected < cutoff) break
        if (saved.has(expected)) continue
        const month = await fetchAndSave(calls[i].slug)
        if (month && month < cutoff) break
      }
    }
    writeCheckBlock(ticker, written.length > 0 ? 'fetched' : 'no-new')
    return { ticker, outcome: written.length > 0 ? 'fetched' : 'no-new', written }
  } catch (err) {
    return { ticker, outcome: 'error', error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }
  }
}

// The pass in progress, for the status line in Feed → Sources
export interface EarningsCallPassProgressBlock {
  done: number
  total: number
  fetched: number
}
let progress: EarningsCallPassProgressBlock | null = null
const listeners = new Set<() => void>()
function setProgressBlock(next: EarningsCallPassProgressBlock | null): void {
  progress = next
  for (const listener of listeners) listener()
}

export function readEarningsCallPassProgressOrch(): EarningsCallPassProgressBlock | null {
  return progress
}

export function subscribeEarningsCallPassOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let running: Promise<EarningsCallPassBlock> | null = null

/** One pass over the tracked companies; a company that fails is tried once more at the end. */
export function runEarningsCallPassOrch(executionRoot: string, tickers: string[]): Promise<EarningsCallPassBlock> {
  if (running) return running
  running = (async () => {
    const pass: EarningsCallPassBlock = { at: new Date().toISOString(), fetched: [], notCovered: [], failed: [], error: null }
    const unique = [...new Set(tickers.map(t => t.toUpperCase()))]
    const retry: string[] = []
    setProgressBlock({ done: 0, total: unique.length, fetched: 0 })
    for (const [index, ticker] of unique.entries()) {
      const result = await syncEarningsCallsOrch(executionRoot, ticker)
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'not-covered') pass.notCovered.push(ticker)
      if (result.outcome === 'error') retry.push(ticker)
      setProgressBlock({ done: index + 1, total: unique.length, fetched: pass.fetched.length })
    }
    for (const ticker of retry) {
      const result = await syncEarningsCallsOrch(executionRoot, ticker)
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'error') {
        pass.failed.push(ticker)
        pass.error = `${ticker}: ${result.error}`
      }
    }
    setJsonStorageItem(STORAGE_KEYS.earningsCallPassLast, pass)
    return pass
  })().finally(() => {
    running = null
    setProgressBlock(null)
  })
  return running
}
