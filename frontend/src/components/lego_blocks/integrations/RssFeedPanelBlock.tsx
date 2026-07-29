import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Rss,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useExpandedSetBlock } from '@/components/lego_blocks/hooks/shared/useExpandedSetBlock'
import SidebarGroupHeaderBlock from '@/components/lego_blocks/units/ui/SidebarGroupHeaderBlock'
import {
  fetchAndParseRssFeedOrch,
  markRssItemReadOrch,
  markRssItemsReadOrch,
  readRssFeedPreferencesOrch,
  removeRssItemsOrch,
} from '@/services/orchestrators/rssFeedOrch'
import {
  RSS_UNREAD_INBOX_ID_BLOCK,
  buildFeedGroupTreeBlock,
  buildUnreadInboxItemsBlock,
  flattenVisibleRssRowsBlock,
  rssRowIdBlock,
  type RssArticleNavStateBlock,
  type RssFeedConfigBlock,
  type RssFeedGroupTreeNodeBlock,
  type RssFeedItemBlock,
  type RssFeedPreferencesBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import {
  tagColorClassBlock,
  tagColorStyleBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import { cn } from '@/lib/utils'

interface RssFeedPanelBlockProps {
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
}: RssFeedPanelBlockProps) {
  const [feeds, setFeeds] = useState<RssFeedResultBlock[]>([])
  const [preferences, setPreferences] = useState<RssFeedPreferencesBlock | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Feeds/groups are collapsed by default; only those explicitly expanded are in these sets.
  // Persisted in localStorage so the state survives navigation.
  const { expanded: expandedFeedIds, toggle: toggleFeedExpanded } = useExpandedSetBlock('ltm-rss-expanded-feeds')
  const { expanded: expandedGroupIds, toggle: toggleGroupExpanded } = useExpandedSetBlock('ltm-rss-expanded-groups')
  const [focusedFeedId, setFocusedFeedId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  // Delete-preview mode
  const [deleteMode, setDeleteMode] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const hasFeedsConfigured = useRef(false)
  const rssLoadRequestIdRef = useRef(0)
  const [loadingFeedIds, setLoadingFeedIds] = useState<Set<string>>(new Set())
  // Row buttons keyed by rowId, so arrow keys can move DOM focus between them.
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  // Row of the article currently open in the reader — anchors its next/prev.
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  // Articles read since the last refresh. Keeps them from vanishing out of the
  // unread inbox mid-read; see buildUnreadInboxItemsBlock.
  const [sessionReadIds, setSessionReadIds] = useState<Set<string>>(new Set())


  const presetTags = preferences?.presetTags ?? []
  const tagColors = preferences?.tagColors ?? {}

  const mergeFeedResult = useCallback((feedConfigs: RssFeedConfigBlock[], nextResult: RssFeedResultBlock) => {
    setFeeds((previous) => {
      const byFeedId = new Map(previous.map((feed) => [feed.feedId, feed]))
      byFeedId.set(nextResult.feedId, nextResult)
      return feedConfigs.map((config) => (
        byFeedId.get(config.id) ?? {
          feedId: config.id,
          feedTitle: config.title,
          items: [],
          error: null,
        }
      ))
    })
  }, [])

  const loadFeeds = useCallback(async (isRefresh = false) => {
    const requestId = rssLoadRequestIdRef.current + 1
    rssLoadRequestIdRef.current = requestId
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const prefs = await readRssFeedPreferencesOrch()
      if (requestId !== rssLoadRequestIdRef.current) return

      setPreferences(prefs)
      // A refresh is the point where already-read articles finally leave the
      // unread inbox.
      setSessionReadIds(new Set())
      hasFeedsConfigured.current = prefs.feeds.length > 0
      const feedConfigs = prefs.feeds
      setFeeds(feedConfigs.map((config) => ({
        feedId: config.id,
        feedTitle: config.title,
        items: [],
        error: null,
      })))
      setLoadingFeedIds(new Set(feedConfigs.map((config) => config.id)))
      setLoading(false)

      await Promise.all(feedConfigs.map(async (config) => {
        try {
          const result = await fetchAndParseRssFeedOrch(config, {
            onStoredResult: (storedResult) => {
              if (requestId !== rssLoadRequestIdRef.current) return
              mergeFeedResult(feedConfigs, storedResult)
            },
          })
          if (requestId !== rssLoadRequestIdRef.current) return
          mergeFeedResult(feedConfigs, result)
        } finally {
          if (requestId !== rssLoadRequestIdRef.current) return
          setLoadingFeedIds((previous) => {
            if (!previous.has(config.id)) return previous
            const next = new Set(previous)
            next.delete(config.id)
            return next
          })
        }
      }))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [mergeFeedResult])

  useEffect(() => {
    void loadFeeds()
  }, [loadFeeds])

  const groupTree = useMemo<RssFeedGroupTreeNodeBlock[]>(() => {
    if (!preferences) return []
    return buildFeedGroupTreeBlock(preferences.groups, preferences.feeds)
  }, [preferences])

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    toggleGroupExpanded(groupId)
  }, [toggleGroupExpanded])

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
    if (!item.read) {
      markRssItemReadOrch(item.id)
      // Pin it into the unread inbox for the rest of this session so the list
      // doesn't reshuffle under the user the moment they open something.
      setSessionReadIds(prev => new Set(prev).add(item.id))
      setFeeds(prev => prev.map(f => ({
        ...f,
        items: f.items.map(i => i.id === item.id ? { ...i, read: true } : i),
      })))
    }
    if (!item.link) return
    onOpenArticle(
      item,
      (updated) => {
        setFeeds(prev => prev.map(f => ({
          ...f,
          items: f.items.map(i => i.id === updated.id ? updated : i),
        })))
      },
      () => {
        setFeeds(prev => prev.map(f => ({
          ...f,
          items: f.items.filter(i => i.id !== item.id),
        })))
        setSelectedItemId(null)
        setActiveRowId(null)
      },
      presetTags,
      tagColors,
    )
  }, [deleteMode, onOpenArticle, presetTags, tagColors])

  const handleMarkAllRead = useCallback((feedId?: string) => {
    const itemIds = feeds
      .filter(f => !feedId || f.feedId === feedId)
      .flatMap(f => f.items.filter(i => !i.read).map(i => i.id))
    if (itemIds.length === 0) return
    markRssItemsReadOrch(itemIds)
    setFeeds(prev => prev.map(f => {
      if (feedId && f.feedId !== feedId) return f
      return { ...f, items: f.items.map(i => ({ ...i, read: true })) }
    }))
  }, [feeds])

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
    void removeRssItemsOrch([...pendingDeleteIds])
    setFeeds(prev => prev.map(f => ({
      ...f,
      items: f.items.filter(i => !pendingDeleteIds.has(i.id)),
    })))
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

  const totalUnread = useMemo(
    () => feeds.reduce((acc, f) => acc + f.items.filter(i => !i.read).length, 0),
    [feeds],
  )

  // ---------------------------------------------------------------------
  // Merged "All Unread" inbox
  // ---------------------------------------------------------------------

  const unreadInboxEntries = useMemo(
    () => buildUnreadInboxItemsBlock(feeds, sessionReadIds),
    [feeds, sessionReadIds],
  )
  const unreadInboxExpanded = expandedFeedIds.has(RSS_UNREAD_INBOX_ID_BLOCK)
  // The inbox merges every source, so it only makes sense in the all-feeds view.
  const showUnreadInbox = !focusedFeedId && !deleteMode && unreadInboxEntries.length > 0

  // ---------------------------------------------------------------------
  // Row navigation — arrow keys in the panel, next/prev in the reader
  // ---------------------------------------------------------------------

  // Mirrors the two rendering branches below: grouped tree vs. flat/focused list.
  const useGroupedRendering = Boolean(preferences && preferences.groups.length > 0 && !focusedFeedId)

  const visibleRows = useMemo(() => flattenVisibleRssRowsBlock({
    unreadInbox: showUnreadInbox
      ? { expanded: unreadInboxExpanded, itemIds: unreadInboxEntries.map(entry => entry.item.id) }
      : null,
    tree: useGroupedRendering ? groupTree : null,
    feeds: useGroupedRendering ? feeds : visibleFeeds,
    expandedFeedIds,
    expandedGroupIds,
  }), [
    showUnreadInbox, unreadInboxExpanded, unreadInboxEntries,
    useGroupedRendering, groupTree, feeds, visibleFeeds, expandedFeedIds, expandedGroupIds,
  ])

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
    itemButtonRefs.current.get(target.rowId)?.focus()
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
   *  - Nothing open: ↑/↓ browse rows, Enter/Space open via the button's native
   *    click handling.
   *  - Article open: ←/→ step through articles; ↑/↓ are let through to the
   *    reader's window listener, which scrolls the article body instead. */
  const handleItemKeyDown = useCallback((rowId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (deleteMode) return
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
    const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft'

    if (articleOpen) {
      // ←/→ are handled by the reader (it owns nav); ↑/↓ scroll the article.
      // Either way the panel must not also move the row selection.
      return
    }
    if (horizontal) return
    if (!vertical) return
    // Only swallow the scroll once we know there is a row to move to, so the
    // first/last row still scrolls the list normally.
    if (stepToRow(rowId, event.key === 'ArrowDown' ? 1 : -1, false)) event.preventDefault()
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

  if (loading) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-muted-foreground', className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-xs">Loading feeds...</span>
      </div>
    )
  }

  if (!hasFeedsConfigured.current && feeds.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <PanelHeader
          title="RSS Feeds"
          onClose={onClose}
          onRefresh={() => void loadFeeds(true)}
          refreshing={refreshing}
          deleteMode={false}
          pendingDeleteCount={0}
          onEnterDeleteMode={() => {}}
          onConfirmDelete={() => {}}
          onCancelDeleteMode={() => {}}
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

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <PanelHeader
        title={focusedFeedId ? (feeds.find(f => f.feedId === focusedFeedId)?.feedTitle ?? 'Feed') : 'RSS Feeds'}
        onClose={onClose}
        onRefresh={() => void loadFeeds(true)}
        refreshing={refreshing}
        totalUnread={totalUnread}
        onMarkAllRead={() => handleMarkAllRead(focusedFeedId ?? undefined)}
        deleteMode={deleteMode}
        pendingDeleteCount={pendingDeleteIds.size}
        onEnterDeleteMode={() => handleEnterDeleteMode(focusedFeedId ?? undefined)}
        onConfirmDelete={handleConfirmDelete}
        onCancelDeleteMode={handleCancelDeleteMode}
        focusedFeedId={focusedFeedId}
        onClearFocus={() => setFocusedFeedId(null)}
      />

      {/* Delete-mode hint */}
      {deleteMode && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
          {pendingDeleteIds.size === 0
            ? 'Nothing selected — tap trash to cancel.'
            : `${pendingDeleteIds.size} article${pendingDeleteIds.size === 1 ? '' : 's'} selected. Tap any to deselect, then tap trash to delete.`}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Merged unread inbox — one flat queue across every source, so new
            articles can be read straight through without hunting per feed. */}
        {showUnreadInbox && (
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

        {/* Group tree rendering */}
        {preferences && preferences.groups.length > 0 && !focusedFeedId && (
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
        {(!preferences || preferences.groups.length === 0 || focusedFeedId) && visibleFeeds.map(feed => (
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
      </div>
    </div>
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
}: {
  title: string
  onClose: () => void
  onRefresh: () => void
  refreshing: boolean
  totalUnread?: number
  onMarkAllRead?: () => void
  deleteMode: boolean
  pendingDeleteCount: number
  onEnterDeleteMode: () => void
  onConfirmDelete: () => void
  onCancelDeleteMode: () => void
  focusedFeedId?: string | null
  onClearFocus?: () => void
}) {
  return (
    <div className={cn(
      'flex shrink-0 items-center gap-1 border-b px-2 py-1.5 transition-colors duration-200',
      deleteMode ? 'border-destructive/30 bg-destructive/5' : 'border-border/50',
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
      <Rss className="h-3.5 w-3.5 shrink-0 text-orange-400" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>

      {!deleteMode && typeof totalUnread === 'number' && totalUnread > 0 && (
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
      ) : (
        <button
          type="button"
          onClick={onEnterDeleteMode}
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Remove read articles"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

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
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            title="Close RSS panel"
          >
            <X className="h-4 w-4" />
          </button>
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
              icon={<FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              badge={totalUnread > 0 ? totalUnread : undefined}
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
  const unread = feed.items.filter(i => !i.read).length
  return (
    <div>
      <button
        type="button"
        onClick={() => !deleteMode && toggleCollapsed(feed.feedId)}
        onDoubleClick={() => !deleteMode && setFocusedFeedId(feed.feedId)}
        className="flex w-full items-center gap-1.5 border-b border-border/30 px-3 py-3 text-left text-xs hover:bg-muted/50"
        style={depth > 0 ? { paddingLeft: `${12 + depth * 12}px` } : undefined}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Rss className="h-3.5 w-3.5 shrink-0 text-orange-400" />
        <span className="min-w-0 flex-1 truncate font-medium">{feed.feedTitle}</span>
        {loading && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {unread}
          </span>
        )}
      </button>
      {feed.error && (
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

// ---------------------------------------------------------------------------
// Feed item row — single article row
// ---------------------------------------------------------------------------

function FeedItemRow({
  item,
  rowId,
  idx,
  sourceLabel,
  isSelected,
  isPendingDelete,
  deleteMode,
  handleItemClick,
  onItemKeyDown,
  registerItemButton,
  tagColors,
}: {
  item: RssFeedItemBlock
  rowId: string
  idx: number
  /** Source feed name, shown only in the merged unread inbox. */
  sourceLabel?: string
  isSelected: boolean
  isPendingDelete: boolean
  deleteMode: boolean
  handleItemClick: (item: RssFeedItemBlock, rowId: string) => void
  onItemKeyDown: (rowId: string, event: KeyboardEvent<HTMLButtonElement>) => void
  registerItemButton: (rowId: string, node: HTMLButtonElement | null) => void
  tagColors: Record<string, string>
}) {
  const hasMeta = item.keep || item.important || (item.tags?.length ?? 0) > 0
  return (
    <button
      type="button"
      ref={node => { registerItemButton(rowId, node) }}
      onClick={() => handleItemClick(item, rowId)}
      onKeyDown={event => onItemKeyDown(rowId, event)}
      className={cn(
        'flex w-full items-start gap-2 border-b border-border/40 px-3 py-3 text-left text-xs transition-colors duration-200',
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
        {item.description && !isPendingDelete && (
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
              <span className="tabular-nums">{formatAbsoluteDateTime(item.pubDate)}</span>
            )}
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
