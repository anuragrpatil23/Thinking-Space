// The reading inbox by day: every article that reached the merged views,
// grouped by the day it was published, then by source, with one story shown
// once. The same news arrives from several outlets (and the same article
// through several feeds); it is shown under the source trusted most, and the
// rest are listed with it. Trust only chooses which copy stands for the story;
// nothing is hidden, so what the crowd is being told stays visible.
//
// Grouping is by headline: two headlines are the same story when they share at
// least two distinctive words and those words carry most of the weight of the
// shorter headline, within two days of each other. A word is distinctive by
// how rare it is across the articles in view (idf), so "Decart" ties stories
// together and "talks" does not. Once the AI has read an article it also has
// a story key ("Meta; shares fall after earnings"); keys are matched the same
// way, so outlets that word a headline differently still meet.
//
// "How many tell it" counts publishers, not feeds: the same outlet through two
// of its feeds (the Guardian's Business and Technology) is one voice.

import {
  rssArticleKeyBlock,
  rssItemReadableBlock,
  type RssFeedConfigBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from './rssFeedBlock'

export type RssTrustBlock = 'high' | 'normal' | 'low'

export function rssTrustBlock(feed: Pick<RssFeedConfigBlock, 'trust'> | undefined): RssTrustBlock {
  return feed?.trust ?? 'normal'
}

const TRUST_RANK_BLOCK: Record<RssTrustBlock, number> = { high: 0, normal: 1, low: 2 }

/** Two headlines this far apart in time are never the same story. */
const STORY_WINDOW_MS_BLOCK = 48 * 60 * 60 * 1000
/** Share of the shorter headline's weight that must be shared. */
export const STORY_MATCH_SHARE_BLOCK = 0.55
/** A word in more than this share of the articles carries no signal. */
const COMMON_WORD_SHARE_BLOCK = 0.02

const STOP_WORDS_BLOCK = new Set(`a an the and or but of to in on at for with from by as is are was were be been it its this that
these those how why what who when where will would can could should may might not no new says say said after before over
into about than more most just your you our their his her they them we he she i amid via report reports reported update
year years first last week today first could also back still now here there what's it's inc corp co ltd plc llc`.split(/\s+/))

export function storyWordsBlock(title: string): string[] {
  const words = (title || '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9$% ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS_BLOCK.has(w) && !/^\d{1,2}$/.test(w))
  return [...new Set(words)]
}

/** The outlet behind an article: its link's site (theguardian.com), else the feed. */
export function rssPublisherBlock(member: { item: Pick<RssFeedItemBlock, 'link'>; feedTitle: string }): string {
  const link = member.item.link ?? ''
  const cached = publisherByLinkBlock.get(link)
  if (cached) return cached
  try {
    const labels = new URL(link).hostname.toLowerCase().split('.').filter(Boolean)
    if (labels.length >= 2) {
      const secondLevel = labels.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(labels[labels.length - 2])
      const publisher = labels.slice(secondLevel ? -3 : -2).join('.')
      if (publisherByLinkBlock.size > 20_000) publisherByLinkBlock.clear()
      publisherByLinkBlock.set(link, publisher)
      return publisher
    }
  } catch { /* no usable link */ }
  return member.feedTitle.toLowerCase()
}

/** Every row asks; parsing a URL each time adds up over a few thousand articles. */
const publisherByLinkBlock = new Map<string, string>()

/** Each publisher once, with the name of the feed it came through (the lead's first). */
export function rssStoryPublishersBlock(story: Pick<RssStoryBlock, 'lead' | 'others'>): Array<{ publisher: string; name: string; member: RssStoryMemberBlock }> {
  const out = new Map<string, { publisher: string; name: string; member: RssStoryMemberBlock }>()
  for (const member of [story.lead, ...story.others]) {
    const publisher = rssPublisherBlock(member)
    const seen = out.get(publisher)
    // Within one publisher, stand on the copy the AI has read
    if (!seen) out.set(publisher, { publisher, name: member.feedTitle, member })
    else if (!seen.member.item.aiSummary && member.item.aiSummary) out.set(publisher, { ...seen, member })
  }
  return [...out.values()]
}

export interface RssStoryMemberBlock {
  item: RssFeedItemBlock
  feedId: string
  feedTitle: string
}

export interface RssStoryBlock {
  /** The copy shown: from the most trusted source */
  lead: RssStoryMemberBlock
  /** Every other copy, other outlets and the same article in other feeds */
  others: RssStoryMemberBlock[]
  /** A story is read once any copy of it is */
  read: boolean
}

function timeOfBlock(item: RssFeedItemBlock): number {
  const t = item.pubDate ? Date.parse(item.pubDate) : NaN
  return Number.isNaN(t) ? 0 : t
}

/** Join articles whose word lists share enough distinctive weight (see the top). Empty lists never join. */
function linkByWordsBlock(words: string[][], times: number[], union: (a: number, b: number) => void): void {
  const n = words.filter(ws => ws.length > 0).length
  if (n < 2) return
  const df = new Map<string, number>()
  for (const ws of words) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1)
  const commonAt = Math.max(3, Math.ceil(n * COMMON_WORD_SHARE_BLOCK))
  const weight = (w: string) => Math.log((n + 1) / (df.get(w) ?? 1))
  const totalWeight = words.map(ws => ws.reduce((s, w) => s + weight(w), 0))
  const index = new Map<string, number[]>()
  words.forEach((ws, i) => {
    for (const w of ws) {
      if ((df.get(w) ?? 0) > commonAt) continue
      const list = index.get(w)
      if (list) list.push(i)
      else index.set(w, [i])
    }
  })
  for (let i = 0; i < words.length; i += 1) {
    const seen = new Set<number>()
    for (const w of words[i]) {
      for (const j of index.get(w) ?? []) {
        if (j <= i || seen.has(j)) continue
        seen.add(j)
        if (times[i] && times[j] && Math.abs(times[i] - times[j]) > STORY_WINDOW_MS_BLOCK) continue
        const other = new Set(words[j])
        const shared = words[i].filter(x => other.has(x) && (df.get(x) ?? 0) <= commonAt)
        if (shared.length < 2) continue
        const sharedWeight = shared.reduce((s, x) => s + weight(x), 0)
        const smaller = Math.min(totalWeight[i], totalWeight[j])
        if (smaller > 0 && sharedWeight / smaller >= STORY_MATCH_SHARE_BLOCK) union(i, j)
      }
    }
  }
}

/**
 * Group articles into stories. Same article (by link) always groups; different
 * articles group by headline as described above.
 */
export function groupRssStoriesBlock(
  members: RssStoryMemberBlock[],
  trustByFeedId: Map<string, RssTrustBlock> = new Map(),
): RssStoryBlock[] {
  const parent = members.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  // The same article through several feeds
  const byKey = new Map<string, number>()
  members.forEach((m, i) => {
    const key = rssArticleKeyBlock(m.item)
    const first = byKey.get(key)
    if (first === undefined) byKey.set(key, i)
    else union(first, i)
  })

  // The same story from several outlets: by headline, then by the AI's story key
  const times = members.map(m => timeOfBlock(m.item))
  linkByWordsBlock(members.map(m => storyWordsBlock(m.item.title)), times, union)
  linkByWordsBlock(members.map(m => storyWordsBlock(m.item.aiSummary?.storyKey ?? '')), times, union)

  const groups = new Map<number, RssStoryMemberBlock[]>()
  members.forEach((m, i) => {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(m)
    else groups.set(root, [m])
  })

  // The lead: most trusted source, then readable in full, then the earliest
  const rank = (a: RssStoryMemberBlock, b: RssStoryMemberBlock) => {
    const trust = TRUST_RANK_BLOCK[trustByFeedId.get(a.feedId) ?? 'normal'] - TRUST_RANK_BLOCK[trustByFeedId.get(b.feedId) ?? 'normal']
    if (trust !== 0) return trust
    const readable = Number(rssItemReadableBlock(b.item)) - Number(rssItemReadableBlock(a.item))
    if (readable !== 0) return readable
    return timeOfBlock(a.item) - timeOfBlock(b.item)
  }
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort(rank)
    return { lead: sorted[0], others: sorted.slice(1), read: list.some(m => m.item.read) }
  })
}

