// Reads and writes the Feed's reading notes (feedNoteBlock): questions and
// comments typed while reading, and articles picked up by their tags. One
// file in the execution folder, so the phone and Obsidian see the same notes.
// Every change touches only its own line; writes go one at a time.

import { getVaultFS, isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import {
  FEED_PICKUP_TAGS_BLOCK,
  appendFeedNoteBlock,
  feedNotesPathBlock,
  feedTickerBlock,
  newFeedNoteIdBlock,
  parseFeedNotesBlock,
  replaceFeedNoteBlock,
  type FeedNoteBlock,
  type FeedNoteKindBlock,
} from '../lego_blocks/units/feedNoteBlock'
import { readWebullExecutionSettingsOrch } from './webullExecutionSettingsOrch'
import { runContract } from '@/services/orchestrators/intelligenceOrch'
import { feedAiReadAvailableOrch, feedAiReaderProviderOrch, readFeedAiReaderOrch } from '@/services/orchestrators/rssAiReadOrch'
import { plainArticleTextBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import {
  ARTICLE_COMPANIES_TEXT_CHARS_BLOCK,
  articleCompaniesContract,
  type ArticleCompanyBlock,
} from '@/services/lego_blocks/units/intelligence/contracts/articleCompaniesContractBlock'

let notes: FeedNoteBlock[] = []
let loading: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()

function notifyBlock(): void {
  for (const listener of listeners) listener()
}

export function subscribeFeedNotesOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Every note in the file, removed pick-ups included (a new array on each change). */
export function readFeedNotesOrch(): FeedNoteBlock[] {
  return notes
}

async function notesPathBlock(): Promise<string | null> {
  const { executionFolderPath } = await readWebullExecutionSettingsOrch()
  return executionFolderPath ? feedNotesPathBlock(executionFolderPath) : null
}

async function readFileBlock(path: string): Promise<string | null> {
  return getVaultFS().read(path).catch(() => null)
}

/** Read the notes file (once per session unless `force`). */
export function loadFeedNotesOrch(force = false): Promise<void> {
  if (!loading || force) {
    loading = (async () => {
      const path = await notesPathBlock()
      const content = path ? await readFileBlock(path) : null
      notes = content ? parseFeedNotesBlock(content) : []
      notifyBlock()
    })()
  }
  return loading
}

/** Change the file one step at a time, from what is on disk now. */
function editBlock(change: (content: string | null) => string | null): Promise<void> {
  const next = queue.then(async () => {
    const path = await notesPathBlock()
    if (!path) throw new Error('Choose the F9 folder in Settings → Webull first.')
    const current = await readFileBlock(path)
    const updated = change(current)
    if (updated === null || updated === current) return
    await getVaultFS().write(path, updated)
    notes = parseFeedNotesBlock(updated)
    notifyBlock()
  })
  queue = next.catch(() => {})
  return next
}

/** A question or comment about the article being read. */
export function addFeedNoteOrch(params: { kind: Exclude<FeedNoteKindBlock, 'tagged'>; text: string; item: RssFeedItemBlock; feedTitle: string }): Promise<void> {
  const text = params.text.replace(/\s+/g, ' ').trim()
  if (!text) return Promise.resolve()
  const note: FeedNoteBlock = {
    id: newFeedNoteIdBlock(),
    kind: params.kind,
    text,
    done: false,
    itemId: params.item.id,
    title: params.item.title,
    link: params.item.link,
    source: params.feedTitle,
    ticker: feedTickerBlock(params.feedTitle),
    at: new Date().toISOString(),
  }
  return editBlock(content => appendFeedNoteBlock(content, note))
}

function updateNoteBlock(id: string, change: (note: FeedNoteBlock) => FeedNoteBlock | null): Promise<void> {
  return editBlock((content) => {
    if (!content) return null
    const note = parseFeedNotesBlock(content).find(n => n.id === id)
    return note ? replaceFeedNoteBlock(content, id, change(note)) : null
  })
}

export function setFeedNoteDoneOrch(id: string, done: boolean): Promise<void> {
  return updateNoteBlock(id, note => ({ ...note, done }))
}

/** Take a note away. A picked-up one is kept, marked removed, so it is not picked up again. */
export function removeFeedNoteOrch(id: string): Promise<void> {
  return removeFeedNotesOrch([id])
}

function updateNotesBlock(ids: string[], change: (note: FeedNoteBlock) => FeedNoteBlock | null): Promise<void> {
  const wanted = new Set(ids)
  return editBlock((content) => {
    if (!content) return null
    let next = content
    for (const note of parseFeedNotesBlock(content)) {
      if (wanted.has(note.id)) next = replaceFeedNoteBlock(next, note.id, change(note))
    }
    return next
  })
}

/** Take several notes away in one write (an article's tags, say); picked-up ones are kept marked removed. */
export function removeFeedNotesOrch(ids: string[]): Promise<void> {
  return updateNotesBlock(ids, note => (note.kind === 'tagged' ? { ...note, removed: true } : null))
}

/** Mark several notes done in one write (an article written down as a Noticed record). */
export function setFeedNotesDoneOrch(ids: string[]): Promise<void> {
  return updateNotesBlock(ids, note => ({ ...note, done: true }))
}

/** Tagged notes picked up before they carried the article's date get it, while the article is still cached. */
async function backfillPublishedBlock(feeds: RssFeedResultBlock[]): Promise<void> {
  const missing = notes.filter(n => n.kind === 'tagged' && !n.published)
  if (missing.length === 0) return
  const published = new Map<string, string>()
  for (const feed of feeds) {
    for (const item of feed.items) {
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN
      if (!Number.isNaN(t)) published.set(item.id, new Date(t).toISOString())
    }
  }
  const ids = missing.filter(n => published.has(n.itemId)).map(n => n.id)
  if (ids.length === 0) return
  await updateNotesBlock(ids, note => ({ ...note, published: published.get(note.itemId) }))
}

/**
 * Pick up articles carrying one of the pick-up tags that are not noted yet
 * (desktop only, so two devices never pick up the same article twice).
 */
export async function pickUpTaggedArticlesOrch(feeds: RssFeedResultBlock[]): Promise<number> {
  if (!isElectron()) return 0
  await loadFeedNotesOrch()
  const wanted = new Set<string>(FEED_PICKUP_TAGS_BLOCK)
  const found = feeds.flatMap(feed => feed.items.flatMap(item => (item.tags ?? [])
    .filter(tag => wanted.has(tag))
    .map(tag => ({ item, tag, feedTitle: feed.feedTitle }))))
  await backfillPublishedBlock(feeds)
  const noted = new Set(notes.filter(n => n.kind === 'tagged').map(n => `${n.itemId}|${n.tag}`))
  if (!found.some(({ item, tag }) => !noted.has(`${item.id}|${tag}`))) return 0
  let added = 0
  await editBlock((content) => {
    const known = new Set(parseFeedNotesBlock(content ?? '').filter(n => n.kind === 'tagged').map(n => `${n.itemId}|${n.tag}`))
    let next = content
    for (const { item, tag, feedTitle } of found) {
      if (known.has(`${item.id}|${tag}`)) continue
      known.add(`${item.id}|${tag}`)
      next = appendFeedNoteBlock(next, {
        id: newFeedNoteIdBlock(),
        kind: 'tagged',
        text: item.title,
        done: false,
        tag,
        itemId: item.id,
        title: item.title,
        link: item.link,
        source: feedTitle,
        ticker: feedTickerBlock(feedTitle),
        at: new Date().toISOString(),
        ...(item.pubDate && !Number.isNaN(Date.parse(item.pubDate)) ? { published: new Date(item.pubDate).toISOString() } : {}),
      })
      added += 1
    }
    return next
  })
  return added
}

/** Articles whose companies could not be named this session; not asked again until the app restarts. */
const companiesFailed = new Set<string>()
let naming: Promise<number> | null = null

/**
 * Have the AI name the companies of each kept article (tagged, or with a
 * question or comment) that has none yet; every note on the article gets
 * them. Runs with the AI reader (on, desktop), one article at a time through
 * the intelligence queue. Returns how many articles were named.
 */
export function nameNoteCompaniesOrch(feeds: RssFeedResultBlock[]): Promise<number> {
  if (naming) return naming
  if (!feedAiReadAvailableOrch() || !readFeedAiReaderOrch().on) return Promise.resolve(0)
  naming = (async () => {
    await loadFeedNotesOrch()
    const waiting = new Map<string, FeedNoteBlock[]>()
    for (const note of notes) {
      if (note.removed || note.companies || !note.itemId || companiesFailed.has(note.itemId)) continue
      const list = waiting.get(note.itemId)
      if (list) list.push(note)
      else waiting.set(note.itemId, [note])
    }
    if (waiting.size === 0) return 0
    const items = new Map(feeds.flatMap(feed => feed.items).filter(item => waiting.has(item.id)).map(item => [item.id, item]))
    const provider = feedAiReaderProviderOrch()
    let named = 0
    for (const [itemId, list] of waiting) {
      const item = items.get(itemId)
      const text = item?.aiSummary?.text.replace(/\n/g, ' ') ?? plainArticleTextBlock(item?.description ?? '')
      const result = await runContract(articleCompaniesContract, {
        itemId,
        title: list[0].title,
        text: text.slice(0, ARTICLE_COMPANIES_TEXT_CHARS_BLOCK),
      }, { provider })
      if (!result.ok) {
        companiesFailed.add(itemId)
        // The provider itself is down: stop, the reader shows why
        if (/not configured|no model|unavailable|ECONNREFUSED|fetch failed/i.test(result.error.message)) break
        continue
      }
      // runContract types the value from the schema (a string); finalize made it this
      const companies = result.value as unknown as ArticleCompanyBlock[]
      await updateNotesBlock(list.map(n => n.id), note => ({ ...note, companies }))
      named += 1
    }
    return named
  })().finally(() => { naming = null })
  return naming
}
