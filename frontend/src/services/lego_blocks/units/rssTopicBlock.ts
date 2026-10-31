// Today's feed by topic: what is happening, not who published it. The AI sorts
// each article it has read into a topic it names (feedTopicsContract), reusing
// the day's topics where one fits, then writes each topic's key details once it
// has two articles or more (feedTopicCardContract). One day at a time: a new
// day starts empty.

import type { RssFeedItemBlock } from './rssFeedBlock'
import type { RssDayInboxBlock, RssStoryBlock, RssThemeDigestBlock } from './rssStoryBlock'
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
   *  normalized label across story-sized topics. A mood topic's theme is what
   *  moved ("Whole market", "Chips"). */
  theme?: string | null
  themeVersion?: number
}

export interface RssTopicsDayBlock {
  /** YYYY-MM-DD, local */
  day: string
  topics: RssTopicBlock[]
  /** Items the model was asked about and left out: not asked again today */
  skipped: string[]
  /**
   * Articles the AI read from sources outside the reading list, by item id:
   * where each one went. They never make topics; they cite one, add to a
   * theme's paragraph, or start an Elsewhere theme.
   */
  outside?: Record<string, RssOutsidePlaceBlock>
  /** The paragraph per theme from those articles, written at fixed times */
  notes?: RssThemeNoteBlock[]
}

export type RssOutsideKindBlock = 'topic' | 'theme' | 'elsewhere' | 'skip'

export interface RssOutsidePlaceBlock {
  kind: RssOutsideKindBlock
  /** The topic's name, or the theme's; '' for skip */
  name: string
  /** The outlet, as its feed is titled */
  source: string
  /** Only a headline and a teaser (paywalled): it cites, it does not go into a paragraph */
  headline: boolean
}

