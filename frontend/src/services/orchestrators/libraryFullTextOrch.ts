// Fill paywalled feed articles with their full text from the library.
//
// Runs in the desktop app only, when asked (Feed opened after a while, or the
// button in Sources): no timers. For each library source, the recent items
// without text are matched by headline in Gale (main process, paced) and the
// article's text is written into the reader's cache, marked `textInCache`. A
// source on "Only readable" then lets those articles into the reels.
//
// Looks back three days: Gale lags the feeds by hours to a day, so an item
// missed today is usually found tomorrow.

import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { setRssItemFullTextOrch } from '@/services/orchestrators/rssFeedOrch'
import type { RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import {
  LIBRARY_MATCH_THRESHOLD_BLOCK,
  LIBRARY_MIN_TEXT_CHARS_BLOCK,
  LIBRARY_SOURCES_BLOCK,
  bestLibraryHitBlock,
  librarySourceForLinkBlock,
  normTitleBlock,
  queryWordsBlock,
  type LibrarySourceBlock,
} from '@/services/lego_blocks/units/libraryMatchBlock'

const LOOKBACK_DAYS = 3
/** Items tried per pass; a pass is paced, so this keeps it to a few minutes. */
const MAX_ITEMS_PER_PASS = 60
/** Feed opened after this long since the last pass runs one again. */
export const LIBRARY_PASS_STALE_MS = 3 * 60 * 60 * 1000

export interface LibrarySourceResultBlock {
  name: string
  tried: number
  filled: number
  notFound: number
  citationOnly: number
}

export interface LibraryPassBlock {
  at: string
  filled: number
  sources: LibrarySourceResultBlock[]
  error: string | null
}

export function libraryAvailableOrch(): boolean {
  return Boolean(window.electronAPI?.isElectron && window.electronAPI.libraryGaleSearch && window.electronAPI.libraryGaleArticle)
}

export function readLastLibraryPassOrch(): LibraryPassBlock | null {
  return getJsonStorageItem<LibraryPassBlock | null>(STORAGE_KEYS.libraryFillLast, null)
}

export function libraryPassDueOrch(now = Date.now()): boolean {
  const last = readLastLibraryPassOrch()
  return !last || now - Date.parse(last.at) > LIBRARY_PASS_STALE_MS
}

function localDayBlock(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let running: Promise<LibraryPassBlock> | null = null

/** One pass over the recent paywalled items. Concurrent calls share the pass. */
export function runLibraryPassOrch(feeds: RssFeedResultBlock[], onProgress?: (done: number, total: number) => void): Promise<LibraryPassBlock> {
  if (running) return running
  running = runPassBlock(feeds, onProgress).finally(() => { running = null })
  return running
}

async function runPassBlock(feeds: RssFeedResultBlock[], onProgress?: (done: number, total: number) => void): Promise<LibraryPassBlock> {
  const api = window.electronAPI
  const now = new Date()
  const results = new Map<string, LibrarySourceResultBlock>(LIBRARY_SOURCES_BLOCK.map((s) => [s.name, { name: s.name, tried: 0, filled: 0, notFound: 0, citationOnly: 0 }]))
  const pass: LibraryPassBlock = { at: now.toISOString(), filled: 0, sources: [...results.values()], error: null }
  if (!libraryAvailableOrch() || !api?.libraryGaleSearch || !api.libraryGaleArticle) {
    return { ...pass, error: 'The library is reached from the desktop app only.' }
  }

  // Recent items without text, on a library source, newest first; one per headline
  const since = now.getTime() - LOOKBACK_DAYS * 86_400_000
  const seen = new Set<string>()
  const queue: Array<{ itemIds: string[]; title: string; day: string; source: LibrarySourceBlock }> = []
  const byTitle = new Map<string, (typeof queue)[number]>()
  const candidates = feeds.flatMap((f) => f.items)
    .filter((item) => !item.textInCache && item.pubDate && Date.parse(item.pubDate) >= since)
    .sort((a, b) => Date.parse(b.pubDate ?? '') - Date.parse(a.pubDate ?? ''))
  for (const item of candidates) {
    const source = librarySourceForLinkBlock(item.link)
    if (!source || seen.has(item.id)) continue
    seen.add(item.id)
    const key = `${source.name}|${normTitleBlock(item.title)}`
    const existing = byTitle.get(key)
    // The same story often sits in two feeds of the same paper: search once, fill both
    if (existing) { existing.itemIds.push(item.id); continue }
    const entry = { itemIds: [item.id], title: item.title, day: localDayBlock(new Date(item.pubDate as string)), source }
    byTitle.set(key, entry)
    queue.push(entry)
  }
  const work = queue.slice(0, MAX_ITEMS_PER_PASS)
  const textByDoc = new Map<string, { text: string; citationOnly: boolean }>()

  try {
    for (const [index, entry] of work.entries()) {
      onProgress?.(index, work.length)
      const result = results.get(entry.source.name)!
      result.tried += 1
      const words = queryWordsBlock(entry.title, 4)
      let best: ReturnType<typeof bestLibraryHitBlock<{ title: string; docId: string }>> = null
      // Two words first; if Gale finds nothing close, the next two
      for (const pair of [words.slice(0, 2), words.slice(2, 4)]) {
        if (pair.length === 0) continue
        const hits = await api.libraryGaleSearch({ publication: entry.source.publication, words: pair, day: entry.day, db: entry.source.db, windowDays: entry.source.windowDays })
        const candidate = bestLibraryHitBlock(entry.title, hits)
        if (candidate && (!best || candidate.score > best.score)) best = candidate
        if (best && best.score >= LIBRARY_MATCH_THRESHOLD_BLOCK) break
      }
      if (!best || best.score < LIBRARY_MATCH_THRESHOLD_BLOCK) { result.notFound += 1; continue }
      let article = textByDoc.get(best.hit.docId)
      if (!article) {
        article = await api.libraryGaleArticle({ docId: best.hit.docId, db: entry.source.db })
        textByDoc.set(best.hit.docId, article)
      }
      if (article.citationOnly || article.text.length < LIBRARY_MIN_TEXT_CHARS_BLOCK) { result.citationOnly += 1; continue }
      for (const itemId of entry.itemIds) {
        if (await setRssItemFullTextOrch(itemId, article.text)) {
          result.filled += 1
          pass.filled += 1
        }
      }
    }
    onProgress?.(work.length, work.length)
  } catch (err) {
    pass.error = err instanceof Error ? err.message : String(err)
  }
  const done = { ...pass, sources: [...results.values()] }
  setJsonStorageItem(STORAGE_KEYS.libraryFillLast, done)
  return done
}