/** Only the articles published in the last `days` days (undated ones dropped):
 *  grouping is the costly step, so views that show a few days group only those. */
export function recentRssFeedsBlock(feeds: RssFeedResultBlock[], days: number, now = Date.now()): RssFeedResultBlock[] {
  const since = now - days * 86_400_000
  return feeds.map(feed => ({ ...feed, items: feed.items.filter(item => timeOfBlock(item) >= since) }))
}

/** An outlet's name as its feed is titled, without the "Latest from" some feeds put first. */
export const rssOutletNameBlock = (title: string) => title.replace(/^Latest from\s+/i, '').trim()

/**
 * When the list is grouped by theme: what the AI read about it in sources
 * outside the reading list, read after the theme's own articles.
 */
export interface RssThemeDigestBlock {
  /** The theme's paragraph from those sources; null when not written, or nothing more */
  note: string | null
  /** The reading list's topics in this theme that other outlets also carried */
  cited: Array<{ topic: string; sources: string[] }>
  /** Every outlet the theme's outside articles came from */
  sources: string[]
  /** Those articles' item ids, headline-only ones included */
  itemIds: string[]
}

export interface RssDayInboxBlock {
  /** YYYY-MM-DD, local */
  day: string
  sources: Array<{ feedId: string; feedTitle: string; stories: RssStoryBlock[]; digest?: RssThemeDigestBlock }>
  storyCount: number
  unreadCount: number
}

