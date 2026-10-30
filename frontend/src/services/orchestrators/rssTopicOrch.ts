// Today's feed by topic, kept in the vault (`.thinking-space/rss-topics.json`)
// so the phone shows what the desktop sorted. Derived: the topics are the
// model's sorting of the articles it has read today, rebuilt from scratch on a
// new day. The sorting goes in batches, each told the day's topics so far so
// names hold steady; a topic's key details are written again when an article
// joins it or the prompt changes.

import { setPassItemBlock, type PassItemBlock, type PassItemStateBlock } from '@/services/lego_blocks/units/passQueueBlock'
import { runContract } from '@/services/orchestrators/intelligenceOrch'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { plainArticleTextBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import { FEED_TOPICS_BATCH_BLOCK, feedTopicsContract, type FeedTopicsOutputBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicsContractBlock'
import { FEED_TOPIC_CARD_MAX_ARTICLES_BLOCK, FEED_TOPIC_CARD_TEXT_CHARS_BLOCK, feedTopicCardContract } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicCardContractBlock'
import {
  emptyRssTopicsDayBlock,
  localDayBlock,
  mergeRssTopicsBlock,
  rssTopicsNeedingCardBlock,
  rssTopicsUnsortedBlock,
  type RssTopicBlock,
  type RssTopicsDayBlock,
} from '@/services/lego_blocks/units/rssTopicBlock'

const TOPICS_PATH = '.thinking-space/rss-topics.json'
/** Batches sorted, and topics carded, per job; the next job does the rest. */
const BATCHES_PER_PASS = 4
const CARDS_PER_PASS = 12

let state: RssTopicsDayBlock = emptyRssTopicsDayBlock(localDayBlock(new Date()))
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function notifyBlock(): void {
  for (const listener of listeners) listener()
}

export function subscribeRssTopicsOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Today's topics in memory (a new object whenever they change); a new day reads as empty. */
export function readRssTopicsOrch(): RssTopicsDayBlock {
  const today = localDayBlock(new Date())
  if (state.day !== today) state = emptyRssTopicsDayBlock(today)
  return state
}

/** Read the vault's topics once per session. */
export function loadRssTopicsOrch(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const parsed = JSON.parse(await getVaultFS().read(TOPICS_PATH)) as Partial<RssTopicsDayBlock>
        if (parsed.day === localDayBlock(new Date()) && Array.isArray(parsed.topics)) {
          state = { day: parsed.day, topics: parsed.topics.filter(t => Array.isArray(t?.members) && typeof t.name === 'string'), skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [] }
          notifyBlock()
        }
      } catch { /* none yet */ }
    })()
  }
  return loading
}

async function saveRssTopicsBlock(): Promise<void> {
  await getVaultFS().write(TOPICS_PATH, `${JSON.stringify({ version: 1, ...state }, null, 1)}\n`)
}

export interface RssTopicPassBlock {
  done: number
  failed: number
  error: string | null
  providerDown: boolean
  items: PassItemBlock[]
  model: string
}

const providerDownBlock = (message: string) => /not configured|no model|unavailable|ECONNREFUSED|fetch failed/i.test(message)

/** Whether today's read articles hold any no topic has yet, or a topic needs its key details. */
export function rssTopicsWorkOrch(items: RssFeedItemBlock[]): { unsorted: RssFeedItemBlock[]; cards: RssTopicBlock[] } {
  const today = readRssTopicsOrch()
  return { unsorted: rssTopicsUnsortedBlock(today, items), cards: rssTopicsNeedingCardBlock(today, feedTopicCardContract.promptVersion) }
}

