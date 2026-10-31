// The AI reading the feed alongside the user: each recent article gets a short
// summary, written into the article's own file (`aiSummary` in frontmatter),
// so the phone shows it after sync and the list marks it as read by the AI.
//
// The model is the app's: the default provider and model in Settings → AI,
// like every other AI task. The Feed only switches the reader on or off.
//
// Work comes in this order, one job at a time (runFeedAiNextOrch): first
// today's articles, then sorting them into today's topics and writing each
// topic's key details (rssTopicOrch), then every other recent article. Runs only in the desktop app, while it is open, when asked:
// the Feed opening or new articles arriving. No timers. Requests go through
// the intelligence job queue one at a time; a summary already written for the
// current prompt version is never asked for again.

import { setPassItemBlock, type PassItemBlock, type PassItemStateBlock } from '@/services/lego_blocks/units/passQueueBlock'
import { runContract } from '@/services/orchestrators/intelligenceOrch'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { setRssItemAiSummaryOrch } from '@/services/orchestrators/rssFeedOrch'
import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { readDefaultProviderBlock, resolveProviderBlock } from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import { rssReaderFeedsBlock, type RssFeedItemBlock, type RssFeedPreferencesBlock, type RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { localDayBlock, rssTopicItemsBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import { loadRssTopicsOrch, readAskedRssTopicsDayOrch, rssOutsideItemsOrch, rssTopicsWorkOrch, runRssOutsidePassOrch, runRssThemeNotePassOrch, runRssTopicCardPassOrch, runRssTopicSortPassOrch, runRssTopicThemePassOrch } from '@/services/orchestrators/rssTopicOrch'
import {
  ARTICLE_SUMMARY_TEXT_CHARS_BLOCK,
  articleSummaryContract,
  type ArticleSummaryOutputBlock,
  plainArticleTextBlock,
} from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'

/** Articles older than this are left as they are. */
const LOOKBACK_DAYS = 3
/** Articles read per pass; the next pass picks up the rest. */
const MAX_PER_PASS = 120

export interface FeedAiReaderSettingsBlock {
  on: boolean
}

export const FEED_AI_PROVIDER_LABELS_BLOCK: Record<ProviderId, string> = {
  'openai-compat': 'Local model',
  'claude-cli': 'Claude (CLI)',
  anthropic: 'Claude (API)',
}

/** The provider a pass would use now: Settings → AI's default (or the first one set up). */
export function feedAiReaderProviderOrch(): ProviderId {
  return resolveProviderBlock().id
}

/**
 * Unset: on when the app's default is the local model, otherwise off, so
 * tokens are never spent unasked. (Earlier versions stored a provider of their
 * own; anything but 'off' there means on.)
 */
export function readFeedAiReaderOrch(): FeedAiReaderSettingsBlock {
  const stored = getJsonStorageItem<{ on?: boolean; provider?: string }>(STORAGE_KEYS.feedAiReader, {})
  if (typeof stored.on === 'boolean') return { on: stored.on }
  if (stored.provider) return { on: stored.provider !== 'off' }
  return { on: readDefaultProviderBlock() === 'openai-compat' }
}

export function writeFeedAiReaderOrch(next: FeedAiReaderSettingsBlock): void {
  setJsonStorageItem(STORAGE_KEYS.feedAiReader, next)
  notifyBlock()
}

export function feedAiReadAvailableOrch(): boolean {
  return isElectron()
}

export interface FeedAiReadPassBlock {
  at: string
  read: number
  failed: number
  provider: string
  model: string
  error: string | null
  /** The provider itself failed (not running, no model): wait before asking again */
  providerDown?: boolean
  /** Reading articles, or writing story cards */
  kind?: 'articles' | 'stories' | 'topics'
  /** Each article (or story) and what came of it */
  items?: PassItemBlock[]
}

/** After the model was not there, how long before trying it again (or until the settings change). */
const PROVIDER_RETRY_MS = 15 * 60 * 1000

export interface FeedAiReadProgressBlock {
  done: number
  total: number
  /** Reading articles, or writing story cards */
  kind: 'articles' | 'stories' | 'topics'
  /** Each article (or story): waiting, being read, or what came of it */
  items: PassItemBlock[]
}

let progress: FeedAiReadProgressBlock | null = null
const listeners = new Set<() => void>()
function notifyBlock(): void {
  for (const listener of listeners) listener()
}

export function readFeedAiReadProgressOrch(): FeedAiReadProgressBlock | null {
  return progress
}

export function subscribeFeedAiReadOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function readLastFeedAiReadOrch(): FeedAiReadPassBlock | null {
  return getJsonStorageItem<FeedAiReadPassBlock | null>(STORAGE_KEYS.feedAiReadLast, null)
}

/** Articles that failed this session; not asked for again until the app restarts. */
const failedThisSession = new Set<string>()

/** Recent articles the AI has not read (under the current prompt), newest first. */
export function feedAiUnreadItemsBlock(feeds: RssFeedResultBlock[], now = Date.now()): Array<{ item: RssFeedItemBlock; source: string }> {
  const since = now - LOOKBACK_DAYS * 86_400_000
  return feeds
    .flatMap(feed => feed.items.map(item => ({ item, source: feed.feedTitle })))
    .filter(({ item }) => {
      if (failedThisSession.has(item.id)) return false
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN
      if (Number.isNaN(t) || t < since) return false
      return !item.aiSummary || item.aiSummary.version < articleSummaryContract.promptVersion
    })
    .sort((a, b) => Date.parse(b.item.pubDate ?? '') - Date.parse(a.item.pubDate ?? ''))
}

let running: Promise<FeedAiReadPassBlock | null> | null = null

/**
 * Read the recent articles the AI has not read yet. `onRead` gets each article
 * with its new summary, so the list updates as the pass goes.
 */
function runFeedAiReadPassOrch(
  feeds: RssFeedResultBlock[],
  onRead: (item: RssFeedItemBlock) => void,
  provider: ProviderId,
  /** Only these articles (today's, read first) */
  onlyIds?: Set<string>,
): Promise<FeedAiReadPassBlock> {
  return (async () => {
    const pass: FeedAiReadPassBlock = { at: new Date().toISOString(), read: 0, failed: 0, provider, model: '', error: null }
    const work = feedAiUnreadItemsBlock(feeds).filter(({ item }) => !onlyIds || onlyIds.has(item.id)).slice(0, MAX_PER_PASS)
    if (work.length === 0) return pass
    let items: PassItemBlock[] = work.map(({ item, source }) => ({ ticker: item.id, label: `${source.split(':')[0]}: ${item.title}`, state: 'waiting' as const }))
    const mark = (itemId: string, state: PassItemStateBlock, detail?: string) => {
      items = setPassItemBlock(items, itemId, state, detail)
      progress = { done: pass.read + pass.failed, total: work.length, kind: 'articles', items }
      notifyBlock()
    }
    progress = { done: 0, total: work.length, kind: 'articles', items }
    notifyBlock()
    for (const { item, source } of work) {
      mark(item.id, 'working')
      const result = await runContract(articleSummaryContract, {
        itemId: item.id,
        title: item.title,
        source,
        text: plainArticleTextBlock(item.description).slice(0, ARTICLE_SUMMARY_TEXT_CHARS_BLOCK),
      }, { provider, scope: 'feed' })
      if (result.ok && result.value) {
        // runContract types the value from the schema (a string); finalize made it this
        const value = result.value as unknown as ArticleSummaryOutputBlock
        const aiSummary = {
          text: value.text,
          model: result.model,
          version: articleSummaryContract.promptVersion,
          at: new Date().toISOString(),
          ...(value.storyKey ? { storyKey: value.storyKey } : {}),
        }
        await setRssItemAiSummaryOrch(item.id, aiSummary)
        onRead({ ...item, aiSummary })
        pass.read += 1
        pass.model = result.model
        const points = value.text.split('\n').filter(Boolean).length
        mark(item.id, 'fetched', `${points} ${points === 1 ? 'point' : 'points'}`)
      } else {
        pass.failed += 1
        failedThisSession.add(item.id)
        pass.error = result.ok ? 'The model gave no usable summary.' : result.error.message
        mark(item.id, 'failed', pass.error ?? undefined)
        // A provider that is off or missing fails every article the same way
        if (!result.ok && /not configured|no model|unavailable|ECONNREFUSED|fetch failed/i.test(result.error.message)) {
          pass.providerDown = true
          break
        }
      }
    }
    pass.items = items
    pass.kind = 'articles'
    return pass
  })()
}

/**
 * Do the next piece of the AI's reading, if there is one: the articles of
 * stories many are telling, then their story cards, then the rest. Returns
 * null when there was nothing to do. One job at a time; the caller asks again
 * when it ends.
 */
export function runFeedAiNextOrch(
  feeds: RssFeedResultBlock[],
  preferences: RssFeedPreferencesBlock | null,
  onRead: (item: RssFeedItemBlock) => void,
  /** Asked for by hand: try the provider again even within the wait after it was down */
  force = false,
): Promise<FeedAiReadPassBlock | null> {
  if (running) return running
  if (!readFeedAiReaderOrch().on || !feedAiReadAvailableOrch() || !preferences) return Promise.resolve(null)
  const provider = feedAiReaderProviderOrch()
  const last = readLastFeedAiReadOrch()
  if (!force && last?.providerDown && last.provider === provider
    && Date.now() - Date.parse(last.at) < PROVIDER_RETRY_MS) return Promise.resolve(null)
  running = (async () => {
    await loadRssTopicsOrch()
    const today = localDayBlock(new Date())
    const readerItems = rssReaderFeedsBlock(feeds, preferences).flatMap(feed => feed.items)
    const unreadList = feedAiUnreadItemsBlock(feeds)
    const unread = new Set(unreadList.map(({ item }) => item.id))
    const todayUnread = new Set(unreadList.filter(({ item }) => item.pubDate && localDayBlock(new Date(item.pubDate)) === today).map(({ item }) => item.id))
    const topicItems = rssTopicItemsBlock(readerItems, today)
    // What the AI read in the other sources: placed against the reading list's topics, then a paragraph per theme
    const outsideItems = rssOutsideItemsOrch(feeds, preferences, today)
    const topicWork = rssTopicsWorkOrch(topicItems, today, outsideItems)
    // A past day that is open in the Feed: its topics, once today's are done
    const askedDay = readAskedRssTopicsDayOrch()
    if (askedDay) await loadRssTopicsOrch(askedDay)
    const askedItems = askedDay ? rssTopicItemsBlock(readerItems, askedDay) : []
    const askedOutside = askedDay ? rssOutsideItemsOrch(feeds, preferences, askedDay) : []
    const askedWork = askedDay ? rssTopicsWorkOrch(askedItems, askedDay, askedOutside) : { unsorted: [], themes: [], outside: [], cards: [], notes: 0 }
    const onTopics = (done: number, total: number, items: PassItemBlock[]) => {
      progress = { done, total, kind: 'topics', items }
      notifyBlock()
    }
    const topicPassBlock = (job: Awaited<ReturnType<typeof runRssTopicSortPassOrch>>): FeedAiReadPassBlock | null => (job.done + job.failed > 0 || job.providerDown
      ? { at: new Date().toISOString(), read: 0, failed: job.failed, provider, model: '', error: job.error, kind: 'topics', items: job.items, ...(job.providerDown ? { providerDown: true } : {}) }
      : null)

    let pass: FeedAiReadPassBlock | null = null
    if (todayUnread.size > 0) {
      pass = await runFeedAiReadPassOrch(feeds, onRead, provider, todayUnread)
    } else if (topicWork.unsorted.length > 0) {
      pass = topicPassBlock(await runRssTopicSortPassOrch(topicItems, provider, onTopics))
    } else if (topicWork.themes.length > 0) {
      // One call gathers the topics under themes: before the key details, which take one call a topic
      pass = topicPassBlock(await runRssTopicThemePassOrch(provider, onTopics))
    } else if (topicWork.outside.length > 0) {
      pass = topicPassBlock(await runRssOutsidePassOrch(outsideItems, provider, onTopics))
    } else if (topicWork.cards.length > 0) {
      pass = topicPassBlock(await runRssTopicCardPassOrch(topicItems, provider, onTopics))
    } else if (topicWork.notes > 0) {
      // At fixed times of the day (rssNoteSlotBlock), not each time an article arrives
      pass = topicPassBlock(await runRssThemeNotePassOrch(outsideItems, provider, onTopics))
    } else if (askedDay && askedWork.unsorted.length > 0) {
      pass = topicPassBlock(await runRssTopicSortPassOrch(askedItems, provider, onTopics, askedDay))
    } else if (askedDay && askedWork.themes.length > 0) {
      pass = topicPassBlock(await runRssTopicThemePassOrch(provider, onTopics, askedDay))
    } else if (askedDay && askedWork.outside.length > 0) {
      pass = topicPassBlock(await runRssOutsidePassOrch(askedOutside, provider, onTopics, askedDay))
    } else if (askedDay && askedWork.cards.length > 0) {
      pass = topicPassBlock(await runRssTopicCardPassOrch(askedItems, provider, onTopics, askedDay))
    } else if (askedDay && askedWork.notes > 0) {
      pass = topicPassBlock(await runRssThemeNotePassOrch(askedOutside, provider, onTopics, askedDay))
    } else if (unread.size > 0) {
      pass = await runFeedAiReadPassOrch(feeds, onRead, provider)
    }
    if (pass && (pass.read + pass.failed > 0 || pass.providerDown)) {
      // Keep the last reading pass's model on record when this job only sorted topics
      setJsonStorageItem(STORAGE_KEYS.feedAiReadLast, pass.model ? pass : { ...pass, model: last?.model ?? '', read: last?.read ?? 0 })
    }
    return pass
  })().finally(() => {
    running = null
    progress = null
    notifyBlock()
  })
  return running
}
