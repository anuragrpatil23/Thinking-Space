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
  read: boolean
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
  // Newest first; undated items sink to the bottom rather than to the top.
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
