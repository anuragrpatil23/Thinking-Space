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
  return updateNoteBlock(id, note => (note.kind === 'tagged' ? { ...note, removed: true } : null))
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
      })
      added += 1
    }
    return next
  })
  return added
}
