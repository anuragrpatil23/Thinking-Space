import { normalizeTagListBlock } from '@/services/lego_blocks/units/tagBlock'
export interface RssFeedConfigBlock {
  id: string
  url: string
  title: string
  groupId?: string | null
}

export interface RssFeedGroupBlock {
  id: string
  name: string
  parentGroupId: string | null
}

export interface RssFeedPreferencesBlock {
  schemaVersion: number
  feeds: RssFeedConfigBlock[]
  groups: RssFeedGroupBlock[]
  presetTags: string[]
  tagColors: Record<string, string>
}

export interface RssFeedGroupTreeNodeBlock {
  group: RssFeedGroupBlock | null
  feeds: RssFeedConfigBlock[]
  children: RssFeedGroupTreeNodeBlock[]
}

export interface RssFeedItemBlock {
  id: string
  feedId: string
  title: string
  link: string
  description: string
  pubDate: string | null
  /** Lead image for the article, when the feed offers one. Absolute URL, or
   *  null when the feed is text-only — the card falls back to the source mark. */
  imageUrl: string | null
  read: boolean
  /** Automatic, meaningful exposure in the timeline. This is a durable fact,
   * not a guess made from whether the article was opened. */
  viewedAt: string | null
  /** Explicit "I'm done with this" action. `read` is derived from either
   * viewedAt or dismissedAt so existing list surfaces remain simple. */
  dismissedAt: string | null
  tags: string[]
  keep: boolean
  important: boolean
}

export interface RssFeedResultBlock {
  feedId: string
  feedTitle: string
  items: RssFeedItemBlock[]
  error: string | null
}

/** Deterministic hue per source, so a feed keeps one identity across every
 *  surface — the timeline row, the reels backdrop and the monogram agree. */
export function rssSourceHueBlock(feedTitle: string): number {
  let hash = 0
  for (let index = 0; index < feedTitle.length; index++) {
    hash = (hash * 31 + feedTitle.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % 360
}

/** How the feed panel is rendering its articles.
 *  - `compact`  — dense explorer tree, the desktop default.
 *  - `timeline` — spacious scrolling cards.
 *  - `reels`    — full-viewport one-article deck (phone only).
 */
export type RssViewModeBlock = 'compact' | 'timeline' | 'reels'

/** Next mode for the single cycling toggle. `reels` is skipped where the
 *  surface cannot give a card the whole viewport, so the button never lands on
 *  a mode that would not render. */
export function nextRssViewModeBlock(
  current: RssViewModeBlock,
  reelsAvailable: boolean,
): RssViewModeBlock {
  if (current === 'compact') return 'timeline'
  if (current === 'timeline') return reelsAvailable ? 'reels' : 'compact'
  return 'compact'
}

export function generateFeedIdBlock(): string {
  return `feed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function generateGroupIdBlock(): string {
  return `rss-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeRssFeedPreferencesBlock(raw: unknown): RssFeedPreferencesBlock {
  if (Array.isArray(raw)) {
    // Legacy: plain array of feed configs
    return {
      schemaVersion: 1,
      feeds: raw.filter(isValidFeedConfig),
      groups: [],
      presetTags: [],
      tagColors: {},
    }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    return {
      schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      feeds: Array.isArray(obj.feeds) ? obj.feeds.filter(isValidFeedConfig) : [],
      groups: Array.isArray(obj.groups) ? obj.groups.filter(isValidGroup) : [],
      presetTags: Array.isArray(obj.presetTags)
        ? obj.presetTags.filter((t): t is string => typeof t === 'string')
        : [],
      tagColors: obj.tagColors && typeof obj.tagColors === 'object'
        ? obj.tagColors as Record<string, string>
        : {},
    }
  }
  return { schemaVersion: 1, feeds: [], groups: [], presetTags: [], tagColors: {} }
}

function isValidFeedConfig(item: unknown): item is RssFeedConfigBlock {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as RssFeedConfigBlock).id === 'string' &&
    typeof (item as RssFeedConfigBlock).url === 'string' &&
    typeof (item as RssFeedConfigBlock).title === 'string'
  )
}

function isValidGroup(item: unknown): item is RssFeedGroupBlock {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as RssFeedGroupBlock).id === 'string' &&
    typeof (item as RssFeedGroupBlock).name === 'string'
  )
}

