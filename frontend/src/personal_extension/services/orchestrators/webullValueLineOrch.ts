// Keep each tracked company's newest Value Line report in
// F9-execution/<TICKER>/valueline/YYYY-MM.pdf, from the library.
//
// Runs in the desktop app only, when asked: opening a company, or the F9 page
// once a day (no timers). The library is asked only for a company with no
// issue or a due one (webullCompanyDossierBlock.valueLinePlanBlock), one at a
// time through main's paced library session. The PDF lands in the vault, so
// the phone gets it through sync.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { base64ToBytesBlock } from '@/services/lego_blocks/units/byteEncodingBlock'
import { listFolderEntries } from '@/services/orchestrators/fileSystemOrch'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import {
  VALUE_LINE_FOLDER_NAME_BLOCK,
  latestValueLineFileBlock,
  valueLineFileNameBlock,
  valueLineIssueToFetchBlock,
  valueLinePlanBlock,
  type ValueLineCheckBlock,
} from '../lego_blocks/units/webullCompanyDossierBlock'

/** The F9 page opened after this long since the last pass runs one again. */
export const VALUE_LINE_PASS_STALE_MS = 24 * 60 * 60 * 1000

export type ValueLineOutcomeBlock = 'current' | 'fetched' | 'no-new' | 'not-covered' | 'error'

export interface ValueLineSyncResultBlock {
  ticker: string
  outcome: ValueLineOutcomeBlock
  /** The issue fetched, YYYY-MM-DD */
  issueDate?: string
  error?: string
}

export interface ValueLinePassBlock {
  at: string
  fetched: string[]
  notCovered: string[]
  /** Companies that failed twice; the next pass or opening the company tries again. */
  failed: string[]
  error: string | null
}

export function valueLineAvailableOrch(): boolean {
  const api = window.electronAPI
  return Boolean(api?.isElectron && api.libraryValueLineIssues && api.libraryValueLineReport)
}

function readChecksBlock(): Record<string, ValueLineCheckBlock> {
  return getJsonStorageItem<Record<string, ValueLineCheckBlock>>(STORAGE_KEYS.valueLineChecks, {})
}

function writeCheckBlock(ticker: string, result: ValueLineCheckBlock['result']): void {
  setJsonStorageItem(STORAGE_KEYS.valueLineChecks, { ...readChecksBlock(), [ticker]: { at: new Date().toISOString(), result } })
}

/** Value Line said it has no report for this ticker (within the last month). */
export function valueLineNotCoveredOrch(ticker: string): boolean {
  const check = readChecksBlock()[ticker.toUpperCase()]
  return valueLinePlanBlock(null, check, new Date()) === 'not-covered'
}

export function readLastValueLinePassOrch(): ValueLinePassBlock | null {
  return getJsonStorageItem<ValueLinePassBlock | null>(STORAGE_KEYS.valueLinePassLast, null)
}

export function valueLinePassDueOrch(now = Date.now()): boolean {
  const last = readLastValueLinePassOrch()
  return !last || now - Date.parse(last.at) > VALUE_LINE_PASS_STALE_MS
}

// Each company's issue list (dates, newest first), from its last listing.
// Refreshed when older than a week; a new issue comes out about every 13.
const ISSUE_LIST_FRESH_MS = 7 * 24 * 60 * 60 * 1000

function readIssueListsBlock(): Record<string, { at: string; issues: string[] }> {
  return getJsonStorageItem<Record<string, { at: string; issues: string[] }>>(STORAGE_KEYS.valueLineIssueLists, {})
}

function writeIssueListBlock(ticker: string, issues: string[]): void {
  setJsonStorageItem(STORAGE_KEYS.valueLineIssueLists, { ...readIssueListsBlock(), [ticker]: { at: new Date().toISOString(), issues } })
}

/** The cached issue list, without asking the library; null when never listed. */
export function cachedValueLineIssuesOrch(ticker: string): string[] | null {
  return readIssueListsBlock()[ticker.toUpperCase()]?.issues ?? null
}

/** Every issue the library has for a ticker, newest first; cached for a week. */
export async function listValueLineIssuesOrch(rawTicker: string): Promise<string[]> {
  const ticker = rawTicker.toUpperCase()
  const cached = readIssueListsBlock()[ticker]
  if (cached && Date.now() - Date.parse(cached.at) < ISSUE_LIST_FRESH_MS) return cached.issues
  const api = window.electronAPI
  if (!valueLineAvailableOrch() || !api?.libraryValueLineIssues) return cached?.issues ?? []
  const { covered, issues } = await api.libraryValueLineIssues({ ticker, interactive: true })
  if (!covered) writeCheckBlock(ticker, 'not-covered')
  const dates = issues.map(i => i.issueDate)
  writeIssueListBlock(ticker, dates)
  return dates
}

/** Download one issue into the company's valueline/ folder; returns its vault path. */
export async function fetchValueLineIssueOrch(executionRoot: string, rawTicker: string, issueDate: string): Promise<string> {
  const ticker = rawTicker.toUpperCase()
  const api = window.electronAPI
  if (!valueLineAvailableOrch() || !api?.libraryValueLineReport) throw new Error('Value Line is reached from the desktop app only.')
  const path = `${executionRoot.replace(/\/+$/, '')}/${ticker}/${VALUE_LINE_FOLDER_NAME_BLOCK}/${valueLineFileNameBlock(issueDate)}`
  const { pdfBase64 } = await api.libraryValueLineReport({ ticker, issueDate, interactive: true })
  await getVaultFS().writeBytes(path, base64ToBytesBlock(pdfBase64))
  return path
}

