// A day's feed by topic, kept in the vault (`.thinking-space/rss-topics/<day>.json`)
// so the phone shows what the desktop sorted. Derived: the topics are the
// model's sorting of the articles it has read that day; each day has its own.
// Today's are sorted as the AI reads; a past day's only when someone opens it
// (askRssTopicsForDayOrch). The sorting goes in batches, each told the day's
// topics so far so names hold steady; a topic's key details are written again
// when an article joins it or the prompt changes.

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

const TOPICS_DIR = '.thinking-space/rss-topics'
/** Before days had their own files, today's lived here; read once for today. */
const LEGACY_TOPICS_PATH = '.thinking-space/rss-topics.json'
/** Batches sorted, and topics carded, per job; the next job does the rest. */
const BATCHES_PER_PASS = 4
const CARDS_PER_PASS = 12

/** Each day's topics in memory; one object per day until they change, so React can compare. */
const states = new Map<string, RssTopicsDayBlock>()
const loading = new Map<string, Promise<void>>()
/** A past day someone has opened: its topics are sorted after today's. */
let askedDay: string | null = null
const listeners = new Set<() => void>()
const todayBlock = () => localDayBlock(new Date())

function notifyBlock(): void {
  for (const listener of listeners) listener()
}

export function subscribeRssTopicsOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A day's topics in memory (a new object whenever they change); today by default. */
export function readRssTopicsOrch(day: string = todayBlock()): RssTopicsDayBlock {
  let state = states.get(day)
  if (!state) {
    state = emptyRssTopicsDayBlock(day)
    states.set(day, state)
  }
  return state
}

function setTopicsBlock(next: RssTopicsDayBlock): void {
  states.set(next.day, next)
}

function parseTopicsBlock(text: string, day: string): RssTopicsDayBlock | null {
  const parsed = JSON.parse(text) as Partial<RssTopicsDayBlock>
  if (parsed.day !== day || !Array.isArray(parsed.topics)) return null
  return { day, topics: parsed.topics.filter(t => Array.isArray(t?.members) && typeof t.name === 'string'), skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [] }
}

/** Read a day's topics from the vault once per session; today by default. */
export function loadRssTopicsOrch(day: string = todayBlock()): Promise<void> {
  let pending = loading.get(day)
  if (!pending) {
    pending = (async () => {
      const fs = getVaultFS()
      let found: RssTopicsDayBlock | null = null
      try { found = parseTopicsBlock(await fs.read(`${TOPICS_DIR}/${day}.json`), day) } catch { /* none yet */ }
      if (!found && day === todayBlock()) {
        try { found = parseTopicsBlock(await fs.read(LEGACY_TOPICS_PATH), day) } catch { /* none */ }
      }
      if (found) {
        setTopicsBlock(found)
        notifyBlock()
      }
    })()
    loading.set(day, pending)
  }
  return pending
}

async function saveRssTopicsBlock(day: string): Promise<void> {
  const fs = getVaultFS()
  try { await fs.mkdir(TOPICS_DIR) } catch { /* there already */ }
  await fs.write(`${TOPICS_DIR}/${day}.json`, `${JSON.stringify({ version: 1, ...readRssTopicsOrch(day) }, null, 1)}\n`)
}

/** Sort a past day's news into topics, after today's: called when that day is opened. */
export function askRssTopicsForDayOrch(day: string | null): void {
  const next = day && day !== todayBlock() ? day : null
  if (next === askedDay) return
  askedDay = next
  notifyBlock()
}

/** The past day whose topics were asked for, if any. */
export function readAskedRssTopicsDayOrch(): string | null {
  return askedDay
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

/** Whether a day's read articles hold any no topic has yet, or a topic needs its key details. */
export function rssTopicsWorkOrch(items: RssFeedItemBlock[], day: string = todayBlock()): { unsorted: RssFeedItemBlock[]; cards: RssTopicBlock[] } {
  const state = readRssTopicsOrch(day)
  return { unsorted: rssTopicsUnsortedBlock(state, items), cards: rssTopicsNeedingCardBlock(state, feedTopicCardContract.promptVersion) }
}

/** Sort a day's unsorted articles into topics, a batch at a time. */
export async function runRssTopicSortPassOrch(
  items: RssFeedItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
  day: string = todayBlock(),
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch(day)
  const unsorted = rssTopicsUnsortedBlock(readRssTopicsOrch(day), items)
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
    const current = readRssTopicsOrch(day)
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
      setTopicsBlock(mergeRssTopicsBlock(readRssTopicsOrch(day), batch, answers))
      await saveRssTopicsBlock(day)
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
      setTopicsBlock({ ...readRssTopicsOrch(day), skipped: [...readRssTopicsOrch(day).skipped, ...batch.map(item => item.id)] })
      await saveRssTopicsBlock(day)
    }
  }
  return pass
}

/** Write the key details of topics that need them, the biggest first. */
export async function runRssTopicCardPassOrch(
  items: RssFeedItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
  day: string = todayBlock(),
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch(day)
  const byId = new Map(items.map(item => [item.id, item]))
  const work = rssTopicsNeedingCardBlock(readRssTopicsOrch(day), feedTopicCardContract.promptVersion).slice(0, CARDS_PER_PASS)
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
    setTopicsBlock({
      ...readRssTopicsOrch(day),
      topics: readRssTopicsOrch(day).topics.map(t => (t.id === topic.id
        ? { ...t, detail: detail ?? t.detail, detailMembers: [...topic.members], detailVersion: feedTopicCardContract.promptVersion }
        : t)),
    })
    await saveRssTopicsBlock(day)
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