/** Sort today's unsorted articles into topics, a batch at a time. */
export async function runRssTopicSortPassOrch(
  items: RssFeedItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch()
  const unsorted = rssTopicsUnsortedBlock(readRssTopicsOrch(), items)
  const batches: RssFeedItemBlock[][] = []
  for (let i = 0; i < unsorted.length && batches.length < BATCHES_PER_PASS; i += FEED_TOPICS_BATCH_BLOCK) batches.push(unsorted.slice(i, i + FEED_TOPICS_BATCH_BLOCK))
  const pass: RssTopicPassBlock = { done: 0, failed: 0, error: null, providerDown: false, items: [], model: '' }
  pass.items = batches.map((batch, i) => ({ ticker: `batch-${i}`, label: `Sorting ${batch.length} articles into topics`, state: 'waiting' as const }))
  const mark = (i: number, s: PassItemStateBlock, detail?: string) => {
    pass.items = setPassItemBlock(pass.items, `batch-${i}`, s, detail)
    onProgress(pass.done + pass.failed, batches.length, pass.items)
  }
  onProgress(0, batches.length, pass.items)
  for (const [i, batch] of batches.entries()) {
    mark(i, 'working')
    const current = readRssTopicsOrch()
    const result = await runContract(feedTopicsContract, {
      batchId: batch.map(item => item.id).join(','),
      topics: current.topics.map(t => ({ name: t.name, kind: t.kind })),
      articles: batch.map(item => ({
        title: item.title,
        story: item.aiSummary?.storyKey ?? '',
        point: (item.aiSummary?.text.split('\n').find(Boolean) ?? '').replace(/^-\s*/, ''),
      })),
    }, { provider, scope: 'feed' })
    if (result.ok && result.value) {
      // runContract types the value from the schema (a string); finalize made it this
      const answers = result.value as unknown as FeedTopicsOutputBlock
      state = mergeRssTopicsBlock(readRssTopicsOrch(), batch, answers)
      await saveRssTopicsBlock()
      notifyBlock()
      pass.done += 1
      pass.model = result.model
      mark(i, 'fetched', `${answers.length} of ${batch.length} sorted`)
    } else {
      pass.failed += 1
      pass.error = result.ok ? 'The model gave no usable topics.' : result.error.message
      mark(i, 'failed', pass.error ?? undefined)
      if (!result.ok && providerDownBlock(result.error.message)) { pass.providerDown = true; break }
      // A batch the model cannot sort is set aside for the day, so it is not asked again and again
      state = { ...readRssTopicsOrch(), skipped: [...readRssTopicsOrch().skipped, ...batch.map(item => item.id)] }
      await saveRssTopicsBlock()
    }
  }
  return pass
}

/** Write the key details of topics that need them, the biggest first. */
export async function runRssTopicCardPassOrch(
  items: RssFeedItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch()
  const byId = new Map(items.map(item => [item.id, item]))
  const work = rssTopicsNeedingCardBlock(readRssTopicsOrch(), feedTopicCardContract.promptVersion).slice(0, CARDS_PER_PASS)
  const pass: RssTopicPassBlock = { done: 0, failed: 0, error: null, providerDown: false, items: [], model: '' }
  pass.items = work.map(t => ({ ticker: t.id, label: `Topic: ${t.name}`, state: 'waiting' as const }))
  const mark = (id: string, s: PassItemStateBlock, detail?: string) => {
    pass.items = setPassItemBlock(pass.items, id, s, detail)
    onProgress(pass.done + pass.failed, work.length, pass.items)
  }
  onProgress(0, work.length, pass.items)
  for (const topic of work) {
    mark(topic.id, 'working')
    const members = topic.members.map(id => byId.get(id)).filter((x): x is RssFeedItemBlock => Boolean(x))
    const result = await runContract(feedTopicCardContract, {
      topicId: `${topic.id}|${topic.members.join(',')}`,
      name: topic.name,
      kind: topic.kind,
      articles: members.slice(0, FEED_TOPIC_CARD_MAX_ARTICLES_BLOCK).map(item => ({
        title: item.title,
        text: (item.aiSummary?.text.replace(/\n/g, ' ') ?? plainArticleTextBlock(item.description ?? '')).slice(0, FEED_TOPIC_CARD_TEXT_CHARS_BLOCK),
      })),
    }, { provider, scope: 'feed' })
    // Written or not, the topic is settled for these members: a failure is not asked again until one joins
    const detail = result.ok && result.value ? (result.value as unknown as string) : null
    state = {
      ...readRssTopicsOrch(),
      topics: readRssTopicsOrch().topics.map(t => (t.id === topic.id
        ? { ...t, detail: detail ?? t.detail, detailMembers: [...topic.members], detailVersion: feedTopicCardContract.promptVersion }
        : t)),
    }
    await saveRssTopicsBlock()
    notifyBlock()
    if (detail && result.ok) {
      pass.done += 1
      pass.model = result.model
      mark(topic.id, 'fetched', `${members.length} articles`)
    } else {
      pass.failed += 1
      pass.error = result.ok ? 'The model gave no usable key details.' : result.error.message
      mark(topic.id, 'failed', pass.error ?? undefined)
      if (!result.ok && providerDownBlock(result.error.message)) { pass.providerDown = true; break }
    }
  }
  return pass
}