const inflight = new Map<string, Promise<ValueLineSyncResultBlock>>()

/** Bring one company's Value Line folder up to date. Concurrent calls for a ticker share the work. */
export function syncValueLineOrch(executionRoot: string, rawTicker: string): Promise<ValueLineSyncResultBlock> {
  const ticker = rawTicker.toUpperCase()
  const existing = inflight.get(ticker)
  if (existing) return existing
  const work = syncBlock(executionRoot.replace(/\/+$/, ''), ticker).finally(() => inflight.delete(ticker))
  inflight.set(ticker, work)
  return work
}

async function syncBlock(executionRoot: string, ticker: string): Promise<ValueLineSyncResultBlock> {
  const api = window.electronAPI
  if (!valueLineAvailableOrch() || !api?.libraryValueLineIssues || !api.libraryValueLineReport) {
    return { ticker, outcome: 'error', error: 'Value Line is reached from the desktop app only.' }
  }
  const folder = `${executionRoot}/${ticker}/${VALUE_LINE_FOLDER_NAME_BLOCK}`
  const names = await listFolderEntries(folder).then(e => e.files).catch(() => [] as string[])
  const latest = latestValueLineFileBlock(folder, names)
  const plan = valueLinePlanBlock(latest, readChecksBlock()[ticker], new Date())
  if (plan === 'current' || plan === 'checked') return { ticker, outcome: plan === 'current' ? 'current' : 'no-new' }
  if (plan === 'not-covered') return { ticker, outcome: 'not-covered' }
  try {
    const { covered, issues } = await api.libraryValueLineIssues({ ticker })
    writeIssueListBlock(ticker, issues.map(i => i.issueDate))
    if (!covered) {
      writeCheckBlock(ticker, 'not-covered')
      return { ticker, outcome: 'not-covered' }
    }
    const issueDate = valueLineIssueToFetchBlock(latest, issues)
    if (!issueDate) {
      writeCheckBlock(ticker, 'no-new')
      return { ticker, outcome: 'no-new' }
    }
    const { pdfBase64 } = await api.libraryValueLineReport({ ticker, issueDate })
    await getVaultFS().writeBytes(`${folder}/${valueLineFileNameBlock(issueDate)}`, base64ToBytesBlock(pdfBase64))
    writeCheckBlock(ticker, 'fetched')
    return { ticker, outcome: 'fetched', issueDate }
  } catch (err) {
    return { ticker, outcome: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

let running: Promise<ValueLinePassBlock> | null = null

// The pass in progress, for the status line in Feed → Sources
export interface ValueLinePassProgressBlock {
  done: number
  total: number
  fetched: number
}
let progress: ValueLinePassProgressBlock | null = null
const listeners = new Set<() => void>()

function setProgressBlock(next: ValueLinePassProgressBlock | null): void {
  progress = next
  for (const listener of listeners) listener()
}

export function readValueLinePassProgressOrch(): ValueLinePassProgressBlock | null {
  return progress
}

/** Called when a pass moves or ends. */
export function subscribeValueLinePassOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * One pass over the tracked companies. A company that fails is tried once
 * more at the end (a library hiccup, or the session being re-made by another
 * request); a login failure stops the pass. Concurrent calls share it.
 */
// What the daily pass covers (set by the F9 page), so "Check now" can run it on demand
let passTarget: { executionRoot: string; tickers: string[] } | null = null

export function setValueLinePassTargetOrch(executionRoot: string, tickers: string[]): void {
  passTarget = { executionRoot, tickers }
}

/** Run the pass now, whatever the day's schedule says; null when the F9 page has not said what to cover. */
export function checkValueLineNowOrch(): Promise<ValueLinePassBlock> | null {
  return passTarget ? runValueLinePassOrch(passTarget.executionRoot, passTarget.tickers) : null
}

export function runValueLinePassOrch(executionRoot: string, tickers: string[]): Promise<ValueLinePassBlock> {
  if (running) return running
  running = (async () => {
    const pass: ValueLinePassBlock = { at: new Date().toISOString(), fetched: [], notCovered: [], failed: [], error: null }
    const unique = [...new Set(tickers.map(t => t.toUpperCase()))]
    const failed: string[] = []
    let done = 0
    const total = unique.length
    const record = (ticker: string, result: ValueLineSyncResultBlock, last: boolean): boolean => {
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'not-covered') pass.notCovered.push(ticker)
      if (result.outcome !== 'error') return true
      if (last) pass.failed.push(ticker)
      else failed.push(ticker)
      pass.error = `${ticker}: ${result.error}`
      return !/Keychain|login saved|desktop app/i.test(result.error ?? '')
    }
    setProgressBlock({ done, total, fetched: 0 })
    let carryOn = true
    for (const ticker of unique) {
      carryOn = record(ticker, await syncValueLineOrch(executionRoot, ticker), false)
      done += 1
      setProgressBlock({ done, total, fetched: pass.fetched.length })
      if (!carryOn) break
    }
    if (carryOn) {
      for (const ticker of failed) {
        if (!record(ticker, await syncValueLineOrch(executionRoot, ticker), true)) break
      }
      if (pass.failed.length === 0) pass.error = null
    } else {
      pass.failed.push(...failed)
    }
    setJsonStorageItem(STORAGE_KEYS.valueLinePassLast, pass)
    return pass
  })().finally(() => {
    running = null
    setProgressBlock(null)
  })
  return running
}
