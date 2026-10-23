// The AI reading the feed alongside the user: each recent article gets a short
// summary, written into the article's own file (`aiSummary` in frontmatter),
// so the phone shows it after sync and the list marks it as read by the AI.
//
// The model is the app's: the default provider and model in Settings → AI,
// like every other AI task. The Feed only switches the reader on or off. Runs only in the desktop app, while it is open, when asked:
// the Feed opening or new articles arriving. No timers. Requests go through
// the intelligence job queue one at a time; a summary already written for the
// current prompt version is never asked for again.

import { runContract } from '@/services/orchestrators/intelligenceOrch'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import { setRssItemAiSummaryOrch } from '@/services/orchestrators/rssFeedOrch'
import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { readDefaultProviderBlock, resolveProviderBlock } from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import {
  ARTICLE_SUMMARY_TEXT_CHARS_BLOCK,
  articleSummaryContract,
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
}

/** After the model was not there, how long before trying it again (or until the settings change). */
const PROVIDER_RETRY_MS = 15 * 60 * 1000

export interface FeedAiReadProgressBlock {
  done: number
  total: number
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

/** Recent articles the AI has not read (under the current prompt), newest first. */
export function feedAiUnreadItemsBlock(feeds: RssFeedResultBlock[], now = Date.now()): Array<{ item: RssFeedItemBlock; source: string }> {
  const since = now - LOOKBACK_DAYS * 86_400_000
  return feeds
    .flatMap(feed => feed.items.map(item => ({ item, source: feed.feedTitle })))
    .filter(({ item }) => {
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN
      if (Number.isNaN(t) || t < since) return false
      return !item.aiSummary || item.aiSummary.version < articleSummaryContract.promptVersion
    })
    .sort((a, b) => Date.parse(b.item.pubDate ?? '') - Date.parse(a.item.pubDate ?? ''))
}

let running: Promise<FeedAiReadPassBlock> | null = null

/**
 * Read the recent articles the AI has not read yet. `onRead` gets each article
 * with its new summary, so the list updates as the pass goes.
 */
export function runFeedAiReadPassOrch(
  feeds: RssFeedResultBlock[],
  onRead: (item: RssFeedItemBlock) => void,
): Promise<FeedAiReadPassBlock> {
  if (running) return running
  const settings = readFeedAiReaderOrch()
  const last = readLastFeedAiReadOrch()
  const provider = feedAiReaderProviderOrch()
  if (last?.providerDown && last.provider === provider
    && Date.now() - Date.parse(last.at) < PROVIDER_RETRY_MS) return Promise.resolve(last)
  running = (async () => {
    const pass: FeedAiReadPassBlock = { at: new Date().toISOString(), read: 0, failed: 0, provider, model: '', error: null }
    if (!settings.on || !feedAiReadAvailableOrch()) return pass
    const work = feedAiUnreadItemsBlock(feeds).slice(0, MAX_PER_PASS)
    if (work.length === 0) return pass
    progress = { done: 0, total: work.length }
    notifyBlock()
    for (const { item, source } of work) {
      const result = await runContract(articleSummaryContract, {
        itemId: item.id,
        title: item.title,
        source,
        text: plainArticleTextBlock(item.description).slice(0, ARTICLE_SUMMARY_TEXT_CHARS_BLOCK),
      }, { provider })
      if (result.ok && result.value) {
        const aiSummary = { text: String(result.value), model: result.model, version: articleSummaryContract.promptVersion, at: new Date().toISOString() }
        await setRssItemAiSummaryOrch(item.id, aiSummary)
        onRead({ ...item, aiSummary })
        pass.read += 1
        pass.model = result.model
      } else {
        pass.failed += 1
        pass.error = result.ok ? 'The model gave no usable summary.' : result.error.message
        // A provider that is off or missing fails every article the same way
        if (!result.ok && /not configured|no model|unavailable|ECONNREFUSED|fetch failed/i.test(result.error.message)) {
          pass.providerDown = true
          break
        }
      }
      progress = { done: pass.read + pass.failed, total: work.length }
      notifyBlock()
    }
    setJsonStorageItem(STORAGE_KEYS.feedAiReadLast, pass)
    return pass
  })().finally(() => {
    running = null
    progress = null
    notifyBlock()
  })
  return running
}