export interface RssThemeNoteBlock {
  theme: string
  /** A theme none of the reading list's topics have: shown under Elsewhere */
  elsewhere: boolean
  /** The paragraph; null when the articles add nothing beyond the reading list */
  text: string | null
  /** The articles it was written from */
  members: string[]
  /** The time slot it was written in (rssNoteSlotBlock) */
  slot: string
  version: number
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

/** Topics not yet under a theme, or placed by an older prompt; the biggest first. */
export function rssTopicsNeedingThemeBlock(state: RssTopicsDayBlock, version: number): RssTopicBlock[] {
  return state.topics
    .filter(t => !t.theme || (t.themeVersion ?? 0) < version)
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

/** Stories the AI has not sorted into a topic yet, when the list is grouped by theme. */
export const RSS_UNSORTED_THEME_BLOCK = 'Not sorted yet'

/**
 * The day inbox grouped by theme instead of by outlet: each day's stories go
 * under their topic's theme (a market theme reads "Market · Chips"), the
 * biggest first, Other news and stories not sorted yet last. A story takes the
 * theme of the first of its copies a topic holds. The groups stand where the
 * sources stood, keyed `theme:<name>`, so the list draws them the same way.
 */
export function regroupRssDayInboxByThemeBlock(days: RssDayInboxBlock[], topicsFor: (day: string) => RssTopicsDayBlock): RssDayInboxBlock[] {
  return days.map((day) => {
    const state = topicsFor(day.day)
    const themeOf = new Map<string, string>()
    const labelOf = (topic: RssTopicBlock) => (topic.kind === 'mood' ? `Market · ${topic.theme}` : (topic.theme as string))
    for (const topic of state.topics) {
      if (!topic.theme) continue
      for (const id of topic.members) if (!themeOf.has(id)) themeOf.set(id, labelOf(topic))
    }
    const groups = new Map<string, RssStoryBlock[]>()
    for (const source of day.sources) {
      for (const story of source.stories) {
        const label = [story.lead, ...story.others].map(m => themeOf.get(m.item.id)).find(Boolean) ?? RSS_UNSORTED_THEME_BLOCK
        groups.set(label, [...(groups.get(label) ?? []), story])
      }
    }
    const digests = rssThemeDigestsBlock(state)
    const last = (name: string) => (name === RSS_UNSORTED_THEME_BLOCK ? 3 : name === FEED_OTHER_THEME_BLOCK ? 2 : name.startsWith('Market · ') ? 0 : 1)
    const sources = [...groups.entries()]
      .sort((a, b) => last(a[0]) - last(b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, stories]) => ({ feedId: `theme:${name}`, feedTitle: name, stories, ...(digests.themes.get(name) ? { digest: digests.themes.get(name) } : {}) }))
    // Then what the other sources had that the reading list did not, by theme
    const elsewhere = [...digests.elsewhere.entries()]
      .sort((a, b) => b[1].sources.length - a[1].sources.length || a[0].localeCompare(b[0]))
      .map(([name, digest]) => ({ feedId: `elsewhere:${name}`, feedTitle: `Elsewhere · ${name}`, stories: [] as RssStoryBlock[], digest }))
    return { ...day, sources: [...sources, ...elsewhere] }
  })
}

/**
 * Each theme's digest from the articles outside the reading list, keyed the
 * way the list labels its themes, and the Elsewhere ones (themes the reading
 * list did not have) apart. An Elsewhere theme with no paragraph is left out:
 * a list of outlets on its own says nothing to read.
 */
export function rssThemeDigestsBlock(state: RssTopicsDayBlock): { themes: Map<string, RssThemeDigestBlock>; elsewhere: Map<string, RssThemeDigestBlock> } {
  const topicByName = new Map(state.topics.map(t => [t.name, t]))
  const labelOfTopic = (t: RssTopicBlock) => (t.theme ? (t.kind === 'mood' ? `Market · ${t.theme}` : t.theme) : null)
  const moodThemes = new Set(state.topics.filter(t => t.kind === 'mood' && t.theme).map(t => t.theme as string))
  const themes = new Map<string, RssThemeDigestBlock>()
  const elsewhere = new Map<string, RssThemeDigestBlock>()
  const entry = (map: Map<string, RssThemeDigestBlock>, key: string) => {
    let d = map.get(key)
    if (!d) { d = { note: null, cited: [], sources: [], itemIds: [] }; map.set(key, d) }
    return d
  }
  const addSource = (list: string[], source: string) => { if (!list.includes(source)) list.push(source) }
  for (const [id, place] of Object.entries(state.outside ?? {})) {
    if (place.kind === 'skip') continue
    if (place.kind === 'topic') {
      const topic = topicByName.get(place.name)
      const label = topic ? labelOfTopic(topic) : null
      if (!topic || !label) continue
      const d = entry(themes, label)
      d.itemIds.push(id)
      addSource(d.sources, place.source)
      let cite = d.cited.find(c => c.topic === topic.name)
      if (!cite) { cite = { topic: topic.name, sources: [] }; d.cited.push(cite) }
      addSource(cite.sources, place.source)
    } else {
      const d = place.kind === 'theme'
        ? entry(themes, moodThemes.has(place.name) ? `Market · ${place.name}` : place.name)
        : entry(elsewhere, place.name)
      d.itemIds.push(id)
      addSource(d.sources, place.source)
    }
  }
  for (const note of state.notes ?? []) {
    const key = note.elsewhere ? note.theme : (moodThemes.has(note.theme) ? `Market · ${note.theme}` : note.theme)
    const d = (note.elsewhere ? elsewhere : themes).get(key)
    if (d) d.note = note.text
  }
  for (const d of themes.values()) d.cited.sort((a, b) => b.sources.length - a.sources.length)
  for (const [name, d] of elsewhere) if (!d.note) elsewhere.delete(name)
  return { themes, elsewhere }
}

// -- Articles from outside the reading list ---------------------------------

/** The day's theme names the outside articles may go under: the reading list's, by kind. */
export function rssDayThemesBlock(state: RssTopicsDayBlock): string[] {
  return [...new Set(state.topics.map(t => t.theme).filter((t): t is string => Boolean(t)))]
}

/** Outside articles not placed yet. */
export function rssOutsideUnplacedBlock<T extends { item: { id: string } }>(state: RssTopicsDayBlock, items: T[]): T[] {
  const placed = state.outside ?? {}
  return items.filter(({ item }) => !placed[item.id])
}

/**
 * Put a batch's answers on its outside articles. A topic must be one of the
 * day's, a theme one of the day's (any case; the day's spelling wins); a theme
 * that is not becomes Elsewhere. Anything left out is skipped, so it is not
 * asked about again.
 */
export function mergeRssOutsideBlock(
  state: RssTopicsDayBlock,
  batch: Array<{ item: { id: string }; source: string; headline: boolean }>,
  answers: Array<{ n: number; kind: RssOutsideKindBlock; name: string }>,
): RssTopicsDayBlock {
  const topicByKey = new Map(state.topics.map(t => [nameKeyBlock(t.name), t.name]))
  const themeByKey = new Map(rssDayThemesBlock(state).map(t => [nameKeyBlock(t), t]))
  const outside = { ...(state.outside ?? {}) }
  const answered = new Map(answers.map(a => [a.n, a]))
  batch.forEach((entry, i) => {
    const a = answered.get(i + 1)
    const base = { source: entry.source, headline: entry.headline }
    if (!a || a.kind === 'skip' || !a.name.trim()) { outside[entry.item.id] = { ...base, kind: 'skip', name: '' }; return }
    const key = nameKeyBlock(a.name)
    if (a.kind === 'topic' && topicByKey.has(key)) { outside[entry.item.id] = { ...base, kind: 'topic', name: topicByKey.get(key) as string }; return }
    const theme = themeByKey.get(key)
    if (theme && a.kind !== 'elsewhere') { outside[entry.item.id] = { ...base, kind: 'theme', name: theme }; return }
    // A topic or theme the day does not have: what it is about, under Elsewhere
    outside[entry.item.id] = { ...base, kind: 'elsewhere', name: theme ?? a.name.trim() }
  })
  return { ...state, outside }
}

/** Paragraphs are written at these hours of the day, and a past day's once. */
export const RSS_NOTE_HOURS_BLOCK = [0, 9, 13, 18]

/** The time slot `now` falls in for `day`: its latest hour passed today, or final for a day that is over. */
export function rssNoteSlotBlock(day: string, now: Date): string {
  if (day < localDayBlock(now)) return 'final'
  const hour = [...RSS_NOTE_HOURS_BLOCK].reverse().find(h => now.getHours() >= h) ?? 0
  return String(hour)
}

export interface RssThemeNoteWorkBlock {
  theme: string
  elsewhere: boolean
  /** Outside articles with full text under this theme (a topic's theme, the theme itself, or Elsewhere) */
  members: string[]
}

/**
 * The paragraphs to write now: a theme whose outside articles (full text only)
 * changed since its paragraph, once per time slot. Topic citations count toward
 * the topic's theme, so the paragraph can say what else those outlets added.
 */
export function rssThemeNotesNeededBlock(state: RssTopicsDayBlock, slot: string, version: number): RssThemeNoteWorkBlock[] {
  const themeOfTopic = new Map(state.topics.map(t => [t.name, t.theme ?? null]))
  const groups = new Map<string, RssThemeNoteWorkBlock>()
  for (const [id, place] of Object.entries(state.outside ?? {})) {
    if (place.headline || place.kind === 'skip') continue
    const theme = place.kind === 'topic' ? themeOfTopic.get(place.name) : place.name
    if (!theme) continue
    const elsewhere = place.kind === 'elsewhere'
    const key = `${elsewhere ? 'e' : 't'}|${theme}`
    const group = groups.get(key) ?? { theme, elsewhere, members: [] }
    group.members.push(id)
    groups.set(key, group)
  }
  const notes = state.notes ?? []
  return [...groups.values()].filter((g) => {
    const note = notes.find(n => n.theme === g.theme && n.elsewhere === g.elsewhere)
    if (!note || note.version < version) return true
    if (note.slot === slot || note.slot === 'final') return false
    const had = new Set(note.members)
    return g.members.some(id => !had.has(id))
  }).sort((a, b) => b.members.length - a.members.length)
}

export function setRssThemeNoteBlock(state: RssTopicsDayBlock, note: RssThemeNoteBlock): RssTopicsDayBlock {
  const notes = (state.notes ?? []).filter(n => !(n.theme === note.theme && n.elsewhere === note.elsewhere))
  return { ...state, notes: [...notes, note] }
}

export interface RssOutsideCountBlock {
  articles: number
  outlets: number
  /** The outlets themselves, by name */
  outletNames: string[]
}

/**
 * How much the other sources carried, apart from the reading list: per topic
 * (the articles citing it) and per theme (its topics' citations and the
 * articles placed under it), headline-only articles included. Themes are keyed
 * as the list labels them, a market theme as "Market · Chips".
 */
export function rssOutsideCountsBlock(state: RssTopicsDayBlock): { byTheme: Map<string, RssOutsideCountBlock>; byTopic: Map<string, RssOutsideCountBlock> } {
  const { themes } = rssThemeDigestsBlock(state)
  const byTheme = new Map([...themes.entries()].map(([name, d]) => [name, { articles: d.itemIds.length, outlets: d.sources.length, outletNames: [...d.sources] }]))
  const topicSources = new Map<string, { articles: number; outlets: Set<string> }>()
  for (const place of Object.values(state.outside ?? {})) {
    if (place.kind !== 'topic') continue
    const t = topicSources.get(place.name) ?? { articles: 0, outlets: new Set<string>() }
    t.articles += 1
    t.outlets.add(place.source)
    topicSources.set(place.name, t)
  }
  const byTopic = new Map([...topicSources.entries()].map(([name, t]) => [name, { articles: t.articles, outlets: t.outlets.size, outletNames: [...t.outlets] }]))
  return { byTheme, byTopic }
}

/**
 * A headline's identity for spotting re-publications: lower case, letters and
 * digits only, its first 60. A wire piece updated through the day comes back
 * as a new article each time (a new link), often through several company
 * feeds, with the same headline or one trimmed differently at the end.
 */
export function rssHeadlineKeyBlock(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)
}

/** Articles with copies of one headline folded together: the latest of each, and how many there were; newest first. */
export function rssDistinctHeadlinesBlock<T extends { title: string; pubDate?: string | null }>(items: T[]): Array<{ item: T; copies: number }> {
  const byKey = new Map<string, { item: T; copies: number }>()
  for (const item of items) {
    const key = rssHeadlineKeyBlock(item.title) || String(byKey.size)
    const seen = byKey.get(key)
    if (!seen) byKey.set(key, { item, copies: 1 })
    else {
      seen.copies += 1
      if (Date.parse(item.pubDate ?? '') > Date.parse(seen.item.pubDate ?? '')) seen.item = item
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.item.pubDate ?? '') - Date.parse(a.item.pubDate ?? ''))
}