export function buildFeedGroupTreeBlock(
  groups: RssFeedGroupBlock[],
  feeds: RssFeedConfigBlock[],
): RssFeedGroupTreeNodeBlock[] {
  const groupMap = new Map<string, RssFeedGroupBlock>(groups.map(g => [g.id, g]))

  // Build child → parent mapping
  const childGroupsByParent = new Map<string | null, RssFeedGroupBlock[]>()
  for (const group of groups) {
    const parentId = group.parentGroupId
    const list = childGroupsByParent.get(parentId) ?? []
    list.push(group)
    childGroupsByParent.set(parentId, list)
  }

  // Build feeds by group
  const feedsByGroup = new Map<string | null, RssFeedConfigBlock[]>()
  for (const feed of feeds) {
    const gid = feed.groupId && groupMap.has(feed.groupId) ? feed.groupId : null
    const list = feedsByGroup.get(gid) ?? []
    list.push(feed)
    feedsByGroup.set(gid, list)
  }

  function buildNode(group: RssFeedGroupBlock | null): RssFeedGroupTreeNodeBlock {
    const gid = group?.id ?? null
    return {
      group,
      feeds: feedsByGroup.get(gid) ?? [],
      children: (childGroupsByParent.get(gid) ?? []).map(child => buildNode(child)),
    }
  }

  // Root level: ungrouped feeds + root-level groups
  const rootFeeds = feedsByGroup.get(null) ?? []
  const rootGroups = childGroupsByParent.get(null) ?? []
  const rootChildren = rootGroups.map(g => buildNode(g))

  // If there are root-level feeds, wrap them in a single root node
  if (rootFeeds.length > 0 || rootChildren.length > 0) {
    return [{ group: null, feeds: rootFeeds, children: rootChildren }]
  }
  return []
}

/** Synthetic feed id for the merged "All Unread" inbox section. Real feed ids
 *  come from `generateFeedIdBlock`, so this can never collide with one. */
export const RSS_UNREAD_INBOX_ID_BLOCK = '__unread_inbox__'

export interface RssUnreadInboxEntryBlock {
  item: RssFeedItemBlock
  /** Source feed name, shown per-row because the inbox merges across feeds. */
  feedTitle: string
}

/**
 * Build the merged "All Unread" inbox: every unread article across every feed,
 * newest first.
 *
 * `sessionReadIds` is what keeps the list usable. Opening an article marks it
 * read, and if the inbox dropped it immediately every row below would jump up
 * one while the user is reading. So items read during this session stay in
 * place (the row renders dimmed) until the next feed refresh rebuilds the list.
 */
/** What decides membership of the reels deck.
 *  - `all`    — every article for the days in view. A stack you traverse.
 *  - `unread` — only what was unread when it entered. A pile that drains.
 *
 *  These are different objects, not two views of one. Conflating them is what
 *  produced a denominator that was neither: "unread, plus whatever I have read
 *  since I opened this", which drifts under the reader and means nothing.
 */
/** What one settle of the reels deck means: which span (if any) was read on
 *  the way, and where the traversal cursor now sits.
 *
 *  Extracted because this is where read-marking was getting it wrong. The rule
 *  is traversal, not a high-water mark: only forward movement reads, and only
 *  the span actually crossed. A jump re-bases instead, or navigating the
 *  calendar forward would mark every article it flew over.
 */
export interface RssTraversalStepBlock {
  /** Half-open [from, to) of indices passed over. Empty when nothing was read. */
  commitFrom: number
  commitTo: number
  nextCursor: number
}

export function rssTraversalStepBlock(
  cursor: number,
  landed: number,
  navigating: boolean,
): RssTraversalStepBlock {
  if (navigating) return { commitFrom: 0, commitTo: 0, nextCursor: landed }
  if (landed <= cursor) return { commitFrom: 0, commitTo: 0, nextCursor: landed }
  return { commitFrom: cursor, commitTo: landed, nextCursor: landed }
}

