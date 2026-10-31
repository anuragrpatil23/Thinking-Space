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
import { rssItemReadableBlock, rssReaderFeedsBlock, type RssFeedItemBlock, type RssFeedPreferencesBlock, type RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { plainArticleTextBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import { FEED_TOPICS_BATCH_BLOCK, feedTopicsContract, type FeedTopicsOutputBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicsContractBlock'
import { FEED_TOPIC_CARD_MAX_ARTICLES_BLOCK, FEED_TOPIC_CARD_TEXT_CHARS_BLOCK, feedTopicCardContract } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicCardContractBlock'
import { FEED_TOPIC_THEMES_BATCH_BLOCK, feedTopicThemesContract, type FeedTopicThemesOutputBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicThemesContractBlock'
import { FEED_OUTSIDE_BATCH_BLOCK, feedOutsideMatchContract, type FeedOutsideMatchOutputBlock } from '@/services/lego_blocks/units/intelligence/contracts/feedOutsideMatchContractBlock'
import { FEED_THEME_NOTE_MAX_ARTICLES_BLOCK, FEED_THEME_NOTE_TEXT_CHARS_BLOCK, feedThemeNoteContract } from '@/services/lego_blocks/units/intelligence/contracts/feedThemeNoteContractBlock'
import { addToRssThemeListBlock, parseRssThemeListBlock, serializeRssThemeListBlock, sortRssThemeListBlock, type RssThemeListEntryBlock } from '@/services/lego_blocks/units/rssThemeListBlock'
import {
  emptyRssTopicsDayBlock,
  localDayBlock,
  mergeRssOutsideBlock,
  mergeRssThemesBlock,
  rssNoteSlotBlock,
  rssOutsideUnplacedBlock,
  rssThemeNotesNeededBlock,
  setRssThemeNoteBlock,
  mergeRssTopicsBlock,
  rssThemeNamesBlock,
  rssTopicsNeedingThemeBlock,
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
  return {
    day,
    topics: parsed.topics.filter(t => Array.isArray(t?.members) && typeof t.name === 'string'),
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    ...(parsed.outside && typeof parsed.outside === 'object' ? { outside: parsed.outside } : {}),
    ...(Array.isArray(parsed.notes) ? { notes: parsed.notes } : {}),
  }
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

/** An article the AI read from a source outside the reading list. */
export interface RssOutsideItemBlock {
  item: RssFeedItemBlock
  /** Its feed's title: the outlet it is cited as */
  source: string
  /** Only a headline and a teaser: it cites, it does not go into a paragraph */
  headline: boolean
}

/**
 * The AI-read articles of `day` from sources outside the reading list: the
 * sources kept out of it, and the headline-only articles of readable ones.
 */
export function rssOutsideItemsOrch(feeds: RssFeedResultBlock[], preferences: RssFeedPreferencesBlock | null, day: string): RssOutsideItemBlock[] {
  const listIds = new Set(rssReaderFeedsBlock(feeds, preferences).flatMap(feed => feed.items.map(item => item.id)))
  const out = new Map<string, RssOutsideItemBlock>()
  for (const feed of feeds) {
    for (const item of feed.items) {
      if (listIds.has(item.id) || out.has(item.id) || !item.aiSummary || !item.pubDate) continue
      const t = new Date(item.pubDate)
      if (Number.isNaN(t.getTime()) || localDayBlock(t) !== day) continue
      out.set(item.id, { item, source: feed.feedTitle, headline: !rssItemReadableBlock(item) })
    }
  }
  return [...out.values()]
}

/**
 * A day's work, in the order it is done: articles no topic has, topics with no
 * theme, outside articles not placed, topics needing key details, and theme
 * paragraphs due in this time slot.
 */
export function rssTopicsWorkOrch(items: RssFeedItemBlock[], day: string = todayBlock(), outsideItems: RssOutsideItemBlock[] = []): { unsorted: RssFeedItemBlock[]; themes: RssTopicBlock[]; outside: RssOutsideItemBlock[]; cards: RssTopicBlock[]; notes: number } {
  const state = readRssTopicsOrch(day)
  return {
    unsorted: rssTopicsUnsortedBlock(state, items),
    themes: rssTopicsNeedingThemeBlock(state, feedTopicThemesContract.promptVersion),
    // Placed only once the day has topics to place them against
    outside: state.topics.length > 0 ? rssOutsideUnplacedBlock(state, outsideItems) : [],
    cards: rssTopicsNeedingCardBlock(state, feedTopicCardContract.promptVersion),
    notes: rssThemeNotesNeededBlock(state, rssNoteSlotBlock(day, new Date()), feedThemeNoteContract.promptVersion).length,
  }
}

// The theme list (rssThemeListBlock) lives where the page that owns the Feed
// keeps its records — F9 puts it beside the day logs, `F9-execution/feed/themes.md`
// — and is given to the model each time. Without a place for it, each day's own
// themes are all that is reused. Derived: missing, it is rebuilt from the days.
let themeListPath: string | null = null
let themeList: RssThemeListEntryBlock[] | null = null

/** Where the theme list is kept (vault-relative), or null to keep none. */
export function setRssThemeListPathOrch(path: string | null): void {
  if (path === themeListPath) return
  themeListPath = path
  themeList = null
}

/** Themes offered per request, the most recently used first. */
const THEMES_OFFERED = 200

async function loadThemeListBlock(): Promise<RssThemeListEntryBlock[]> {
  if (!themeListPath) return []
  if (themeList) return themeList
  const fs = getVaultFS()
  let text: string | null = null
  try { text = await fs.read(themeListPath) } catch { /* none yet */ }
  if (text !== null) {
    themeList = parseRssThemeListBlock(text)
    return themeList
  }
  const listed = await fs.list(TOPICS_DIR).catch(() => ({ files: [] as string[] }))
  const days = listed.files.map(f => /(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter((d): d is string => Boolean(d)).sort()
  await Promise.all(days.map(d => loadRssTopicsOrch(d)))
  let rebuilt: RssThemeListEntryBlock[] = []
  for (const d of days) rebuilt = addToRssThemeListBlock(rebuilt, d, readRssTopicsOrch(d).topics)
  themeList = rebuilt
  if (rebuilt.length > 0) await saveThemeListBlock()
  return themeList
}

async function saveThemeListBlock(): Promise<void> {
  if (!themeListPath || !themeList) return
  await getVaultFS().write(themeListPath, serializeRssThemeListBlock(themeList))
}

/** Gather a day's topics under broader themes, the day's and the theme list's names reused. */
export async function runRssTopicThemePassOrch(
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
  day: string = todayBlock(),
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch(day)
  const earlier = sortRssThemeListBlock(await loadThemeListBlock()).slice(0, THEMES_OFFERED).map(t => t.name)
  const work = rssTopicsNeedingThemeBlock(readRssTopicsOrch(day), feedTopicThemesContract.promptVersion)
  const batches: RssTopicBlock[][] = []
  for (let i = 0; i < work.length; i += FEED_TOPIC_THEMES_BATCH_BLOCK) batches.push(work.slice(i, i + FEED_TOPIC_THEMES_BATCH_BLOCK))
  const pass: RssTopicPassBlock = { done: 0, failed: 0, error: null, providerDown: false, items: [], model: '' }
  pass.items = batches.map((batch, i) => ({ ticker: `themes-${i}`, label: `Gathering ${batch.length} topics under themes`, state: 'waiting' as const }))
  const mark = (i: number, s: PassItemStateBlock, detail?: string) => {
    pass.items = setPassItemBlock(pass.items, `themes-${i}`, s, detail)
    onProgress(pass.done + pass.failed, batches.length, pass.items)
  }
  onProgress(0, batches.length, pass.items)
  for (const [i, batch] of batches.entries()) {
    mark(i, 'working')
    const today = rssThemeNamesBlock(readRssTopicsOrch(day))
    const offered = [...new Set([...today, ...earlier])]
    const result = await runContract(feedTopicThemesContract, {
      batchId: batch.map(t => `${t.id}:${t.members.length}`).join(','),
      themes: offered,
      topics: batch.map(t => ({ name: t.name, articles: t.members.length, kind: t.kind })),
    }, { provider, scope: 'feed' })
    if (result.ok && result.value) {
      // runContract types the value from the schema (a string); finalize made it this
      const answers = result.value as unknown as FeedTopicThemesOutputBlock
      const placed = mergeRssThemesBlock(readRssTopicsOrch(day), batch, answers, feedTopicThemesContract.promptVersion, earlier)
      setTopicsBlock(placed)
      await saveRssTopicsBlock(day)
      // The list learns this batch's themes, counted once per topic placed
      if (themeList && themeListPath) {
        const ids = new Set(batch.map(t => t.id))
        themeList = addToRssThemeListBlock(themeList, day, placed.topics.filter(t => ids.has(t.id)))
        await saveThemeListBlock()
      }
      notifyBlock()
      pass.done += 1
      pass.model = result.model
      mark(i, 'fetched', `${answers.length} of ${batch.length} placed`)
    } else {
      pass.failed += 1
      pass.error = result.ok ? 'The model gave no usable themes.' : result.error.message
      mark(i, 'failed', pass.error ?? undefined)
      if (!result.ok && providerDownBlock(result.error.message)) { pass.providerDown = true; break }
      // A batch the model cannot place goes under Other news, so it is not asked again and again
      setTopicsBlock(mergeRssThemesBlock(readRssTopicsOrch(day), batch, [], feedTopicThemesContract.promptVersion, earlier))
      await saveRssTopicsBlock(day)
      notifyBlock()
    }
  }
  return pass
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

/** Batches of outside articles placed per job; the next job does the rest. */
const OUTSIDE_BATCHES_PER_PASS = 4

/** Place a day's outside articles against its topics and themes, a batch at a time. */
export async function runRssOutsidePassOrch(
  outsideItems: RssOutsideItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
  day: string = todayBlock(),
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch(day)
  const known = sortRssThemeListBlock(await loadThemeListBlock()).slice(0, THEMES_OFFERED).map(t => t.name)
  const work = rssOutsideUnplacedBlock(readRssTopicsOrch(day), outsideItems)
  const batches: RssOutsideItemBlock[][] = []
  for (let i = 0; i < work.length && batches.length < OUTSIDE_BATCHES_PER_PASS; i += FEED_OUTSIDE_BATCH_BLOCK) batches.push(work.slice(i, i + FEED_OUTSIDE_BATCH_BLOCK))
  const pass: RssTopicPassBlock = { done: 0, failed: 0, error: null, providerDown: false, items: [], model: '' }
  pass.items = batches.map((batch, i) => ({ ticker: `outside-${i}`, label: `Placing ${batch.length} articles from other sources`, state: 'waiting' as const }))
  const mark = (i: number, st: PassItemStateBlock, detail?: string) => {
    pass.items = setPassItemBlock(pass.items, `outside-${i}`, st, detail)
    onProgress(pass.done + pass.failed, batches.length, pass.items)
  }
  onProgress(0, batches.length, pass.items)
  for (const [i, batch] of batches.entries()) {
    mark(i, 'working')
    const state = readRssTopicsOrch(day)
    const result = await runContract(feedOutsideMatchContract, {
      batchId: batch.map(b => b.item.id).join(','),
      topics: state.topics.map(t => ({ name: t.name, theme: t.theme ?? null })),
      knownThemes: known,
      articles: batch.map(({ item }) => ({
        title: item.title,
        point: (item.aiSummary?.text.split('\n').find(Boolean) ?? '').replace(/^-\s*/, ''),
      })),
    }, { provider, scope: 'feed' })
    if (result.ok && result.value) {
      // runContract types the value from the schema (a string); finalize made it this
      const answers = result.value as unknown as FeedOutsideMatchOutputBlock
      setTopicsBlock(mergeRssOutsideBlock(readRssTopicsOrch(day), batch, answers))
      pass.done += 1
      pass.model = result.model
      mark(i, 'fetched', `${answers.length} of ${batch.length} placed`)
    } else {
      pass.failed += 1
      pass.error = result.ok ? 'The model gave no usable places.' : result.error.message
      mark(i, 'failed', pass.error ?? undefined)
      if (!result.ok && providerDownBlock(result.error.message)) { pass.providerDown = true; break }
      // A batch the model cannot place is skipped, so it is not asked again and again
      setTopicsBlock(mergeRssOutsideBlock(readRssTopicsOrch(day), batch, []))
    }
    await saveRssTopicsBlock(day)
    notifyBlock()
  }
  return pass
}

/**
 * Write the theme paragraphs due now: at most one per theme per time slot
 * (rssNoteSlotBlock), and only when its outside articles changed since.
 */
export async function runRssThemeNotePassOrch(
  outsideItems: RssOutsideItemBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number, items: PassItemBlock[]) => void,
  day: string = todayBlock(),
): Promise<RssTopicPassBlock> {
  await loadRssTopicsOrch(day)
  const slot = rssNoteSlotBlock(day, new Date())
  const byId = new Map(outsideItems.map(o => [o.item.id, o]))
  const work = rssThemeNotesNeededBlock(readRssTopicsOrch(day), slot, feedThemeNoteContract.promptVersion)
  const pass: RssTopicPassBlock = { done: 0, failed: 0, error: null, providerDown: false, items: [], model: '' }
  const key = (w: { theme: string; elsewhere: boolean }) => `${w.elsewhere ? 'elsewhere' : 'theme'}:${w.theme}`
  pass.items = work.map(w => ({ ticker: key(w), label: `${w.elsewhere ? 'Elsewhere' : 'Also in'}: ${w.theme}`, state: 'waiting' as const }))
  const mark = (id: string, st: PassItemStateBlock, detail?: string) => {
    pass.items = setPassItemBlock(pass.items, id, st, detail)
    onProgress(pass.done + pass.failed, work.length, pass.items)
  }
  onProgress(0, work.length, pass.items)
  for (const w of work) {
    mark(key(w), 'working')
    const state = readRssTopicsOrch(day)
    const articles = w.members.map(id => byId.get(id)).filter((x): x is RssOutsideItemBlock => Boolean(x)).slice(0, FEED_THEME_NOTE_MAX_ARTICLES_BLOCK)
    const result = await runContract(feedThemeNoteContract, {
      noteId: `${key(w)}|${w.members.join(',')}`,
      theme: w.theme,
      ownTopics: w.elsewhere ? [] : state.topics.filter(t => t.theme === w.theme).map(t => t.name),
      articles: articles.map(({ item, source }) => ({
        source: source.replace(/\s*[|:–—-]\s.*$/, '').replace(/^Latest from\s+/i, '').trim() || source,
        title: item.title,
        text: (item.aiSummary?.text.replace(/\n/g, ' ') ?? plainArticleTextBlock(item.description ?? '')).slice(0, FEED_THEME_NOTE_TEXT_CHARS_BLOCK),
      })),
    }, { provider, scope: 'feed' })
    // A provider that is down is not the theme's fault: try it again next run
    if (!result.ok && providerDownBlock(result.error.message)) {
      pass.failed += 1
      pass.error = result.error.message
      pass.providerDown = true
      mark(key(w), 'failed', pass.error)
      break
    }
    // Written or not, the theme is settled for this slot: a failure is not asked again until the next
    const text = result.ok && typeof result.value === 'string' && result.value ? (result.value as string) : null
    setTopicsBlock(setRssThemeNoteBlock(readRssTopicsOrch(day), { theme: w.theme, elsewhere: w.elsewhere, text, members: w.members, slot, version: feedThemeNoteContract.promptVersion }))
    await saveRssTopicsBlock(day)
    notifyBlock()
    if (result.ok) {
      pass.done += 1
      pass.model = result.model
      mark(key(w), 'fetched', text ? `${articles.length} articles` : 'nothing more')
    } else {
      pass.failed += 1
      pass.error = result.error.message
      mark(key(w), 'failed', pass.error)
    }
  }
  return pass
}
