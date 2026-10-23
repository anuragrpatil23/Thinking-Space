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

/** One pass over the tracked companies. A login failure stops the pass; concurrent calls share it. */
export function runValueLinePassOrch(executionRoot: string, tickers: string[], onProgress?: (done: number, total: number) => void): Promise<ValueLinePassBlock> {
  if (running) return running
  running = (async () => {
    const pass: ValueLinePassBlock = { at: new Date().toISOString(), fetched: [], notCovered: [], error: null }
    const unique = [...new Set(tickers.map(t => t.toUpperCase()))]
    for (const [index, ticker] of unique.entries()) {
      onProgress?.(index, unique.length)
      const result = await syncValueLineOrch(executionRoot, ticker)
      if (result.outcome === 'fetched') pass.fetched.push(ticker)
      if (result.outcome === 'not-covered') pass.notCovered.push(ticker)
      if (result.outcome === 'error') {
        pass.error = `${ticker}: ${result.error}`
        if (/library login|Keychain|desktop app/i.test(result.error ?? '')) break
      }
    }
    onProgress?.(unique.length, unique.length)
    setJsonStorageItem(STORAGE_KEYS.valueLinePassLast, pass)
    return pass
  })().finally(() => { running = null })
  return running
}