/**
 * Reconcile two stored copies of the same article.
 *
 * iCloud sync produces conflict copies ("abc 2.md") holding an older snapshot
 * of the same `id`. The loader keyed a map by that id, so whichever copy
 * happened to resolve last won — nondeterministically, in parallel batches.
 * A stale copy could therefore resurrect an article as unread hours after it
 * was read, which is exactly the "some articles will not stay marked" symptom.
 *
 * Read state is treated as monotonic: once an article has been read somewhere,
 * that wins. Two offline devices cannot be ordered without a clock we do not
 * keep, and of the two possible mistakes — an article that will not stay read,
 * or one that will not come back — the first is what makes the queue
 * untrustworthy. `keep`/`important`/tags merge the same direction: set wins,
 * because those are deliberate marks and losing one is worse than keeping it.
 */
export function mergeStoredRssItemsBlock(
  a: RssFeedItemBlock,
  b: RssFeedItemBlock,
): RssFeedItemBlock {
  const viewedAt = a.viewedAt ?? b.viewedAt
  const dismissedAt = a.dismissedAt ?? b.dismissedAt
  const tags = normalizeTagListBlock([...(a.tags ?? []), ...(b.tags ?? [])])
  // Prefer whichever copy actually carries content — a conflict copy written
  // before a backfill can be missing the image or carry a shorter body.
  return {
    ...a,
    title: a.title || b.title,
    link: a.link || b.link,
    description: a.description.length >= b.description.length ? a.description : b.description,
    pubDate: a.pubDate ?? b.pubDate,
    imageUrl: a.imageUrl ?? b.imageUrl,
    viewedAt,
    dismissedAt,
    read: Boolean(viewedAt || dismissedAt) || a.read || b.read,
    tags,
    keep: a.keep || b.keep,
    important: a.important || b.important,
  }
}

/** One day cell in the reels calendar. `total` is the day's stack size and
 *  `unread` what is left in it — a day with `total === 0` has nothing to jump
 *  to and is rendered inert. */
export interface RssCalendarCellBlock {
  key: string
  day: number
  unread: number
  total: number
}

/** Lay a month out as weeks of seven, Sunday first, padding the leading and
 *  trailing gaps with nulls so the grid stays rectangular. Counts are looked up
 *  per day rather than computed here, so the calendar and the date bar always
 *  read from one source. */
