// Today's feed by topic: what is happening, not who published it. The AI sorts
// each article it has read into a topic it names (feedTopicsContract), reusing
// the day's topics where one fits, then writes each topic's key details once it
// has two articles or more (feedTopicCardContract). One day at a time: a new
// day starts empty.

import type { RssFeedItemBlock } from './rssFeedBlock'
import type { FeedTopicKindBlock, FeedTopicsOutputBlock } from './intelligence/contracts/feedTopicsContractBlock'
import { FEED_OTHER_THEME_BLOCK, type FeedTopicThemesOutputBlock } from './intelligence/contracts/feedTopicThemesContractBlock'

export interface RssTopicBlock {
  id: string
  name: string
  kind: FeedTopicKindBlock
  /** Item ids, in the order they joined */
  members: string[]
  /** Key details, once written */
  detail: string | null
  /** The members the detail was written from */
  detailMembers: string[]
  detailVersion: number
  /** The broader theme it is part of ("Intel", "Q3 earnings"), once placed: a
   *  normalized label across story-sized topics. Subjects only; mood has its own strip. */
  theme?: string | null
  themeVersion?: number
}

export interface RssTopicsDayBlock {
  /** YYYY-MM-DD, local */
  day: string
  topics: RssTopicBlock[]
  /** Items the model was asked about and left out: not asked again today */
  skipped: string[]
}

export const emptyRssTopicsDayBlock = (day: string): RssTopicsDayBlock => ({ day, topics: [], skipped: [] })

export function localDayBlock(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Today's articles the AI has read, newest first: the ones a topic can hold. */
export function rssTopicItemsBlock(items: RssFeedItemBlock[], day: string): RssFeedItemBlock[] {
  const seen = new Set<string>()
  return items
    .filter((item) => {
      if (seen.has(item.id) || !item.aiSummary || !item.pubDate) return false
      const t = new Date(item.pubDate)
      if (Number.isNaN(t.getTime()) || localDayBlock(t) !== day) return false
      seen.add(item.id)
      return true
    })
    .sort((a, b) => Date.parse(b.pubDate ?? '') - Date.parse(a.pubDate ?? ''))
}

/** Of today's read articles, the ones no topic holds yet. */
export function rssTopicsUnsortedBlock(state: RssTopicsDayBlock, items: RssFeedItemBlock[]): RssFeedItemBlock[] {
  const placed = new Set([...state.topics.flatMap(t => t.members), ...state.skipped])
  return items.filter(item => !placed.has(item.id))
}

const nameKeyBlock = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Put a batch's answers into the day's topics: same name (any case), same topic. */
export function mergeRssTopicsBlock(state: RssTopicsDayBlock, batch: RssFeedItemBlock[], answers: FeedTopicsOutputBlock): RssTopicsDayBlock {
  const topics = state.topics.map(t => ({ ...t, members: [...t.members] }))
  const byName = new Map(topics.map(t => [nameKeyBlock(t.name), t]))
  const answered = new Set<string>()
  for (const { n, kind, name } of answers) {
    const item = batch[n - 1]
    if (!item || answered.has(item.id)) continue
    answered.add(item.id)
    const key = nameKeyBlock(name)
    let topic = byName.get(key)
    if (!topic) {
      topic = { id: `${kind}-${key.replace(/ /g, '-')}`, name, kind, members: [], detail: null, detailMembers: [], detailVersion: 0 }
      topics.push(topic)
      byName.set(key, topic)
    }
    if (!topic.members.includes(item.id)) topic.members.push(item.id)
  }
  const skipped = [...state.skipped, ...batch.filter(item => !answered.has(item.id)).map(item => item.id)]
  return { ...state, topics, skipped }
}

/** Topics of two articles or more whose key details are missing, out of date, or missing an article. */
export function rssTopicsNeedingCardBlock(state: RssTopicsDayBlock, version: number): RssTopicBlock[] {
  return state.topics
    .filter(t => t.members.length >= 2 && (t.detailVersion < version || t.members.some(id => !t.detailMembers.includes(id))))
    .sort((a, b) => b.members.length - a.members.length)
}

/** The day's topics as the page shows them: mood first, then the most articles first. */
export function rssTopicsShownBlock(state: RssTopicsDayBlock, items: RssFeedItemBlock[]): Array<{ topic: RssTopicBlock; items: RssFeedItemBlock[] }> {
  const byId = new Map(items.map(item => [item.id, item]))
  return state.topics
    .map(topic => ({ topic, items: topic.members.map(id => byId.get(id)).filter((x): x is RssFeedItemBlock => Boolean(x)) }))
    .filter(entry => entry.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length || a.topic.name.localeCompare(b.topic.name))
}

/** Subject topics not yet under a theme, or placed by an older prompt; the biggest first. */
export function rssTopicsNeedingThemeBlock(state: RssTopicsDayBlock, version: number): RssTopicBlock[] {
  return state.topics
    .filter(t => t.kind !== 'mood' && (!t.theme || (t.themeVersion ?? 0) < version))
    .sort((a, b) => b.members.length - a.members.length)
}

/** The day's theme names so far, the most used first: what the next batch reuses. */
export function rssThemeNamesBlock(state: RssTopicsDayBlock): string[] {
  const counts = new Map<string, number>()
  for (const t of state.topics) if (t.theme) counts.set(t.theme, (counts.get(t.theme) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

/** Put a batch's themes on its topics. A theme named like one already used (any case) takes that spelling. */
export function mergeRssThemesBlock(state: RssTopicsDayBlock, batch: RssTopicBlock[], answers: FeedTopicThemesOutputBlock, version: number, known: string[] = []): RssTopicsDayBlock {
  const spelling = new Map([...known, ...rssThemeNamesBlock(state)].map(name => [nameKeyBlock(name), name]))
  const themeById = new Map<string, string>()
  for (const { n, theme } of answers) {
    const topic = batch[n - 1]
    if (!topic) continue
    const key = nameKeyBlock(theme)
    const name = spelling.get(key) ?? theme
    spelling.set(key, name)
    themeById.set(topic.id, name)
  }
  // A topic the model left out goes under Other news, so it is not asked about again and again
  for (const topic of batch) if (!themeById.has(topic.id)) themeById.set(topic.id, FEED_OTHER_THEME_BLOCK)
  return {
    ...state,
    topics: state.topics.map(t => (themeById.has(t.id) ? { ...t, theme: themeById.get(t.id) ?? null, themeVersion: version } : t)),
  }
}
