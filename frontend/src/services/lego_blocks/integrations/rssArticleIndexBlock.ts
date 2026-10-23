// Device-local index of the feed's cached articles, so a launch re-reads only
// the article files that changed instead of every one of them (thousands).
//
// One record per article file: its parsed item, and the file's mtime and size
// when it was parsed. A file whose mtime and size still match is taken from
// here; any other is read and parsed again (a read mark written on the phone
// arrives through iCloud as a new mtime). The app's own writes change the
// file's mtime too, so they are picked up the same way.
//
// Derived data only: the vault's files stay the source of truth (locked
// decision #3). A missing or unreadable index, or a version mismatch, means
// the files are read as before and the index is rebuilt from them.

import Dexie, { type Table } from 'dexie'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'

/** Bump when the item shape parsed from a file changes, so every record is rebuilt. */
export const RSS_ARTICLE_INDEX_VERSION = 1

export interface RssArticleIndexRecord {
  /** `${vaultRoot}|${vault-relative file path}` */
  key: string
  /** `${vaultRoot}|${feedId}`: every record of one feed folder */
  feedKey: string
  version: number
  mtimeMs: number
  size: number
  item: RssFeedItemBlock
}

class RssArticleIndexDB extends Dexie {
  articles!: Table<RssArticleIndexRecord>

  constructor() {
    super('ThinkingSpaceRssArticleIndex')
    this.version(1).stores({ articles: '&key, feedKey' })
  }
}

let db: RssArticleIndexDB | null = null
function getDbBlock(): RssArticleIndexDB {
  if (!db) db = new RssArticleIndexDB()
  return db
}

/** The records for these keys that are still valid for the given mtime and size. */
export async function readRssArticleIndexBlock(
  wanted: Array<{ key: string; mtimeMs: number; size: number }>,
): Promise<Map<string, RssFeedItemBlock>> {
  const out = new Map<string, RssFeedItemBlock>()
  if (wanted.length === 0) return out
  try {
    const records = await getDbBlock().articles.bulkGet(wanted.map(w => w.key))
    records.forEach((rec, i) => {
      const w = wanted[i]
      if (rec && rec.version === RSS_ARTICLE_INDEX_VERSION && rec.mtimeMs === w.mtimeMs && rec.size === w.size) out.set(w.key, rec.item)
    })
  } catch { /* no index: everything is read from the files */ }
  return out
}

export async function writeRssArticleIndexBlock(records: Array<Omit<RssArticleIndexRecord, 'version'>>): Promise<void> {
  if (records.length === 0) return
  try {
    await getDbBlock().articles.bulkPut(records.map(r => ({ ...r, version: RSS_ARTICLE_INDEX_VERSION })))
  } catch { /* the index is a speed-up; the files still hold everything */ }
}

/** Drop the records of a feed whose files are gone. */
export async function pruneRssArticleIndexBlock(feedKey: string, presentKeys: Set<string>): Promise<void> {
  try {
    const keys = await getDbBlock().articles.where('feedKey').equals(feedKey).primaryKeys()
    const gone = keys.filter(k => !presentKeys.has(String(k)))
    if (gone.length > 0) await getDbBlock().articles.bulkDelete(gone)
  } catch { /* stale records only cost space; a mismatched mtime never serves them */ }
}