export function buildRssCalendarWeeksBlock(
  year: number,
  monthIndex: number,
  counts: Map<string, { unread: number; total: number }>,
): (RssCalendarCellBlock | null)[][] {
  const first = new Date(year, monthIndex, 1)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const weeks: (RssCalendarCellBlock | null)[][] = []
  let week: (RssCalendarCellBlock | null)[] = Array.from({ length: first.getDay() }, () => null)

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`
    const bucket = counts.get(key) ?? { unread: 0, total: 0 }
    week.push({ key, day, unread: bucket.unread, total: bucket.total })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }
  return weeks
}

export function rssMonthLabelBlock(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Month a day key belongs to, for opening the calendar where the reader is. */
export function rssMonthOfDayKeyBlock(key: string, fallback: Date = new Date()): { year: number; monthIndex: number } {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return { year: fallback.getFullYear(), monthIndex: fallback.getMonth() }
  return { year, monthIndex: month - 1 }
}

/** Calendar-date label for a day key, e.g. "Aug 21" (with the year once the
 *  day is outside the current one). Distinct from the timeline's relative
 *  label: "Friday" or "Yesterday" is useless for navigating a deep backlog,
 *  where every stack the reader jumps to is some weekday or other. */
export function rssDayDateLabelBlock(key: string, now: Date = new Date()): string {
  if (key === '__undated__') return 'No date'
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return 'No date'
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export type RssDeckFilterBlock = 'all' | 'unread'

/** Every article across every feed, newest first — the stable ordering the
 *  deck traverses. Membership is decided by the caller's admission set, not by
 *  a live predicate, so a card never vanishes because it was just read. */
export function buildRssDeckEntriesBlock(feeds: RssFeedResultBlock[]): RssUnreadInboxEntryBlock[] {
  const entries: RssUnreadInboxEntryBlock[] = []
  for (const feed of feeds) {
    for (const item of feed.items) entries.push({ item, feedTitle: feed.feedTitle })
  }
  return sortRssEntriesByRecencyBlock(entries)
}

/** Unread and total per day, over whatever the deck currently holds. Both
 *  numbers come from the same list, so `unread <= total` always holds and the
 *  pair can be shown as one fraction without lying. */
export function rssDeckDayCountsBlock(
  entries: RssUnreadInboxEntryBlock[],
): Map<string, { unread: number; total: number }> {
  const counts = new Map<string, { unread: number; total: number }>()
  for (const entry of entries) {
    const key = rssItemDayKeyBlock(entry.item.pubDate) ?? '__undated__'
    const bucket = counts.get(key) ?? { unread: 0, total: 0 }
    bucket.total++
    if (!entry.item.read) bucket.unread++
    counts.set(key, bucket)
  }
  return counts
}

/** Newest first; undated items sink to the bottom rather than to the top. */
function sortRssEntriesByRecencyBlock(entries: RssUnreadInboxEntryBlock[]): RssUnreadInboxEntryBlock[] {
  return entries.sort((a, b) => {
    const aTime = a.item.pubDate ? new Date(a.item.pubDate).getTime() : NaN
    const bTime = b.item.pubDate ? new Date(b.item.pubDate).getTime() : NaN
    const aValid = !Number.isNaN(aTime)
    const bValid = !Number.isNaN(bTime)
    if (!aValid && !bValid) return 0
    if (!aValid) return 1
    if (!bValid) return -1
    return bTime - aTime
  })
}

export function buildUnreadInboxItemsBlock(
  feeds: RssFeedResultBlock[],
  sessionReadIds: Set<string>,
): RssUnreadInboxEntryBlock[] {
  const entries: RssUnreadInboxEntryBlock[] = []
  for (const feed of feeds) {
    for (const item of feed.items) {
      if (item.read && !sessionReadIds.has(item.id)) continue
      entries.push({ item, feedTitle: feed.feedTitle })
    }
  }
  return sortRssEntriesByRecencyBlock(entries)
}

/** Next/prev state for the open article, published by the feed panel so the
 *  reader can walk the same queue the list is showing. */
export interface RssArticleNavStateBlock {
  /** 1-based position of the open article within the visible row list. */
  position: number
  total: number
  hasPrev: boolean
  hasNext: boolean
  goPrev: () => void
  goNext: () => void
}

/**
 * One rendered article row.
 *
 * `rowId` is section-scoped rather than just the item id, because the same
 * article shows up twice when the unread inbox and its own feed are both
 * expanded. Focus refs and arrow navigation key off `rowId` so the two copies
 * stay distinct; `itemId` is what actually gets opened.
 */
export interface RssVisibleRowBlock {
  rowId: string
  itemId: string
}

export function rssRowIdBlock(sectionId: string, itemId: string): string {
  return `${sectionId}::${itemId}`
}

/**
 * Flatten every article row the panel is currently painting into one ordered
 * list — the sequence arrow keys and the reader's next/prev both walk.
 *
 * This must stay in lockstep with how `RssFeedPanelBlock` renders: the unread
 * inbox comes first when present, then grouped mode walks the tree (a group
 * contributes its own feeds before recursing into child groups) while
 * flat/focused mode walks `feeds` directly. A feed contributes its items only
 * when it is expanded, and a group's whole subtree drops out when the group is
 * collapsed. Feeds with no fetched result are skipped, mirroring the
 * `if (!feed) return null` guard in the renderer.
 */
export function flattenVisibleRssRowsBlock(params: {
  unreadInbox: { expanded: boolean; itemIds: string[] } | null
  tree: RssFeedGroupTreeNodeBlock[] | null
  feeds: RssFeedResultBlock[]
  expandedFeedIds: Set<string>
  expandedGroupIds: Set<string>
}): RssVisibleRowBlock[] {
  const { unreadInbox, tree, feeds, expandedFeedIds, expandedGroupIds } = params
  const resultByFeedId = new Map(feeds.map(feed => [feed.feedId, feed]))
  const ordered: RssVisibleRowBlock[] = []

  if (unreadInbox?.expanded) {
    for (const itemId of unreadInbox.itemIds) {
      ordered.push({ rowId: rssRowIdBlock(RSS_UNREAD_INBOX_ID_BLOCK, itemId), itemId })
    }
  }

  const pushFeedItems = (feed: RssFeedResultBlock | undefined) => {
    if (!feed) return
    if (!expandedFeedIds.has(feed.feedId)) return
    for (const item of feed.items) {
      ordered.push({ rowId: rssRowIdBlock(feed.feedId, item.id), itemId: item.id })
    }
  }

  // Flat / focused mode: no group chrome, feeds render in array order.
  if (!tree) {
    for (const feed of feeds) pushFeedItems(feed)
    return ordered
  }

  const walk = (nodes: RssFeedGroupTreeNodeBlock[]) => {
    for (const node of nodes) {
      // The root node (group === null) has no header, so it is never collapsed.
      if (node.group && !expandedGroupIds.has(node.group.id)) continue
      for (const config of node.feeds) pushFeedItems(resultByFeedId.get(config.id))
      walk(node.children)
    }
  }
  walk(tree)
  return ordered
}

/**
 * Stable ID for an RSS item from its GUID or link hash.
 */
export function normalizeRssFeedItemIdBlock(
  feedId: string,
  guid: string | undefined,
  link: string | undefined,
  title: string | undefined,
): string {
  const raw = guid || link || title || ''
  return `${feedId}::${simpleHashBlock(raw)}`
}

export function mergeReadStateBlock(
  items: RssFeedItemBlock[],
  readIds: Set<string>,
): RssFeedItemBlock[] {
  return items.map(item => ({
    ...item,
    read: readIds.has(item.id),
  }))
}

function simpleHashBlock(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/** One measured timeline card: where its top and bottom edges sit relative to
 *  the viewport, in the same coordinate space as the scroller's own top edge. */
export interface RssTimelineCardRectBlock {
  itemId: string
  top: number
  bottom: number
}

/** Where the reader was, expressed as an article plus how far that article had
 *  already scrolled past the top edge. Anchoring to an article rather than a
 *  pixel offset is what survives the backlog hydrating in underneath. */
export interface RssTimelineAnchorBlock {
  itemId: string
  offset: number
}

/**
 * Pick the card the timeline should anchor its scroll position to: the
 * top-most one still touching the viewport.
 *
 * Cards whose bottom edge has passed the scroller's top edge are fully scrolled
 * away and can't anchor anything. Among the rest the smallest `top` wins, which
 * is normally the card straddling the top edge — so `offset` comes back
 * negative and restoring reproduces the partial scroll exactly rather than
 * snapping to a card boundary.
 *
 * Returns null when nothing is on screen (an empty or not-yet-rendered list).
 */
export function pickRssTimelineAnchorBlock(
  scrollerTop: number,
  cards: Iterable<RssTimelineCardRectBlock>,
): RssTimelineAnchorBlock | null {
  let best: RssTimelineAnchorBlock | null = null
  for (const card of cards) {
    if (card.bottom <= scrollerTop) continue
    const offset = card.top - scrollerTop
    if (best === null || offset < best.offset) best = { itemId: card.itemId, offset }
  }
  return best
}

/**
 * Union a batch of articles over the ones a feed already holds.
 *
 * A live fetch only returns the publisher's current window (a few dozen
 * articles), while the store also holds the hydrated retained backlog. Replacing
 * wholesale on every refresh would drop that backlog, making the list visibly
 * shrink and regrow — and clamping every scroller back to the top.
 *
 * `incomingWins` decides the collision rule: a live fetch result supersedes what
 * is on screen, whereas a page of retained cache must not clobber the live copy
 * or an optimistic update the reader just made.
 */
/** Take `incoming`'s content but keep whichever copy is further along on
 *  state. Same monotonic direction as the conflict-copy merge: a read that
 *  exists somewhere is kept, and deliberate marks are never dropped. */
export function preserveRssItemStateBlock(
  current: RssFeedItemBlock,
  incoming: RssFeedItemBlock,
): RssFeedItemBlock {
  const viewedAt = current.viewedAt ?? incoming.viewedAt
  const dismissedAt = current.dismissedAt ?? incoming.dismissedAt
  return {
    ...incoming,
    viewedAt,
    dismissedAt,
    read: Boolean(viewedAt || dismissedAt) || current.read || incoming.read,
    tags: normalizeTagListBlock([...(current.tags ?? []), ...(incoming.tags ?? [])]),
    keep: current.keep || incoming.keep,
    important: current.important || incoming.important,
  }
}

export function unionRssFeedItemsBlock(
  current: RssFeedItemBlock[],
  incoming: RssFeedItemBlock[],
  incomingWins: boolean,
): RssFeedItemBlock[] {
  const items = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    const existing = items.get(item.id)
    if (!incomingWins && existing) continue
    // A live fetch wins on CONTENT but never on state. Its read markers are
    // hydrated from the vault, and the vault write that follows a read is
    // fire-and-forget — so a refresh landing before that write completes used
    // to overwrite an optimistic read with a stale unread, silently undoing
    // what the reader had just done. Returning to the app triggers exactly
    // such a refresh, which is why a mark could vanish on coming back.
    items.set(item.id, existing ? preserveRssItemStateBlock(existing, item) : item)
  }
  return [...items.values()].sort(
    (a, b) => new Date(b.pubDate ?? 0).getTime() - new Date(a.pubDate ?? 0).getTime(),
  )
}

/**
 * Apply an optimistic patch to specific articles across every feed.
 *
 * Feeds holding no matching article are returned by reference, and the whole
 * array is returned unchanged when nothing matched. React leans on that
 * identity: marking one article read must not re-render every other feed's rows.
 */
/**
 * Does this article's stored read state disagree with `read`?
 *
 * Reels treats read state as ONE fact across all three fields. The timeline
 * keeps them apart on purpose — it distinguishes a glance (`viewedAt`) from a
 * decision (`dismissedAt`) because its own signal is a dwell guess. Reels needs
 * no such distinction: a card owns the screen, so the swipe IS the decision.
 *
 * Checking all three rather than one is what keeps the lanes uncontaminated. An
 * article the timeline glanced carries `viewedAt` alone; guards keyed on
 * `dismissedAt` treated that as "nothing to do" and skipped it forever, so a
 * half-written article could never be repaired. Comparing against the full
 * target state makes a write idempotent when it agrees and corrective when it
 * does not.
 */
export function rssReadStateNeedsWriteBlock(item: RssFeedItemBlock, read: boolean): boolean {
  return (
    item.read !== read
    || Boolean(item.viewedAt) !== read
    || Boolean(item.dismissedAt) !== read
  )
}

export function patchRssFeedItemsBlock(
  feeds: RssFeedResultBlock[],
  itemIds: Iterable<string>,
  patch: Partial<RssFeedItemBlock>,
): RssFeedResultBlock[] {
  const ids = new Set(itemIds)
  if (ids.size === 0) return feeds
  let changed = false
  const next = feeds.map(feed => {
    if (!feed.items.some(item => ids.has(item.id))) return feed
    changed = true
    return { ...feed, items: feed.items.map(item => (ids.has(item.id) ? { ...item, ...patch } : item)) }
  })
  return changed ? next : feeds
}

/**
 * Drop articles from every feed, preserving the identity of feeds that held
 * none of them (and of the array itself when nothing matched).
 */
export function dropRssFeedItemsBlock(
  feeds: RssFeedResultBlock[],
  itemIds: Iterable<string>,
): RssFeedResultBlock[] {
  const ids = new Set(itemIds)
  if (ids.size === 0) return feeds
  let changed = false
  const next = feeds.map(feed => {
    if (!feed.items.some(item => ids.has(item.id))) return feed
    changed = true
    return { ...feed, items: feed.items.filter(item => !ids.has(item.id)) }
  })
  return changed ? next : feeds
}

/** Image extensions we will trust from a feed enclosure. Feeds also attach
 *  audio and video (podcasts), and those must not end up in an `<img>`. */
const IMAGE_EXTENSION_RE_BLOCK = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i

function isLikelyImageUrlBlock(url: string, mimeType?: string): boolean {
  if (mimeType) return mimeType.startsWith('image/')
  return IMAGE_EXTENSION_RE_BLOCK.test(url)
}

/** Resolve a feed-relative image against the article link, and drop anything
 *  that isn't http(s) — `data:` and protocol-relative URLs from arbitrary
 *  publishers have no business being loaded by the renderer. */
function absoluteImageUrlBlock(candidate: string, articleLink: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed) return null
  try {
    const resolved = articleLink ? new URL(trimmed, articleLink) : new URL(trimmed)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}

/**
 * Pull a lead image out of a parsed feed entry.
 *
 * Feeds express this four incompatible ways, so all four are tried in order of
 * how much the publisher meant it: an explicit Media RSS thumbnail, a Media RSS
 * content object, an enclosure (shared with podcast audio, hence the type
 * check), and finally the first `<img>` in the HTML body. Returns null rather
 * than guessing — a wrong image is worse than none.
 */
export function extractRssItemImageBlock(entry: Record<string, unknown>, articleLink: string): string | null {
  const media = entry.media as Record<string, unknown> | undefined

  const fromMediaList = (value: unknown): string | null => {
    const list = Array.isArray(value) ? value : value ? [value] : []
    for (const candidate of list) {
      if (!candidate || typeof candidate !== 'object') continue
      const rec = candidate as Record<string, unknown>
      const url = typeof rec.url === 'string' ? rec.url : null
      if (!url) continue
      const type = typeof rec.type === 'string' ? rec.type : undefined
      const medium = typeof rec.medium === 'string' ? rec.medium : undefined
      if (medium && medium !== 'image') continue
      if (!isLikelyImageUrlBlock(url, type) && medium !== 'image') continue
      const resolved = absoluteImageUrlBlock(url, articleLink)
      if (resolved) return resolved
    }
    return null
  }

  const fromThumbnails = fromMediaList(media?.thumbnails ?? media?.thumbnail)
  if (fromThumbnails) return fromThumbnails

  const fromContents = fromMediaList(media?.contents ?? media?.content)
  if (fromContents) return fromContents

  const enclosures = Array.isArray(entry.enclosures)
    ? entry.enclosures
    : entry.enclosure ? [entry.enclosure] : []
  for (const enclosure of enclosures) {
    if (!enclosure || typeof enclosure !== 'object') continue
    const rec = enclosure as Record<string, unknown>
    const url = typeof rec.url === 'string' ? rec.url : null
    if (!url) continue
    const type = typeof rec.type === 'string' ? rec.type : undefined
    if (!isLikelyImageUrlBlock(url, type)) continue
    const resolved = absoluteImageUrlBlock(url, articleLink)
    if (resolved) return resolved
  }

  return null
}

/** Last resort: the first `<img src>` in an article's HTML body. Runs on the
 *  raw content before it is stripped to plain text. */
export function extractFirstHtmlImageBlock(html: string, articleLink: string): string | null {
  const match = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(html)
  if (!match) return null
  return absoluteImageUrlBlock(match[1], articleLink)
}

/** One day's worth of articles in the timeline, in list order. */
export interface RssTimelineDayGroupBlock {
  /** Local calendar day, `YYYY-MM-DD`. Stable key for scroll targets. */
  key: string
  label: string
  count: number
  /** Index of the day's first article in the full filtered list — what the
   *  rendered window has to reach before the day can be scrolled to. */
  firstIndex: number
}

/** Local calendar day for an article, or null when the feed gave no date. */
export function rssItemDayKeyBlock(pubDate: string | null): string | null {
  if (!pubDate) return null
  const date = new Date(pubDate)
  if (Number.isNaN(date.getTime())) return null
  // Local, not UTC: "which day did I see this" is a local-calendar question,
  // and a UTC key would split an evening's reading across two headers.
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayLabelBlock(key: string, now: Date): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/**
 * Collapse a date-sorted article list into day groups for headers and the
 * date jump.
 *
 * Assumes the input is already newest-first (the timeline's sort). Undated
 * articles sort to the end and collect under one trailing group rather than
 * being dropped — a feed with no dates would otherwise have no way to navigate.
 */
export function buildRssTimelineDayGroupsBlock(
  pubDates: (string | null)[],
  now: Date = new Date(),
): RssTimelineDayGroupBlock[] {
  const groups: RssTimelineDayGroupBlock[] = []
  for (let index = 0; index < pubDates.length; index++) {
    const key = rssItemDayKeyBlock(pubDates[index]) ?? '__undated__'
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.count++
      continue
    }
    groups.push({
      key,
      label: key === '__undated__' ? 'No date' : dayLabelBlock(key, now),
      count: 1,
      firstIndex: index,
    })
  }
  return groups
}
