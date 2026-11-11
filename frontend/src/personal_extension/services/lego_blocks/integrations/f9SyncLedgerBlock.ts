// F9 sync's files in the vault, under <F9-execution>/sync/:
//   <dataset>.json  one dataset's ledger (f9SyncPlanBlock): ticker -> last sync
//   yours.json      the companies in your lists, as the F9 page last saw them
// They live in the vault, not in this computer's storage, so every device
// knows what has already been fetched and none fetches it twice.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { F9SyncLedgerBlock } from '../units/f9SyncPlanBlock'

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const trim = (root: string) => root.replace(/\/+$/, '')
const syncDir = (root: string) => `${trim(root)}/sync`

async function readJsonBlock<T>(path: string, fallback: T): Promise<T> {
  try {
    const parsed = JSON.parse(await getVaultFS().read(path)) as T
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

/** Writes only when the text changed: an identical rewrite would still be re-uploaded. */
async function writeJsonBlock(root: string, name: string, value: unknown): Promise<void> {
  const fs = getVaultFS()
  const path = `${syncDir(root)}/${name}`
  const text = `${JSON.stringify(value, null, 1)}\n`
  if ((await fs.read(path).catch(() => null)) === text) return
  if (!(await fs.exists(syncDir(root)).catch(() => false))) await fs.mkdir(syncDir(root)).catch(() => undefined)
  await fs.write(path, text)
}

export function readF9SyncLedgerBlock(root: string, dataset: string): Promise<F9SyncLedgerBlock> {
  return readJsonBlock<F9SyncLedgerBlock>(`${syncDir(root)}/${dataset}.json`, {})
}

export function writeF9SyncLedgerBlock(root: string, dataset: string, ledger: F9SyncLedgerBlock): Promise<void> {
  // Sorted, so two devices write the same file for the same facts
  return writeJsonBlock(root, `${dataset}.json`, Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b))))
}

export async function readF9SyncYoursBlock(root: string): Promise<string[]> {
  const saved = await readJsonBlock<{ tickers?: unknown }>(`${syncDir(root)}/yours.json`, {})
  return Array.isArray(saved.tickers) ? saved.tickers.filter((t): t is string => typeof t === 'string' && TICKER.test(t)) : []
}

export function writeF9SyncYoursBlock(root: string, tickers: string[]): Promise<void> {
  return writeJsonBlock(root, 'yours.json', { tickers: [...new Set(tickers.filter(t => TICKER.test(t)))].sort() })
}

/** Companies with a folder of their own in F9-execution that already holds prices. */
export async function f9TrackedTickersBlock(root: string): Promise<string[]> {
  const fs = getVaultFS()
  const { folders } = await fs.list(trim(root)).catch(() => ({ folders: [] as string[] }))
  const names = folders.filter(n => TICKER.test(n))
  const has = await Promise.all(names.map(n => fs.exists(`${trim(root)}/${n}/prices.csv`).catch(() => false)))
  return names.filter((_, i) => has[i])
}
