import { createContext, memo, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderOpen,
  Loader2,
  ChevronsDownUp,
  ChevronsUpDown,
  Layers,
  List,
  RefreshCw,
  Rss,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { claimPageTopInsetBlock } from '@/services/lego_blocks/units/pageTopInsetBlock'
import { dispatchTopChromeAppearanceBlock } from '@/services/lego_blocks/units/topChromeAppearanceBlock'
import RssTimelineBlock from './RssTimelineBlock'
import RssReelsBlock from './RssReelsBlock'
import { useExpandedSetBlock } from '@/components/lego_blocks/hooks/shared/useExpandedSetBlock'
import SidebarGroupHeaderBlock from '@/components/lego_blocks/units/ui/SidebarGroupHeaderBlock'
import {
  forgetRssItemBlock,
  markAllRssItemsReadBlock,
  markRssItemViewedBlock,
  markRssItemsReadBlock,
  removeRssItemsBlock,
  replaceRssItemBlock,
  setRssItemsReadBlock,
  toggleRssItemSavedBlock,
  toggleRssItemTagBlock,
  unmarkRssItemReadBlock,
  useRssFeedsBlock,
} from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import {
  RSS_UNREAD_INBOX_ID_BLOCK,
  buildFeedGroupTreeBlock,
  buildUnreadInboxItemsBlock,
  collapseDuplicateRssEntriesBlock,
  rssAlsoInLabelBlock,
  rssItemReadableBlock,
  rssReaderFeedsBlock,
  flattenVisibleRssRowsBlock,
  rssRowIdBlock,
  type RssArticleNavStateBlock,
  type RssFeedGroupTreeNodeBlock,
  nextRssViewModeBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
  type RssViewModeBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import {
  tagColorClassBlock,
  tagColorStyleBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import { cn } from '@/lib/utils'
import RssItemAnnotationMarksBlock from '@/components/lego_blocks/units/RssItemAnnotationMarksBlock'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'
import { localDayBlock, regroupRssDayInboxByThemeBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import { loadRssTopicsOrch, readRssTopicsOrch, subscribeRssTopicsOrch } from '@/services/orchestrators/rssTopicOrch'
import {
  buildRssDayInboxBlock,
  rssDayLabelBlock,
  rssStoryOthersLabelBlock,
  type RssDayInboxBlock,
  rssOutletNameBlock,
  type RssThemeDigestBlock,
} from '@/services/lego_blocks/units/rssStoryBlock'

// F9's Feed draws the list in its native look: quiet header, no RSS or folder
// icons, plain counts, a failing source as a red dot instead of an error row.
const NativeListContextBlock = createContext(false)

interface RssFeedPanelBlockProps {
  /** 'native': F9's look (see NativeListContextBlock). */
  appearance?: 'default' | 'native'
  onOpenArticle: (
    item: RssFeedItemBlock,
    onItemUpdate: (updated: RssFeedItemBlock) => void,
    onItemRemove: () => void,
    presetTags: string[],
    tagColors: Record<string, string>,
  ) => void
  onClose: () => void
  /** Emits whenever the open article or the surrounding queue changes; null
   *  when no article is open. */
  onNavStateChange?: (nav: RssArticleNavStateBlock | null) => void
  /** True while the reader is showing an article. The panel then stops claiming
   *  ↑/↓, because in that mode those keys scroll the article body — only the
   *  owner of the reader knows when it closed, so this can't be derived here. */
  articleOpen?: boolean
  className?: string
  /** Native: only the articles that arrived on this day (YYYY-MM-DD, local). */
  day?: string | null
  /**
   * Native: an article opened from elsewhere (the Overview's topics). The list
   * groups by theme, opens its day and its group, marks it, and scrolls to it.
   * A new `nonce` asks again for the same article.
   */
  focus?: { itemId: string; nonce: number } | null
  /**
   * Native, by theme: a theme's digest from the other sources opens beside the
   * list like an article (the caller draws it). Without this the digest shows
   * as a box under the theme's articles.
   */
  onOpenDigest?: (entry: RssThemeDigestEntryBlock) => void
  /** The digest open beside the list, to mark its row */
  activeDigestKey?: string | null
}

/** A theme's digest as opened from the list: its key, the label the list shows, the digest. */
export interface RssThemeDigestEntryBlock {
  key: string
  theme: string
  digest: RssThemeDigestBlock
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ''
    const now = Date.now()
    const diffMs = now - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 30) return `${diffDays}d`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

/** Absolute publish date + time for the row body, e.g. "Mar 5, 2:30 PM" (year
 *  added only when it isn't the current year). The corner still shows the terse
 *  relative age; this line is the exact timestamp the user asked to see. */
function formatAbsoluteDateTime(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ''
    const includeYear = date.getFullYear() !== new Date().getFullYear()
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function RssFeedPanelBlock({
  onOpenArticle,
  onClose,
  onNavStateChange,
  articleOpen,
  className,
  appearance = 'default',
  day = null,
  focus = null,
  onOpenDigest,
  activeDigestKey = null,
}: RssFeedPanelBlockProps) {
  const native = appearance === 'native'
  const { layout } = useUILayoutBlock()
  // This is intentionally device-local: iPhone gets the spacious timeline by
  // default without changing a desktop user's compact explorer preference.
  const [viewMode, setViewMode] = useState<RssViewModeBlock>(() => {
    try {
      const saved = localStorage.getItem('ltm-rss-view-mode')
      if (saved === 'compact' || saved === 'timeline' || saved === 'reels') return saved
    } catch { /* storage is optional */ }
    return layout.surface === 'capacitor-ios' ? 'timeline' : 'compact'
  })
  // Reels is a full-viewport deck, so it only makes sense where the viewport is
  // the whole screen. On desktop the toggle skips it rather than offering a
  // mode that would render one article inside a sidebar.
  const reelsAvailable = layout.surface === 'capacitor-ios'
  const routeActive = useRouteActivityBlock()
  // Feed data, read state and every article mutation live in one module-level
  // store shared by every RSS surface — see useRssFeedsBlock.
  const {
    feeds: allFeeds, preferences, loading, refreshing, loadingFeedIds, sessionReadIds,
    hasFeedsConfigured, refresh,
  } = useRssFeedsBlock()
  // Native (F9): the list splits like a mail app's Focused / Other — Readable
  // (the app can show the article in full) and Other (teasers behind a paywall,
  // dead links). Every view and count follows the tab. Remembered on this device.
  const [readableTab, setReadableTab] = useState<'readable' | 'other'>(() => {
    try { return localStorage.getItem('ltm-rss-readable-tab') === 'other' ? 'other' : 'readable' } catch { return 'readable' }
  })
  const chooseReadableTab = useCallback((tab: 'readable' | 'other') => {
    setReadableTab(tab)
    try { localStorage.setItem('ltm-rss-readable-tab', tab) } catch { /* storage is optional */ }
  }, [])
  // Native: "Unread" keeps the folders and sources but shows only unread
  // articles (sources with none drop out). Articles read this session stay
  // until the next refresh, so the list does not shift while reading.
  const [unreadOnly, setUnreadOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('ltm-rss-unread-only') === '1' } catch { return false }
  })
  const toggleUnreadOnly = useCallback(() => {
    setUnreadOnly((prev) => {
      try { localStorage.setItem('ltm-rss-unread-only', prev ? '0' : '1') } catch { /* storage is optional */ }
      return !prev
    })
  }, [])
  const feeds = useMemo(() => {
    if (!native) return allFeeds
    const narrowed = allFeeds.map(feed => ({
      ...feed,
      items: feed.items.filter(item => rssItemReadableBlock(item) === (readableTab === 'readable')
        && (!unreadOnly || !item.read || sessionReadIds.has(item.id))
        && (!day || (Boolean(item.pubDate) && localDayBlock(new Date(item.pubDate as string)) === day))),
    }))
    return unreadOnly || day ? narrowed.filter(feed => feed.items.length > 0) : narrowed
  }, [allFeeds, native, readableTab, unreadOnly, sessionReadIds, day])
  // Feeds/groups are collapsed by default; only those explicitly expanded are in these sets.
  // Persisted in localStorage so the state survives navigation.
  const { expanded: expandedFeedIds, toggle: toggleFeedExpanded, setAll: setExpandedFeeds } = useExpandedSetBlock('ltm-rss-expanded-feeds')
  const { expanded: expandedGroupIds, toggle: toggleGroupExpanded, setAll: setExpandedGroups } = useExpandedSetBlock('ltm-rss-expanded-groups')
  const [focusedFeedId, setFocusedFeedId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  // Delete-preview mode
  const [deleteMode, setDeleteMode] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  // Row buttons keyed by rowId, so arrow keys can move DOM focus between them.
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  // Row of the article currently open in the reader — anchors its next/prev.
  const [activeRowId, setActiveRowId] = useState<string | null>(null)

  // Memoised so `handleItemClick` keeps a stable identity — it is passed to
  // every article row, and a fresh `[]` each render re-rendered the whole list.
  const presetTags = useMemo(() => preferences?.presetTags ?? [], [preferences])
  const tagColors = useMemo(() => preferences?.tagColors ?? {}, [preferences])

  const groupTree = useMemo<RssFeedGroupTreeNodeBlock[]>(() => {
    if (!preferences) return []
    return buildFeedGroupTreeBlock(preferences.groups, preferences.feeds)
  }, [preferences])

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    toggleGroupExpanded(groupId)
  }, [toggleGroupExpanded])

  // The other copies of each story shown in the day inbox, by the lead's id:
  // reading the lead marks them read too, so the story does not come back.
  const storyOthersRef = useRef(new Map<string, RssFeedItemBlock[]>())
  const replaceWithStoryBlock = useCallback((updated: RssFeedItemBlock) => {
    replaceRssItemBlock(updated)
    const others = storyOthersRef.current.get(updated.id)
    if (updated.read && others?.some(other => !other.read)) setRssItemsReadBlock(others.filter(other => !other.read), true)
  }, [])

  const handleItemClick = useCallback((item: RssFeedItemBlock, rowId: string) => {
    if (deleteMode) {
      // Toggle selection in delete-preview mode
      setPendingDeleteIds(prev => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      return
    }
    setSelectedItemId(item.id)
    setActiveRowId(rowId)
    if (!item.link) return
    // Opening deliberately does NOT mark read — arrow keys open articles as you
    // move, so "opened" no longer means "read". The reader reports actual
    // engagement (scrolling or dwelling) back through onItemUpdate below.
    onOpenArticle(
      item,
      replaceWithStoryBlock,
      () => {
        forgetRssItemBlock(item.id)
        setSelectedItemId(null)
        setActiveRowId(null)
      },
      presetTags,
      tagColors,
    )
  }, [deleteMode, onOpenArticle, presetTags, tagColors, replaceWithStoryBlock])

  const setTimelineViewMode = useCallback((next: RssViewModeBlock) => {
    setViewMode(next)
    try { localStorage.setItem('ltm-rss-view-mode', next) } catch { /* optional */ }
  }, [])

  // Cycles compact -> timeline -> reels -> compact, so one button reaches every
  // mode on a phone where there is no room for a segmented control.
  const cycleViewMode = useCallback(() => {
    setTimelineViewMode(nextRssViewModeBlock(viewMode, reelsAvailable))
  }, [viewMode, reelsAvailable, setTimelineViewMode])

  useEffect(() => {
    if (viewMode === 'reels' && !reelsAvailable) setViewMode('timeline')
  }, [viewMode, reelsAvailable])

  // First click: enter delete-preview mode, select all eligible items
  const handleEnterDeleteMode = useCallback((feedId?: string) => {
    const eligible = feeds
      .filter(f => !feedId || f.feedId === feedId)
      .flatMap(f => f.items.filter(i =>
        i.read && !i.important && !i.keep && (!i.tags || i.tags.length === 0),
      ))
    if (eligible.length === 0) return
    setPendingDeleteIds(new Set(eligible.map(i => i.id)))
    setDeleteMode(true)
  }, [feeds])

  // Second click: commit the deletion
  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteIds.size === 0) {
      setDeleteMode(false)
      return
    }
    removeRssItemsBlock([...pendingDeleteIds])
    setDeleteMode(false)
    setPendingDeleteIds(new Set())
  }, [pendingDeleteIds])

  const handleCancelDeleteMode = useCallback(() => {
    setDeleteMode(false)
    setPendingDeleteIds(new Set())
  }, [])

  const toggleCollapsed = useCallback((feedId: string) => {
    toggleFeedExpanded(feedId)
  }, [toggleFeedExpanded])

  const visibleFeeds = useMemo(() => {
    if (!focusedFeedId) return feeds
    return feeds.filter(f => f.feedId === focusedFeedId)
  }, [feeds, focusedFeedId])

  // Feeds in groups marked excludeFromAllUnread stay in their own group but
  // are left out of every merged view (inbox, timeline, reels) and the header
  // count.
  // Other is where the teasers go that "Only readable" keeps out of the main list
  const inboxFeeds = useMemo(
    () => rssReaderFeedsBlock(feeds, preferences, { keepTeasers: native && readableTab === 'other' }),
    [feeds, preferences, native, readableTab],
  )

  // Native: the list is an inbox by day across every source (the merged-view
  // rules apply), sources inside each day, one row per story. Days fold;
  // folded days are remembered on this device.
  const dayMode = native && !focusedFeedId
  // Native: show only some sources, across every day. Remembered on this device.
  const [sourceFilter, setSourceFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ltm-rss-source-filter') ?? '[]') as string[] } catch { return [] }
  })
  const chooseSourceFilter = useCallback((next: string[]) => {
    setSourceFilter(next)
    try { localStorage.setItem('ltm-rss-source-filter', JSON.stringify(next)) } catch { /* storage is optional */ }
  }, [])
  const filteredInboxFeeds = useMemo(() => {
    const chosen = new Set(sourceFilter)
    return chosen.size > 0 && inboxFeeds.some(feed => chosen.has(feed.feedId)) ? inboxFeeds.filter(feed => chosen.has(feed.feedId)) : inboxFeeds
  }, [inboxFeeds, sourceFilter])
  // Grouping every day's stories is the costly step; deferred so a backlog
  // still streaming in never holds up scrolling or the keyboard.
  const deferredInboxFeeds = useDeferredValue(filteredInboxFeeds)
  // Remembered across visits, keyed on the store snapshot and the filters that
  // shape it, so returning to the list does not regroup every story
  const sourceInbox = useMemo<RssDayInboxBlock[]>(
    () => (dayMode
      // The day is a key too: without it, picking another day kept the last day's list
      ? identityMemoBlock('rss-day-inbox', [allFeeds, preferences, readableTab, unreadOnly, sessionReadIds, sourceFilter.join(','), day ?? '', deferredInboxFeeds === filteredInboxFeeds], () =>
        buildRssDayInboxBlock({ feeds: deferredInboxFeeds, configs: preferences?.feeds ?? [], unreadOnly, sessionReadIds }))
      : []),
    [dayMode, deferredInboxFeeds, filteredInboxFeeds, allFeeds, preferences, readableTab, unreadOnly, sessionReadIds, sourceFilter, day],
  )
  // Native: each day by source (as it arrived) or by theme (as the AI sorted
  // it: the Overview's themes). Remembered on this device.
  const [groupBy, setGroupBy] = useState<'sources' | 'themes'>(() => {
    try { return localStorage.getItem('ltm-rss-group-by') === 'themes' ? 'themes' : 'sources' } catch { return 'sources' }
  })
  const toggleGroupBy = useCallback(() => {
    setGroupBy((prev) => {
      const next = prev === 'themes' ? 'sources' : 'themes'
      try { localStorage.setItem('ltm-rss-group-by', next) } catch { /* storage is optional */ }
      return next
    })
  }, [])
  const byTheme = dayMode && groupBy === 'themes'
  // The days' topics, read from the vault once each; a sorting pass redraws the list
  const [topicsTick, setTopicsTick] = useState(0)
  useEffect(() => (byTheme ? subscribeRssTopicsOrch(() => setTopicsTick(t => t + 1)) : undefined), [byTheme])
  const inboxDaysKey = sourceInbox.map(d => d.day).join(',')
  useEffect(() => {
    if (!byTheme) return
    for (const d of inboxDaysKey.split(',')) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) void loadRssTopicsOrch(d)
  }, [byTheme, inboxDaysKey])
  const dayInbox = useMemo<RssDayInboxBlock[]>(
    () => (byTheme ? regroupRssDayInboxByThemeBlock(sourceInbox, d => readRssTopicsOrch(d)) : sourceInbox),
    [byTheme, sourceInbox, topicsTick],  // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Each day's whole count, whatever Unread hides: the filter chooses the rows,
  // not the day's size. Grouped once per feed snapshot (only with Unread on).
  const dayTotals = useMemo(() => {
    if (!dayMode || !unreadOnly) return null
    return identityMemoBlock('rss-day-totals', [allFeeds, preferences, readableTab, sourceFilter.join(',')], () => {
      const tabFeeds = allFeeds.map(feed => ({ ...feed, items: feed.items.filter(item => rssItemReadableBlock(item) === (readableTab === 'readable')) }))
      let base = rssReaderFeedsBlock(tabFeeds, preferences, { keepTeasers: readableTab === 'other' })
      const chosen = new Set(sourceFilter)
      if (chosen.size > 0 && base.some(feed => chosen.has(feed.feedId))) base = base.filter(feed => chosen.has(feed.feedId))
      return new Map(buildRssDayInboxBlock({ feeds: base, configs: preferences?.feeds ?? [] }).map(day => [day.day, { stories: day.storyCount, unread: day.unreadCount }]))
    })
  }, [dayMode, unreadOnly, allFeeds, preferences, readableTab, sourceFilter])
  const { expanded: foldedSources, toggle: toggleSourceFolded } = useExpandedSetBlock('ltm-rss-folded-sources')
  useEffect(() => {
    const map = new Map<string, RssFeedItemBlock[]>()
    for (const day of dayInbox) for (const source of day.sources) for (const story of source.stories) {
      if (story.others.length > 0) map.set(story.lead.item.id, story.others.map(other => other.item))
    }
    storyOthersRef.current = map
  }, [dayInbox])
  const { expanded: foldedDays, toggle: toggleDayFolded } = useExpandedSetBlock('ltm-rss-folded-days')

  // Counted per article, not per copy, so the number agrees with the inbox.
  const totalUnread = useMemo(
    () => collapseDuplicateRssEntriesBlock(
      inboxFeeds.flatMap(f => f.items.map(item => ({ item, feedTitle: f.feedTitle }))),
    ).filter(entry => !entry.item.read).length,
    [inboxFeeds],
  )

  // ---------------------------------------------------------------------
  // Merged "All Unread" inbox
  // ---------------------------------------------------------------------

  const unreadInboxEntries = useMemo(
    () => buildUnreadInboxItemsBlock(inboxFeeds, sessionReadIds),
    [inboxFeeds, sessionReadIds],
  )
  const unreadInboxExpanded = expandedFeedIds.has(RSS_UNREAD_INBOX_ID_BLOCK)
  // The inbox merges every source, so it only makes sense in the all-feeds view.
  const showUnreadInbox = !focusedFeedId && !deleteMode && unreadInboxEntries.length > 0

  // ---------------------------------------------------------------------
  // Row navigation — arrow keys in the panel, next/prev in the reader
  // ---------------------------------------------------------------------

  // Mirrors the two rendering branches below: grouped tree vs. flat/focused list.
  const useGroupedRendering = Boolean(preferences && preferences.groups.length > 0 && !focusedFeedId)

  // One button opens every folder and source, or closes them all
  const anythingExpanded = expandedFeedIds.size > 0 || expandedGroupIds.size > 0
  const toggleExpandAll = useCallback(() => {
    if (anythingExpanded) {
      setExpandedFeeds([])
      setExpandedGroups([])
    } else {
      setExpandedFeeds(feeds.map(feed => feed.feedId))
      setExpandedGroups((preferences?.groups ?? []).map(group => group.id))
    }
  }, [anythingExpanded, feeds, preferences, setExpandedFeeds, setExpandedGroups])

  const visibleRows = useMemo(() => (dayMode
    ? dayInbox.filter(day => !foldedDays.has(day.day)).flatMap(day => day.sources.filter(source => !foldedSources.has(`${day.day}|${source.feedId}`)).flatMap(source => source.stories.map(story => ({
      rowId: rssRowIdBlock(`day:${day.day}`, story.lead.item.id),
      itemId: story.lead.item.id,
    }))))
    : flattenVisibleRssRowsBlock({
    // Native lists filter by Unread instead of offering the merged row
    unreadInbox: showUnreadInbox && !native
      ? { expanded: unreadInboxExpanded, itemIds: unreadInboxEntries.map(entry => entry.item.id) }
      : null,
    tree: useGroupedRendering ? groupTree : null,
    feeds: useGroupedRendering ? feeds : visibleFeeds,
    expandedFeedIds,
    expandedGroupIds,
  })), [
    native, showUnreadInbox, unreadInboxExpanded, unreadInboxEntries,
    useGroupedRendering, groupTree, feeds, visibleFeeds, expandedFeedIds, expandedGroupIds,
    dayMode, dayInbox, foldedDays, foldedSources,
  ])

  // An article opened from the Overview: by theme, its day and group open, marked and in view
  const pendingFocusRef = useRef<{ itemId: string; nonce: number } | null>(null)
  useEffect(() => {
    if (!focus || !dayMode) return
    pendingFocusRef.current = focus
    if (groupBy !== 'themes') {
      setGroupBy('themes')
      try { localStorage.setItem('ltm-rss-group-by', 'themes') } catch { /* storage is optional */ }
    }
  }, [focus?.nonce, dayMode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending || !byTheme) return
    for (const d of dayInbox) {
      for (const source of d.sources) {
        const story = source.stories.find(st => [st.lead, ...st.others].some(m => m.item.id === pending.itemId))
        if (!story) continue
        pendingFocusRef.current = null
        if (foldedDays.has(d.day)) toggleDayFolded(d.day)
        const key = `${d.day}|${source.feedId}`
        if (foldedSources.has(key)) toggleSourceFolded(key)
        const rowId = rssRowIdBlock(`day:${d.day}`, story.lead.item.id)
        setSelectedItemId(story.lead.item.id)
        setActiveRowId(rowId)
        // After the unfolded rows are drawn
        requestAnimationFrame(() => requestAnimationFrame(() => itemButtonRefs.current.get(rowId)?.scrollIntoView({ block: 'center' })))
        return
      }
    }
  }, [dayInbox, byTheme, foldedDays, foldedSources, toggleDayFolded, toggleSourceFolded])

  const registerItemButton = useCallback((rowId: string, node: HTMLButtonElement | null) => {
    if (node) itemButtonRefs.current.set(rowId, node)
    else itemButtonRefs.current.delete(rowId)
  }, [])

  const itemsById = useMemo(() => {
    const map = new Map<string, RssFeedItemBlock>()
    for (const feed of feeds) for (const item of feed.items) map.set(item.id, item)
    return map
  }, [feeds])

  /** Step `delta` rows from `fromRowId`. Always moves focus + the selection
   *  cursor; only opens the article when asked, so panel arrow keys stay a
   *  browse gesture while the reader's next/prev actually swaps the article. */
  const stepToRow = useCallback((fromRowId: string, delta: number, openArticle: boolean) => {
    const currentIndex = visibleRows.findIndex(row => row.rowId === fromRowId)
    if (currentIndex === -1) return false
    const target = visibleRows[currentIndex + delta]
    if (!target) return false
    // Keep the selected row mid-list while stepping with the keyboard, so the
    // next rows are always in view (focus alone scrolls it to the bottom edge)
    const button = itemButtonRefs.current.get(target.rowId)
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'center' })
    setSelectedItemId(target.itemId)
    if (openArticle) {
      const item = itemsById.get(target.itemId)
      if (item) handleItemClick(item, target.rowId)
    }
    return true
  }, [visibleRows, itemsById, handleItemClick])

  /** Two keyboard modes, both driven from the focused row button (focus stays on
   *  it even while the reader is open, so the keys keep landing here):
   *
   *  - Nothing open: ↑/↓ move to the next row AND open it, so a reading session
   *    starts on the first keypress. That immediately puts us in the other mode.
   *  - Article open: ←/→ step through articles; ↑/↓ are let through to the
   *    reader's window listener, which scrolls the article body instead.
   *
   *  Enter/Space still open via the button's native click handling, but they are
   *  no longer required for anything. */
  const handleItemKeyDown = useCallback((rowId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (deleteMode) return
    if (articleOpen) {
      // ←/→ are handled by the reader (it owns nav); ↑/↓ scroll the article.
      // Either way the panel must not also move the row selection.
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    // Only swallow the scroll once we know there is a row to move to, so the
    // first/last row still scrolls the list normally.
    if (stepToRow(rowId, event.key === 'ArrowDown' ? 1 : -1, true)) event.preventDefault()
  }, [deleteMode, articleOpen, stepToRow])

  // Publish next/prev for the open article upward, so the reader can drive the
  // same queue without the user bouncing back to the list.
  const activeIndex = activeRowId ? visibleRows.findIndex(row => row.rowId === activeRowId) : -1
  useEffect(() => {
    if (!onNavStateChange) return
    if (activeIndex === -1) {
      onNavStateChange(null)
      return
    }
    const currentRowId = visibleRows[activeIndex].rowId
    onNavStateChange({
      position: activeIndex + 1,
      total: visibleRows.length,
      hasPrev: activeIndex > 0,
      hasNext: activeIndex < visibleRows.length - 1,
      goPrev: () => { stepToRow(currentRowId, -1, true) },
      goNext: () => { stepToRow(currentRowId, 1, true) },
    })
  }, [onNavStateChange, activeIndex, visibleRows, stepToRow])

  // On the iPhone the deck is the whole screen, clock included: the panel's
  // own bar and the shell's reserved strip under the status bar read as a
  // white band above the photos. The deck floats the bar's controls instead.
  const reelsFullBleed = viewMode === 'reels' && reelsAvailable && layout.mode === 'phone'
  const reelsOnScreen = reelsFullBleed && routeActive && !articleOpen
  useEffect(() => {
    // TEMP: why the deck drops out of full-screen ("half white frames").
    console.info(`[reels] full-screen ${reelsOnScreen ? 'on' : 'off'} · view=${viewMode} mode=${layout.mode} route=${routeActive} article=${Boolean(articleOpen)}`)
  }, [reelsOnScreen, viewMode, layout.mode, routeActive, articleOpen])
  useEffect(() => {
    if (!reelsOnScreen) return
    const releaseInset = claimPageTopInsetBlock('flush')
    dispatchTopChromeAppearanceBlock({ dark: true })
    return () => {
      releaseInset()
      dispatchTopChromeAppearanceBlock({ dark: false })
    }
  }, [reelsOnScreen])

  if (loading) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-muted-foreground', className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-xs">Loading feeds...</span>
      </div>
    )
  }

  if (!hasFeedsConfigured && feeds.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <PanelHeader
          title="RSS Feeds"
          onClose={onClose}
          onRefresh={refresh}
          refreshing={refreshing}
          deleteMode={false}
          pendingDeleteCount={0}
          onEnterDeleteMode={() => {}}
          onConfirmDelete={() => {}}
          onCancelDeleteMode={() => {}}
          viewMode={viewMode}
          onToggleViewMode={cycleViewMode}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Rss className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm text-muted-foreground">No feeds configured.</div>
          <div className="text-xs text-muted-foreground/70">
            Add RSS feeds in Settings &rarr; RSS Feeds.
          </div>
        </div>
      </div>
    )
  }

  const reelsHeaderActions = (
    <>
      <button
        type="button"
        onClick={cycleViewMode}
        className="ltm-touch-target shrink-0 rounded-full p-2 text-white/85 hover:bg-white/10 hover:text-white"
        title="Use compact feed view"
      >
        <Layers className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="ltm-touch-target shrink-0 rounded-full p-2 text-white/85 hover:bg-white/10 hover:text-white disabled:opacity-40"
        title="Refresh feeds"
      >
        <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="ltm-touch-target shrink-0 rounded-full p-2 text-white/85 hover:bg-white/10 hover:text-white"
        title="Close RSS panel"
      >
        <X className="h-4 w-4" />
      </button>
    </>
  )

  return (
    <NativeListContextBlock.Provider value={native}>
    <div className={cn('flex h-full flex-col', className)}>
      {!reelsFullBleed && <PanelHeader
        title={focusedFeedId ? (feeds.find(f => f.feedId === focusedFeedId)?.feedTitle ?? 'Feed') : 'RSS Feeds'}
        onClose={onClose}
        onRefresh={refresh}
        refreshing={refreshing}
        totalUnread={viewMode === 'reels' ? undefined : totalUnread}
        onMarkAllRead={viewMode === 'reels' ? undefined : () => markAllRssItemsReadBlock(focusedFeedId ?? undefined)}
        deleteMode={deleteMode}
        pendingDeleteCount={pendingDeleteIds.size}
        onEnterDeleteMode={viewMode === 'reels' ? undefined : () => handleEnterDeleteMode(focusedFeedId ?? undefined)}
        onConfirmDelete={handleConfirmDelete}
        onCancelDeleteMode={handleCancelDeleteMode}
        focusedFeedId={focusedFeedId}
        onClearFocus={() => setFocusedFeedId(null)}
        viewMode={viewMode}
        onToggleViewMode={cycleViewMode}
        readableTab={native ? readableTab : undefined}
        onChooseReadableTab={native ? chooseReadableTab : undefined}
        unreadOnly={native ? unreadOnly : undefined}
        onToggleUnreadOnly={native ? toggleUnreadOnly : undefined}
        anythingExpanded={anythingExpanded}
        onToggleExpandAll={native ? toggleExpandAll : undefined}
        sourceFilter={dayMode && viewMode === 'compact'
          ? (
            <>
              <button
                type="button"
                onClick={toggleGroupBy}
                aria-pressed={groupBy === 'themes'}
                title={groupBy === 'themes' ? 'Grouped by theme, as the AI sorted the news (click to group by source)' : 'Group by theme, as the AI sorted the news'}
                className={cn('shrink-0 rounded-md px-2 py-1 text-[11px] font-medium', groupBy === 'themes' && '!bg-zinc-200/80 !text-zinc-900 dark:!bg-zinc-700 dark:!text-white')}
              >
                By theme
              </button>
              <SourceFilterBlock options={inboxFeeds.map(feed => ({ feedId: feed.feedId, title: feed.feedTitle }))} chosen={sourceFilter} onChange={chooseSourceFilter} />
            </>
          )
          : undefined}
      />}

      {/* Delete-mode hint */}
      {deleteMode && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
          {pendingDeleteIds.size === 0
            ? 'Nothing selected — tap trash to cancel.'
            : `${pendingDeleteIds.size} article${pendingDeleteIds.size === 1 ? '' : 's'} selected. Tap any to deselect, then tap trash to delete.`}
        </div>
      )}

      {viewMode === 'reels' ? (
        <RssReelsBlock
          feeds={inboxFeeds}
          loadingFeedIds={loadingFeedIds}
          presetTags={presetTags}
          tagColors={tagColors}
          onOpen={(item) => handleItemClick(item, rssRowIdBlock('__reels__', item.id))}
          onMarkRead={(items) => setRssItemsReadBlock(items, true)}
          onUnmarkRead={(item) => setRssItemsReadBlock([item], false)}
          onToggleSaved={toggleRssItemSavedBlock}
          onToggleTag={toggleRssItemTagBlock}
          fullBleed={reelsFullBleed}
          headerActions={reelsFullBleed ? reelsHeaderActions : undefined}
        />
      ) : viewMode === 'timeline' ? (
        <RssTimelineBlock
          feeds={inboxFeeds}
          loadingFeedIds={loadingFeedIds}
          refreshing={refreshing}
          onRefresh={refresh}
          onOpen={(item) => handleItemClick(item, rssRowIdBlock('__timeline__', item.id))}
          onViewed={markRssItemViewedBlock}
          onMarkRead={markRssItemsReadBlock}
          onUnmarkRead={unmarkRssItemReadBlock}
          onToggleSaved={toggleRssItemSavedBlock}
        />
      ) : <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Merged unread inbox — one flat queue across every source, so new
            articles can be read straight through without hunting per feed. */}
        {showUnreadInbox && !native && (
          <div>
            <button
              type="button"
              onClick={() => toggleFeedExpanded(RSS_UNREAD_INBOX_ID_BLOCK)}
              className="flex w-full items-center gap-1.5 border-b border-border/30 bg-primary/5 px-3 py-3 text-left text-xs hover:bg-primary/10"
            >
              {unreadInboxExpanded
                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">All Unread</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {unreadInboxEntries.filter(entry => !entry.item.read).length}
              </span>
            </button>
            {unreadInboxExpanded && unreadInboxEntries.map((entry, idx) => (
              <FeedItemRow
                key={entry.item.id}
                item={entry.item}
                rowId={rssRowIdBlock(RSS_UNREAD_INBOX_ID_BLOCK, entry.item.id)}
                idx={idx}
                sourceLabel={entry.feedTitle}
                alsoInLabel={rssAlsoInLabelBlock(entry.alsoIn)}
                alsoInTitle={entry.alsoIn?.join(', ')}
                isSelected={selectedItemId === entry.item.id}
                isPendingDelete={false}
                deleteMode={false}
                handleItemClick={handleItemClick}
                onItemKeyDown={handleItemKeyDown}
                registerItemButton={registerItemButton}
                tagColors={tagColors}
              />
            ))}
          </div>
        )}

        {dayMode && (
          <DayInboxRenderer
            days={dayInbox}
            dayTotals={dayTotals}
            foldedDays={foldedDays}
            toggleDayFolded={toggleDayFolded}
            foldedSources={foldedSources}
            toggleSourceFolded={toggleSourceFolded}
            onSourceFilter={chooseSourceFilter}
            selectedItemId={selectedItemId}
            handleItemClick={handleItemClick}
            onItemKeyDown={handleItemKeyDown}
            registerItemButton={registerItemButton}
            tagColors={tagColors}
            onOpenDigest={onOpenDigest}
            activeDigestKey={activeDigestKey}
          />
        )}
        {/* Group tree rendering */}
        {!dayMode && preferences && preferences.groups.length > 0 && !focusedFeedId && (
          <GroupTreeRenderer
            tree={groupTree}
            feedResults={feeds}
            loadingFeedIds={loadingFeedIds}
            expandedFeedIds={expandedFeedIds}
            expandedGroupIds={expandedGroupIds}
            toggleFeedCollapsed={toggleCollapsed}
            toggleGroupCollapsed={toggleGroupCollapsed}
            setFocusedFeedId={setFocusedFeedId}
            deleteMode={deleteMode}
            selectedItemId={selectedItemId}
            pendingDeleteIds={pendingDeleteIds}
            handleItemClick={handleItemClick}
            onItemKeyDown={handleItemKeyDown}
            registerItemButton={registerItemButton}
            tagColors={tagColors}
            depth={0}
          />
        )}
        {/* Flat rendering (no groups or focused on single feed) */}
        {!dayMode && (!preferences || preferences.groups.length === 0 || focusedFeedId) && visibleFeeds.map(feed => (
          <FeedSection
            key={feed.feedId}
            feed={feed}
            loading={loadingFeedIds.has(feed.feedId)}
            collapsed={!expandedFeedIds.has(feed.feedId)}
            toggleCollapsed={toggleCollapsed}
            setFocusedFeedId={setFocusedFeedId}
            deleteMode={deleteMode}
            selectedItemId={selectedItemId}
            pendingDeleteIds={pendingDeleteIds}
            handleItemClick={handleItemClick}
            onItemKeyDown={handleItemKeyDown}
            registerItemButton={registerItemButton}
            tagColors={tagColors}
            depth={0}
          />
        ))}
      </div>}
    </div>
    </NativeListContextBlock.Provider>
  )
}