function localDayBlock(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The inbox: days newest first; in each day the sources (most trusted first,
 * then by name), each with its stories newest first. A story sits on the day
 * and under the source of its lead.
 */
export function buildRssDayInboxBlock(params: {
  feeds: RssFeedResultBlock[]
  configs: RssFeedConfigBlock[]
  /** Only stories not yet read (read this session still count as unread, so the list holds still) */
  unreadOnly?: boolean
  sessionReadIds?: Set<string>
}): RssDayInboxBlock[] {
  const { feeds, configs, unreadOnly = false, sessionReadIds = new Set() } = params
  const trustByFeedId = new Map(configs.map(c => [c.id, rssTrustBlock(c)]))
  const members: RssStoryMemberBlock[] = feeds.flatMap(feed => feed.items.map(item => ({ item, feedId: feed.feedId, feedTitle: feed.feedTitle })))
  const stories = groupRssStoriesBlock(members, trustByFeedId)
    .filter(story => !unreadOnly || !story.read || [story.lead, ...story.others].some(m => sessionReadIds.has(m.item.id)))

  const days = new Map<string, Map<string, { feedId: string; feedTitle: string; stories: RssStoryBlock[] }>>()
  for (const story of stories) {
    const t = timeOfBlock(story.lead.item)
    const day = t ? localDayBlock(t) : 'undated'
    const sources = days.get(day) ?? new Map()
    days.set(day, sources)
    const source = sources.get(story.lead.feedId) ?? { feedId: story.lead.feedId, feedTitle: story.lead.feedTitle, stories: [] }
    sources.set(story.lead.feedId, source)
    source.stories.push(story)
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)))
    .map(([day, sources]) => {
      const list = [...sources.values()]
        .map(s => ({ ...s, stories: s.stories.sort((a, b) => timeOfBlock(b.lead.item) - timeOfBlock(a.lead.item)) }))
        .sort((a, b) => (TRUST_RANK_BLOCK[trustByFeedId.get(a.feedId) ?? 'normal'] - TRUST_RANK_BLOCK[trustByFeedId.get(b.feedId) ?? 'normal'])
          || a.feedTitle.localeCompare(b.feedTitle))
      const all = list.flatMap(s => s.stories)
      return { day, sources: list, storyCount: all.length, unreadCount: all.filter(s => !s.read).length }
    })
}

/** "Today", "Yesterday", "Wednesday, Oct 21", or with the year when not this year. */
export function rssDayLabelBlock(day: string, now = new Date()): string {
  if (day === 'undated') return 'Undated'
  const today = localDayBlock(now.getTime())
  const yesterday = localDayBlock(now.getTime() - 86_400_000)
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** "+2 sources" and their names, for the row: other publishers, not other feeds of the same one. */
export function rssStoryOthersLabelBlock(story: RssStoryBlock): { label: string; title: string } | null {
  const leadPublisher = rssPublisherBlock(story.lead)
  const names = rssStoryPublishersBlock(story).filter(p => p.publisher !== leadPublisher).map(p => p.name)
  if (names.length === 0) return null
  return { label: `+${names.length} ${names.length === 1 ? 'source' : 'sources'}`, title: names.join(', ') }
}

/**
 * Stories many are telling: from the newest two days of the inbox, the ones
 * at least two publishers carry, most publishers first (then the lead's
 * trust, then the newest). The Overview shows these and the AI writes their
 * story cards in this order.
 */
export function rssLoudStoriesBlock(
  days: RssDayInboxBlock[],
  configs: Array<Pick<RssFeedConfigBlock, 'id' | 'trust'>> = [],
): Array<{ story: RssStoryBlock; publishers: number }> {
  const trustByFeedId = new Map(configs.map(c => [c.id, rssTrustBlock(c)]))
  return days.filter(d => d.day !== 'undated').slice(0, 2)
    .flatMap(d => d.sources.flatMap(s => s.stories))
    .map(story => ({ story, publishers: rssStoryPublishersBlock(story).length }))
    .filter(entry => entry.publishers >= 2)
    .sort((a, b) => (b.publishers - a.publishers)
      || (TRUST_RANK_BLOCK[trustByFeedId.get(a.story.lead.feedId) ?? 'normal'] - TRUST_RANK_BLOCK[trustByFeedId.get(b.story.lead.feedId) ?? 'normal'])
      || (timeOfBlock(b.story.lead.item) - timeOfBlock(a.story.lead.item)))
}
