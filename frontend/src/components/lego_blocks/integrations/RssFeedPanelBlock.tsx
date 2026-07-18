import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  buildFeedGroupTreeBlock,
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

export default function RssFeedPanelBlock({
  onOpenArticle,
  onClose,
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

  const handleItemClick = useCallback((item: RssFeedItemBlock) => {
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
    if (!item.read) {
      markRssItemReadOrch(item.id)
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
  handleItemClick: (item: RssFeedItemBlock) => void
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
  handleItemClick: (item: RssFeedItemBlock) => void
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
          idx={idx}
          isSelected={selectedItemId === item.id}
          isPendingDelete={pendingDeleteIds.has(item.id)}
          deleteMode={deleteMode}
          handleItemClick={handleItemClick}
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
  idx,
  isSelected,
  isPendingDelete,
  deleteMode,
  handleItemClick,
  tagColors,
}: {
  item: RssFeedItemBlock
  idx: number
  isSelected: boolean
  isPendingDelete: boolean
  deleteMode: boolean
  handleItemClick: (item: RssFeedItemBlock) => void
  tagColors: Record<string, string>
}) {
  const hasMeta = item.keep || item.important || (item.tags?.length ?? 0) > 0
  return (
    <button
      type="button"
      onClick={() => handleItemClick(item)}
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