function PanelHeader({
  title,
  onClose,
  onRefresh,
  refreshing,
  totalUnread,
  onMarkAllRead,
  deleteMode,
  pendingDeleteCount,
  onEnterDeleteMode,
  onConfirmDelete,
  onCancelDeleteMode,
  focusedFeedId,
  onClearFocus,
  viewMode,
  onToggleViewMode,
  readableTab,
  onChooseReadableTab,
  unreadOnly,
  onToggleUnreadOnly,
  anythingExpanded,
  onToggleExpandAll,
  sourceFilter,
}: {
  title: string
  onClose: () => void
  onRefresh: () => void
  refreshing: boolean
  totalUnread?: number
  onMarkAllRead?: () => void
  deleteMode: boolean
  pendingDeleteCount: number
  /** Omitted by modes with no row-selection surface. Reels is one: entering
   *  delete mode there selects articles invisibly, so a second tap would bulk
   *  delete with nothing on screen to review or deselect. */
  onEnterDeleteMode?: () => void
  onConfirmDelete: () => void
  onCancelDeleteMode: () => void
  focusedFeedId?: string | null
  onClearFocus?: () => void
  viewMode: RssViewModeBlock
  onToggleViewMode: () => void
  /** Native only: Readable (in full) or Other (the rest). */
  readableTab?: 'readable' | 'other'
  onChooseReadableTab?: (tab: 'readable' | 'other') => void
  /** Native only: only unread articles, folders kept. */
  unreadOnly?: boolean
  onToggleUnreadOnly?: () => void
  anythingExpanded?: boolean
  onToggleExpandAll?: () => void
  /** Native day inbox: the sources pill, beside Unread */
  sourceFilter?: ReactNode
}) {
  const native = useContext(NativeListContextBlock)
  return (
    <div className={cn(
      'flex shrink-0 items-center gap-1 border-b px-2 py-1.5 transition-colors duration-200',
      deleteMode ? 'border-destructive/30 bg-destructive/5' : native ? 'border-[#EFEFF2] dark:border-zinc-800' : 'border-border/50',
      native && '[&_button]:text-zinc-400 [&_button:hover]:text-zinc-900 dark:[&_button:hover]:text-zinc-100',
    )}>
      {focusedFeedId && onClearFocus && !deleteMode && (
        <button
          type="button"
          onClick={onClearFocus}
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          title="Show all feeds"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {!native && <Rss className="h-3.5 w-3.5 shrink-0 text-orange-400" />}
      {/* Native: the page already says Feed, so the bar leads with the Readable / Other tabs;
          a single source still shows its name */}
      {!deleteMode && onChooseReadableTab && (
        <div role="group" aria-label="Readable or other" className="ml-1 inline-flex shrink-0 gap-0.5 rounded-[7px] bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
          {(['readable', 'other'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              aria-pressed={readableTab === tab}
              onClick={() => onChooseReadableTab(tab)}
              title={tab === 'readable' ? 'Articles the app can show in full' : 'Teasers behind a paywall, and links that do not load'}
              className={cn(
                'rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors',
                readableTab === tab
                  ? '!bg-white !text-zinc-900 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.08)] dark:!bg-zinc-600 dark:!text-white'
                  : '',
              )}
            >
              {tab === 'readable' ? 'Readable' : 'Other'}
            </button>
          ))}
        </div>
      )}
      {(!native || focusedFeedId) && (
        <span className={cn('min-w-0 truncate', native ? 'pl-1.5 text-[13px] font-semibold' : 'flex-1 text-xs font-medium')}>{title}</span>
      )}
      {native && <span className="flex-1" />}
      {!deleteMode && onToggleUnreadOnly && (
        <button
          type="button"
          onClick={onToggleUnreadOnly}
          aria-pressed={Boolean(unreadOnly)}
          title={unreadOnly ? 'Showing unread only (click for everything)' : 'Show unread only'}
          className={cn('shrink-0 rounded-md px-2 py-1 text-[11px] font-medium', unreadOnly && '!bg-zinc-200/80 !text-zinc-900 dark:!bg-zinc-700 dark:!text-white')}
        >
          Unread
        </button>
      )}
      {!deleteMode && sourceFilter}
      {!deleteMode && onToggleExpandAll && (
        <button
          type="button"
          onClick={onToggleExpandAll}
          title={anythingExpanded ? 'Collapse all' : 'Expand all'}
          className="shrink-0 rounded-md p-2"
        >
          {anythingExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
        </button>
      )}

      {!deleteMode && (
        <button
          type="button"
          onClick={onToggleViewMode}
          className={cn(
            'shrink-0 rounded-md p-2 hover:bg-muted/80 hover:text-foreground',
            viewMode === 'reels' ? 'text-primary' : 'text-muted-foreground',
          )}
          title={
            viewMode === 'compact' ? 'Use timeline view'
              : viewMode === 'timeline' ? 'Use reels view'
                : 'Use compact feed view'
          }
        >
          {viewMode === 'reels' ? <Layers className="h-4 w-4" /> : <List className="h-4 w-4" />}
        </button>
      )}

      {!deleteMode && !native && typeof totalUnread === 'number' && totalUnread > 0 && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{totalUnread} unread</span>
      )}
      {!deleteMode && onMarkAllRead && (
        <button
          type="button"
          onClick={onMarkAllRead}
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          title="Mark all read"
        >
          <Check className="h-4 w-4" />
        </button>
      )}

      {/* Delete mode: cancel + confirm */}
      {deleteMode ? (
        <>
          <button
            type="button"
            onClick={onCancelDeleteMode}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={pendingDeleteCount === 0}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
            title="Confirm deletion"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {pendingDeleteCount > 0 && pendingDeleteCount}
          </button>
        </>
      ) : onEnterDeleteMode ? (
        <button
          type="button"
          onClick={onEnterDeleteMode}
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Remove read articles"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}

      {!deleteMode && (
        <>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
            title="Refresh feeds"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
          {/* In F9 the feed is a page, not a panel: nothing to close */}
          {!native && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              title="Close RSS panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group tree renderer — recursive component for nested feed groups
// ---------------------------------------------------------------------------

function GroupTreeRenderer({
  tree,
  feedResults,
  loadingFeedIds,
  expandedFeedIds,
  expandedGroupIds,
  toggleFeedCollapsed,
  toggleGroupCollapsed,
  setFocusedFeedId,
  deleteMode,
  selectedItemId,
  pendingDeleteIds,
  handleItemClick,
  onItemKeyDown,
  registerItemButton,
  tagColors,
  depth,
}: {
  tree: RssFeedGroupTreeNodeBlock[]
  feedResults: RssFeedResultBlock[]
  loadingFeedIds: Set<string>
  expandedFeedIds: Set<string>
  expandedGroupIds: Set<string>
  toggleFeedCollapsed: (feedId: string) => void
  toggleGroupCollapsed: (groupId: string) => void
  setFocusedFeedId: (id: string | null) => void
  deleteMode: boolean
  selectedItemId: string | null
  pendingDeleteIds: Set<string>
  handleItemClick: (item: RssFeedItemBlock, rowId: string) => void
  onItemKeyDown: (rowId: string, event: KeyboardEvent<HTMLButtonElement>) => void
  registerItemButton: (rowId: string, node: HTMLButtonElement | null) => void
  tagColors: Record<string, string>
  depth: number
}) {
  const native = useContext(NativeListContextBlock)
  const feedResultMap = useMemo(() => {
    const map = new Map<string, RssFeedResultBlock>()
    for (const f of feedResults) map.set(f.feedId, f)
    return map
  }, [feedResults])

  return (
    <>
      {tree.map(node => {
        // Root node (group === null) — just render its feeds and children
        if (!node.group) {
          return (
            <div key="__root__">
              {node.feeds.map(feedConfig => {
                const feed = feedResultMap.get(feedConfig.id)
                if (!feed) return null
                return (
                  <FeedSection
                    key={feed.feedId}
                    feed={feed}
                    loading={loadingFeedIds.has(feed.feedId)}
                    collapsed={!expandedFeedIds.has(feed.feedId)}
                    toggleCollapsed={toggleFeedCollapsed}
                    setFocusedFeedId={setFocusedFeedId}
                    deleteMode={deleteMode}
                    selectedItemId={selectedItemId}
                    pendingDeleteIds={pendingDeleteIds}
                    handleItemClick={handleItemClick}
                    onItemKeyDown={onItemKeyDown}
                    registerItemButton={registerItemButton}
                    tagColors={tagColors}
                    depth={depth}
                  />
                )
              })}
              {node.children.length > 0 && (
                <GroupTreeRenderer
                  tree={node.children}
                  feedResults={feedResults}
                  loadingFeedIds={loadingFeedIds}
                  expandedFeedIds={expandedFeedIds}
                  expandedGroupIds={expandedGroupIds}
                  toggleFeedCollapsed={toggleFeedCollapsed}
                  toggleGroupCollapsed={toggleGroupCollapsed}
                  setFocusedFeedId={setFocusedFeedId}
                  deleteMode={deleteMode}
                  selectedItemId={selectedItemId}
                  pendingDeleteIds={pendingDeleteIds}
                  handleItemClick={handleItemClick}
                  onItemKeyDown={onItemKeyDown}
                  registerItemButton={registerItemButton}
                  tagColors={tagColors}
                  depth={depth}
                />
              )}
            </div>
          )
        }

        const groupCollapsed = !expandedGroupIds.has(node.group.id)
        const groupFeedIds = new Set<string>()
        function collectFeedIds(n: RssFeedGroupTreeNodeBlock) {
          for (const fc of n.feeds) groupFeedIds.add(fc.id)
          for (const child of n.children) collectFeedIds(child)
        }
        collectFeedIds(node)
        const totalUnread = feedResults
          .filter(f => groupFeedIds.has(f.feedId))
          .reduce((acc, f) => acc + f.items.filter(i => !i.read).length, 0)

        return (
          <div key={node.group.id}>
            <SidebarGroupHeaderBlock
              name={node.group.name}
              expanded={!groupCollapsed}
              onToggle={() => toggleGroupCollapsed(node.group!.id)}
              icon={native ? undefined : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              badge={totalUnread > 0 ? totalUnread : undefined}
              quietBadge={native}
              // Native: folder rows carry a soft tint (deeper for top-level folders) so the groups read apart from their sources
              className={native
                ? cn(
                  'border-[#E5E5EA] py-2.5 dark:border-zinc-800 [&>span:nth-of-type(1)]:text-zinc-800 dark:[&>span:nth-of-type(1)]:text-zinc-100',
                  depth === 0 ? 'bg-[#EEEEF3] hover:bg-[#E5E5EC] dark:bg-zinc-800/70 dark:hover:bg-zinc-800' : 'bg-[#F6F6F9] hover:bg-[#EEEEF3] dark:bg-zinc-800/35 dark:hover:bg-zinc-800/60',
                )
                : undefined}
              depth={depth}
            />
            {/* Group content */}
            {!groupCollapsed && (
              <>
                {node.feeds.map(feedConfig => {
                  const feed = feedResultMap.get(feedConfig.id)
                  if (!feed) return null
                  return (
                    <FeedSection
                      key={feed.feedId}
                      feed={feed}
                      loading={loadingFeedIds.has(feed.feedId)}
                      collapsed={!expandedFeedIds.has(feed.feedId)}
                      toggleCollapsed={toggleFeedCollapsed}
                      setFocusedFeedId={setFocusedFeedId}
                      deleteMode={deleteMode}
                      selectedItemId={selectedItemId}
                      pendingDeleteIds={pendingDeleteIds}
                      handleItemClick={handleItemClick}
                      onItemKeyDown={onItemKeyDown}
                      registerItemButton={registerItemButton}
                      tagColors={tagColors}
                      depth={depth + 1}
                    />
                  )
                })}
                {node.children.length > 0 && (
                  <GroupTreeRenderer
                    tree={node.children}
                    feedResults={feedResults}
                    loadingFeedIds={loadingFeedIds}
                    expandedFeedIds={expandedFeedIds}
                    expandedGroupIds={expandedGroupIds}
                    toggleFeedCollapsed={toggleFeedCollapsed}
                    toggleGroupCollapsed={toggleGroupCollapsed}
                    setFocusedFeedId={setFocusedFeedId}
                    deleteMode={deleteMode}
                    selectedItemId={selectedItemId}
                    pendingDeleteIds={pendingDeleteIds}
                    handleItemClick={handleItemClick}
                    onItemKeyDown={onItemKeyDown}
                    registerItemButton={registerItemButton}
                    tagColors={tagColors}
                    depth={depth + 1}
                  />
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Feed section — renders a single feed header + items (used in both flat and grouped modes)
// ---------------------------------------------------------------------------

function FeedSection({
  feed,
  loading,
  collapsed,
  toggleCollapsed,
  setFocusedFeedId,
  deleteMode,
  selectedItemId,
  pendingDeleteIds,
  handleItemClick,
  onItemKeyDown,
  registerItemButton,
  tagColors,
  depth,
}: {
  feed: RssFeedResultBlock
  loading: boolean
  collapsed: boolean
  toggleCollapsed: (feedId: string) => void
  setFocusedFeedId: (id: string | null) => void
  deleteMode: boolean
  selectedItemId: string | null
  pendingDeleteIds: Set<string>
  handleItemClick: (item: RssFeedItemBlock, rowId: string) => void
  onItemKeyDown: (rowId: string, event: KeyboardEvent<HTMLButtonElement>) => void
  registerItemButton: (rowId: string, node: HTMLButtonElement | null) => void
  tagColors: Record<string, string>
  depth: number
}) {
  const native = useContext(NativeListContextBlock)
  const unread = feed.items.filter(i => !i.read).length
  return (
    <div>
      <button
        type="button"
        onClick={() => !deleteMode && toggleCollapsed(feed.feedId)}
        onDoubleClick={() => !deleteMode && setFocusedFeedId(feed.feedId)}
        className={cn(
          'flex w-full items-center gap-1.5 border-b px-3 py-3 text-left text-xs hover:bg-muted/50',
          native ? 'border-[#EFEFF2] py-2.5 text-[13px] dark:border-zinc-800' : 'border-border/30',
        )}
        style={depth > 0 ? { paddingLeft: `${12 + depth * 12}px` } : undefined}
        title={native && feed.error ? `Not loading: ${feed.error}` : undefined}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {!native && <Rss className="h-3.5 w-3.5 shrink-0 text-orange-400" />}
        <span className={cn('min-w-0 flex-1 truncate', native ? '' : 'font-medium')}>{feed.feedTitle}</span>
        {/* Native: a failing source is a red dot; Feed → Sources has the detail */}
        {native && feed.error && <span aria-label="Not loading" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
        {loading && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {unread > 0 && (
          <span className={native
            ? 'shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400'
            : 'shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary'}>
            {unread}
          </span>
        )}
      </button>
      {feed.error && !native && (
        <div className="border-b border-border/30 bg-destructive/5 px-3 py-1.5 text-[10px] text-destructive">
          {feed.error}
        </div>
      )}
      {!collapsed && feed.items.map((item, idx) => (
        <FeedItemRow
          key={item.id}
          item={item}
          rowId={rssRowIdBlock(feed.feedId, item.id)}
          idx={idx}
          isSelected={selectedItemId === item.id}
          isPendingDelete={pendingDeleteIds.has(item.id)}
          deleteMode={deleteMode}
          handleItemClick={handleItemClick}
          onItemKeyDown={onItemKeyDown}
          registerItemButton={registerItemButton}
          tagColors={tagColors}
        />
      ))}
      {!collapsed && feed.items.length === 0 && !feed.error && (
        <div className="border-b border-border/40 px-3 py-3 text-center text-[11px] text-muted-foreground">
          {loading ? 'Loading feed...' : 'No items.'}
        </div>
      )}
    </div>
  )
}

// Which sources the day inbox shows: a pill beside Unread that opens a small
// menu of sources to tick; the choice holds on every day.
function SourceFilterBlock({ options, chosen, onChange }: {
  options: Array<{ feedId: string; title: string }>
  chosen: string[]
  onChange: (feedIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  const chosenSet = new Set(chosen)
  const active = options.filter(option => chosenSet.has(option.feedId))
  const sorted = [...options].sort((a, b) => a.title.localeCompare(b.title))
  const toggle = (feedId: string) => onChange(chosenSet.has(feedId) ? chosen.filter(id => id !== feedId) : [...chosen, feedId])
  const label = active.length === 0 ? 'Sources' : active.length === 1 ? active[0].title : `${active.length} sources`
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(prev => !prev)}
        title={active.length > 0 ? active.map(option => option.title).join(', ') : 'Show only some sources'}
        className={cn('max-w-[120px] truncate rounded-md px-2 py-1 text-[11px] font-medium', active.length > 0 && '!bg-zinc-200/80 !text-zinc-900 dark:!bg-zinc-700 dark:!text-white')}
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg bg-white text-[12px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.12)] dark:bg-zinc-900 dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),0_8px_24px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between border-b-[0.5px] border-[#EFEFF2] px-3 py-2 dark:border-zinc-800">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">Show sources</span>
            <button type="button" onClick={() => onChange([])} disabled={active.length === 0} className="!text-sky-600 hover:!text-sky-700 disabled:!text-zinc-300 dark:!text-sky-400 dark:disabled:!text-zinc-600">All</button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {sorted.map(option => (
              <label key={option.feedId} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <input type="checkbox" checked={chosenSet.has(option.feedId)} onChange={() => toggle(option.feedId)} className="h-3.5 w-3.5 accent-[var(--ltm-explorer-selected-color,#c73773)]" />
                <span className="truncate text-zinc-700 dark:text-zinc-200">{option.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day inbox — native: days, then sources, one row per story
// ---------------------------------------------------------------------------

function DayInboxRenderer({
  days,
  dayTotals,
  foldedDays,
  toggleDayFolded,
  foldedSources,
  toggleSourceFolded,
  onSourceFilter,
  selectedItemId,
  handleItemClick,
  onItemKeyDown,
  registerItemButton,
  tagColors,
  onOpenDigest,
  activeDigestKey,
}: {
  days: RssDayInboxBlock[]
  /** The day's whole counts when Unread hides some rows */
  dayTotals: Map<string, { stories: number; unread: number }> | null
  foldedDays: Set<string>
  toggleDayFolded: (day: string) => void
  foldedSources: Set<string>
  toggleSourceFolded: (key: string) => void
  onSourceFilter: (feedIds: string[]) => void
  selectedItemId: string | null
  handleItemClick: (item: RssFeedItemBlock, rowId: string) => void
  onItemKeyDown: (rowId: string, event: KeyboardEvent<HTMLButtonElement>) => void
  registerItemButton: (rowId: string, node: HTMLButtonElement | null) => void
  tagColors: Record<string, string>
  onOpenDigest?: (entry: RssThemeDigestEntryBlock) => void
  activeDigestKey: string | null
}) {
  const now = new Date()
  if (days.length === 0) {
    return <div className="px-4 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">Nothing here.</div>
  }
  return (
    <>
      {days.map(day => {
        const folded = foldedDays.has(day.day)
        let idx = 0
        return (
          <section key={day.day}>
            <button
              type="button"
              aria-expanded={!folded}
              onClick={() => toggleDayFolded(day.day)}
              className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b-[0.5px] border-[#EFEFF2] bg-[#F6F6F8]/95 px-3 text-left backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform', !folded && 'rotate-90')} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{rssDayLabelBlock(day.day, now)}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {(() => {
                  const total = dayTotals?.get(day.day)
                  const stories = total?.stories ?? day.storyCount
                  const unread = total?.unread ?? day.unreadCount
                  return `${unread > 0 ? `${unread} unread · ` : ''}${stories} ${stories === 1 ? 'story' : 'stories'}`
                })()}
              </span>
            </button>
            {!folded && day.sources.map(source => {
              const key = `${day.day}|${source.feedId}`
              const sourceFolded = foldedSources.has(key)
              const unread = source.stories.filter(story => !story.read).length
              if (sourceFolded) idx += source.stories.length
              return (
              <div key={source.feedId}>
                {/* Stays under the day's header while its stories scroll, until the
                    next source (or theme) takes its place: it is sticky inside its own block */}
                <div className="group sticky top-9 z-[9] flex items-center gap-1.5 bg-white/95 px-3 pb-1 pt-2.5 backdrop-blur dark:bg-zinc-900/95">
                  <button
                    type="button"
                    aria-expanded={!sourceFolded}
                    onClick={() => toggleSourceFolded(key)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', !sourceFolded && 'rotate-90')} />
                    <span className="truncate">{source.feedTitle}</span>
                    <span className="shrink-0 font-normal normal-case tracking-normal text-zinc-400">
                      {source.stories.length === 0 && source.digest
                        ? `${source.digest.sources.length} ${source.digest.sources.length === 1 ? 'source' : 'sources'}`
                        : unread > 0 ? `${unread} of ${source.stories.length}` : source.stories.length}
                    </span>
                  </button>
                  {/* A theme is not a source: "only this" filters by outlet */}
                  {!source.feedId.startsWith('theme:') && <button
                    type="button"
                    onClick={() => onSourceFilter([source.feedId])}
                    className="shrink-0 text-[11px] text-sky-600 opacity-0 transition-opacity hover:text-sky-700 group-hover:opacity-100 dark:text-sky-400"
                    title="Show only this source, on every day"
                  >
                    only this
                  </button>}
                </div>
                {!sourceFolded && source.stories.map(story => {
                  const rowId = rssRowIdBlock(`day:${day.day}`, story.lead.item.id)
                  const others = rssStoryOthersLabelBlock(story)
                  const row = (
                    <FeedItemRow
                      key={rowId}
                      item={story.lead.item}
                      readOverride={story.read}
                      rowId={rowId}
                      idx={idx}
                      alsoInLabel={others?.label}
                      alsoInTitle={others?.title}
                      isSelected={selectedItemId === story.lead.item.id}
                      isPendingDelete={false}
                      deleteMode={false}
                      handleItemClick={handleItemClick}
                      onItemKeyDown={onItemKeyDown}
                      registerItemButton={registerItemButton}
                      tagColors={tagColors}
                    />
                  )
                  idx += 1
                  return row
                })}
                {/* After the theme's own articles: what the other sources had on it */}
                {!sourceFolded && source.digest && (onOpenDigest
                  ? <ThemeDigestRowBlock entry={{ key: `${day.day}|${source.feedId}`, theme: source.feedTitle, digest: source.digest }} active={activeDigestKey === `${day.day}|${source.feedId}`} onOpen={onOpenDigest} />
                  : <ThemeDigestBlock digest={source.digest} />)}
              </div>
              )
            })}
          </section>
        )
      })}
    </>
  )
}


/**
 * A theme's digest from the sources outside the reading list: which of its
 * topics other outlets also carried, and the AI's paragraph on what else
 * happened in the theme. Read after the theme's own articles.
 */
function ThemeDigestBlock({ digest }: { digest: RssThemeDigestBlock }) {
  if (!digest.note && digest.cited.length === 0) return null
  return (
    <div className="mx-3 mb-3 mt-1 rounded-lg bg-zinc-50 px-3 py-2.5 text-[12.5px] leading-snug dark:bg-zinc-800/50">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        From other sources · {digest.sources.length} {digest.sources.length === 1 ? 'outlet' : 'outlets'}
      </p>
      {digest.cited.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {digest.cited.map(c => (
            <li key={c.topic} className="flex gap-2">
              <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200">{c.topic}</span>
              <span className="max-w-[55%] shrink-0 truncate text-right text-zinc-500 dark:text-zinc-400" title={c.sources.map(rssOutletNameBlock).join(', ')}>
                also {c.sources.map(rssOutletNameBlock).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {digest.note && <p className="mt-2 leading-relaxed text-zinc-700 dark:text-zinc-300">{digest.note}</p>}
    </div>
  )
}

/**
 * A theme's digest as a row of the list, read last in its theme like one more
 * article: what the other sources had, opened beside the list in full.
 */
function ThemeDigestRowBlock({ entry, active, onOpen }: { entry: RssThemeDigestEntryBlock; active: boolean; onOpen: (entry: RssThemeDigestEntryBlock) => void }) {
  const { digest } = entry
  if (!digest.note && digest.cited.length === 0) return null
  const lead = digest.note ?? `Also covered: ${digest.cited.map(c => `${c.topic} (${c.sources.map(rssOutletNameBlock).join(', ')})`).join('; ')}`
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      className={cn(
        'flex w-full items-start gap-2 border-b border-border/40 px-3 py-3 text-left text-xs outline-none',
        active ? 'border-[var(--ltm-explorer-selected-color,#c73773)] bg-[var(--ltm-explorer-selected-color,#c73773)] text-white' : 'hover:bg-muted/40',
      )}
    >
      <Layers className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'text-white/80' : 'text-violet-500 dark:text-violet-400')} />
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">From other sources</div>
        <div className={cn('mt-0.5 line-clamp-3 text-[11px] leading-snug', active ? 'text-white/85' : 'text-zinc-600 dark:text-zinc-300')}>{lead}</div>
        <div className={cn('mt-1 truncate text-[10px] leading-none', active ? 'text-white/60' : 'text-muted-foreground/70')} title={digest.sources.map(rssOutletNameBlock).join(', ')}>
          {digest.sources.length} {digest.sources.length === 1 ? 'outlet' : 'outlets'} · {digest.sources.map(rssOutletNameBlock).join(', ')}
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Feed item row — single article row
// ---------------------------------------------------------------------------

// Memoised: moving the selection re-renders only the two rows whose
// `isSelected` changed, not every row of every day in the list.
const FeedItemRow = memo(FeedItemRowImpl)

function FeedItemRowImpl({
  item: rawItem,
  readOverride,
  rowId,
  idx,
  sourceLabel,
  alsoInLabel,
  alsoInTitle,
  isSelected,
  isPendingDelete,
  deleteMode,
  handleItemClick,
  onItemKeyDown,
  registerItemButton,
  tagColors,
}: {
  item: RssFeedItemBlock
  /** The whole story is read (another copy was): show this row as read */
  readOverride?: boolean
  rowId: string
  idx: number
  /** Source feed name, shown only in the merged unread inbox. */
  sourceLabel?: string
  /** "also in …" — the other feeds this article is in. Merged inbox only. */
  alsoInLabel?: string | null
  alsoInTitle?: string
  isSelected: boolean
  isPendingDelete: boolean
  deleteMode: boolean
  handleItemClick: (item: RssFeedItemBlock, rowId: string) => void
  onItemKeyDown: (rowId: string, event: KeyboardEvent<HTMLButtonElement>) => void
  registerItemButton: (rowId: string, node: HTMLButtonElement | null) => void
  tagColors: Record<string, string>
}) {
  const item = readOverride && !rawItem.read ? { ...rawItem, read: true } : rawItem
  const hasMeta = item.keep || item.important || (item.tags?.length ?? 0) > 0
  return (
    <button
      type="button"
      ref={node => { registerItemButton(rowId, node) }}
      onClick={() => handleItemClick(item, rowId)}
      onKeyDown={event => onItemKeyDown(rowId, event)}
      className={cn(
        // No focus ring: the selection colour already marks the row, and keyboard reading is the main way through
        // No colour transition: the selection must land the moment a key is pressed
        'flex w-full items-start gap-2 border-b border-border/40 px-3 py-3 text-left text-xs outline-none focus-visible:outline-none focus-visible:ring-0',
        deleteMode && isPendingDelete && 'border-destructive/30 bg-destructive/10 hover:bg-destructive/15',
        deleteMode && !isPendingDelete && 'opacity-40',
        !deleteMode && isSelected && 'border-[var(--ltm-explorer-selected-color,#c73773)] bg-[var(--ltm-explorer-selected-color,#c73773)] text-white hover:bg-[var(--ltm-explorer-selected-color,#c73773)]',
        !deleteMode && !isSelected && 'hover:bg-muted/40',
        !deleteMode && !isSelected && item.read && 'opacity-55',
      )}
    >
      <span className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        {deleteMode ? (
          <Trash2 className={cn(
            'h-3.5 w-3.5 transition-colors duration-200',
            isPendingDelete ? 'text-destructive animate-pulse' : 'text-muted-foreground/30',
          )} />
        ) : (
          <>
            <span className={cn(
              'text-[9px] font-medium leading-none tabular-nums',
              isSelected ? 'text-white/70' : 'text-muted-foreground/50',
            )}>
              {idx + 1}
            </span>
            {item.read
              ? <Check className={cn('h-3 w-3', isSelected ? 'text-white/70' : 'text-muted-foreground/50')} />
              : <Circle className={cn('h-3 w-3', isSelected ? 'fill-white text-white' : 'fill-primary/70 text-primary/70')} />}
          </>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn(
          'line-clamp-2 leading-snug',
          deleteMode && isPendingDelete && 'line-through text-destructive/70',
          !deleteMode && (!item.read && !isSelected) && 'font-medium',
          !deleteMode && isSelected && 'font-medium',
        )}>
          {item.title || '(Untitled)'}
        </div>
        {/* The AI's summary when it has read the article; otherwise the feed's own teaser */}
        {item.aiSummary && !isPendingDelete ? (
          <div className={cn(
            'mt-0.5 line-clamp-3 text-[11px] leading-snug',
            isSelected ? 'text-white/85' : 'text-zinc-600 dark:text-zinc-300',
          )}>
            <span className={cn('mr-1 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide', isSelected ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300')} title={`Summary by ${item.aiSummary.model || 'AI'}`}>AI</span>
            {item.aiSummary.text.replace(/\n/g, ' ')}
          </div>
        ) : item.description && !isPendingDelete && (
          <div className={cn(
            'mt-0.5 line-clamp-2 text-[11px] leading-snug',
            isSelected ? 'text-white/75' : 'text-muted-foreground',
          )}>
            {item.description}
          </div>
        )}
        {(item.pubDate || sourceLabel) && !isPendingDelete && (
          <div className={cn(
            'mt-1 flex items-center gap-1 text-[10px] leading-none',
            isSelected ? 'text-white/60' : 'text-muted-foreground/70',
          )}>
            {/* The merged inbox mixes feeds, so each row has to name its source. */}
            {sourceLabel && (
              <span className={cn(
                'min-w-0 max-w-[45%] truncate font-medium',
                isSelected ? 'text-white/75' : 'text-muted-foreground',
              )}>
                {sourceLabel}
              </span>
            )}
            {sourceLabel && item.pubDate && <span aria-hidden>·</span>}
            {item.pubDate && (
              <span className="shrink-0 tabular-nums">{formatAbsoluteDateTime(item.pubDate)}</span>
            )}
            {alsoInLabel && (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate" title={alsoInTitle}>{alsoInLabel}</span>
              </>
            )}
            <RssItemAnnotationMarksBlock itemId={item.id} inverted={isSelected} className="ml-auto" />
          </div>
        )}
        {hasMeta && !isPendingDelete && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.keep && (
              <Bookmark className={cn(
                'h-3 w-3 shrink-0',
                isSelected ? 'fill-white/80 text-white/80' : 'fill-amber-500 text-amber-500',
              )} />
            )}
            {item.important && (
              <Star className={cn(
                'h-3 w-3 shrink-0',
                isSelected ? 'fill-white/80 text-white/80' : 'fill-rose-500 text-rose-500',
              )} />
            )}
            {item.tags?.map(tag => (
              <span
                key={tag}
                className={cn(
                  'inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium',
                  isSelected ? 'border-white/20 bg-white/20 text-white' : tagColorClassBlock(tag, 'solid'),
                )}
                style={isSelected ? undefined : tagColorStyleBlock(tag, 'solid', tagColors[tagLookupKeyBlock(tag)])}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className={cn(
        'shrink-0 whitespace-nowrap text-[10px]',
        deleteMode && isPendingDelete ? 'text-destructive/50' : '',
        !deleteMode && isSelected ? 'text-white/70' : 'text-muted-foreground',
      )}>
        {formatRelativeDate(item.pubDate)}
      </span>
    </button>
  )
}
