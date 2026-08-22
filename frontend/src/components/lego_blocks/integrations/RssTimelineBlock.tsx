import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { AlertCircle, Bookmark, Check, Circle, Eye, ListChecks, Loader2, Rss, X } from 'lucide-react'
import {
  pickRssTimelineAnchorBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import { cn } from '@/lib/utils'

const VIEW_RATIO = 0.6
const VIEW_DWELL_MS = 900
const INITIAL_CARD_COUNT = 12
const CARD_PAGE_SIZE = 8

const SCROLL_ANCHOR_KEY = 'ltm-rss-timeline-anchor'
/** How long after mount we keep trying to land on the saved anchor. Cached
 *  backlog pages stream in for a few seconds, so the anchor article often is
 *  not in the list yet on the first render. */
const ANCHOR_RESTORE_WINDOW_MS = 15_000

/** Pull-to-refresh: how far the finger must travel past the top edge to arm a
 *  refresh, and how much of that travel the indicator actually shows. The
 *  divisor is the usual rubber-band resistance — the indicator lags the finger
 *  so the gesture feels weighted rather than twitchy. */
const PULL_TRIGGER_PX = 72
const PULL_RESISTANCE = 2.2
const PULL_MAX_PX = 96

/** Where the reader was, expressed as an article rather than a pixel offset.
 *  Card heights change as the backlog hydrates, so a raw scrollTop would land
 *  somewhere else entirely by the time the list settles. */
interface TimelineScrollAnchor {
  sourceId: string
  itemId: string
  /** Distance from the scroller's top edge to the anchor card's top edge.
   *  Negative once the card is partly scrolled past. */
  offset: number
}

function readTimelineAnchorBlock(): TimelineScrollAnchor | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_ANCHOR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TimelineScrollAnchor>
    if (typeof parsed?.itemId === 'string' && typeof parsed.sourceId === 'string' && typeof parsed.offset === 'number') {
      return { sourceId: parsed.sourceId, itemId: parsed.itemId, offset: parsed.offset }
    }
  } catch { /* storage is optional */ }
  return null
}

function writeTimelineAnchorBlock(anchor: TimelineScrollAnchor | null): void {
  try {
    if (anchor) sessionStorage.setItem(SCROLL_ANCHOR_KEY, JSON.stringify(anchor))
    else sessionStorage.removeItem(SCROLL_ANCHOR_KEY)
  } catch { /* storage is optional */ }
}

interface RssTimelineBlockProps {
  feeds: RssFeedResultBlock[]
  /** Feeds whose fetch is still outstanding — drives the skeleton and the
   *  "loading more sources" footer instead of a blank list. */
  loadingFeedIds: Set<string>
  /** True while an explicit refresh is in flight — keeps the spinner up after
   *  the finger lifts. */
  refreshing: boolean
  onRefresh: () => void
  onOpen: (item: RssFeedItemBlock) => void
  onViewed: (item: RssFeedItemBlock) => void
  onMarkRead: (items: RssFeedItemBlock[]) => void
  onUnmarkRead: (item: RssFeedItemBlock) => void
  onToggleSaved: (item: RssFeedItemBlock) => void
}

/** A deliberately spacious, low-input RSS surface. It is a view over the same
 * feed model as the compact explorer—not a second reader implementation. */
export default function RssTimelineBlock({
  feeds,
  loadingFeedIds,
  refreshing,
  onRefresh,
  onOpen,
  onViewed,
  onMarkRead,
  onUnmarkRead,
  onToggleSaved,
}: RssTimelineBlockProps) {
  // Read once, at mount: this is where the reader was before it navigated away.
  const [initialAnchor] = useState<TimelineScrollAnchor | null>(readTimelineAnchorBlock)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sessionHandledIds, setSessionHandledIds] = useState<Set<string>>(new Set())
  const [renderedCount, setRenderedCount] = useState(INITIAL_CARD_COUNT)
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => initialAnchor?.sourceId ?? '__all__')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const cardNodesRef = useRef(new Map<string, HTMLElement>())
  const pendingAnchorRef = useRef<TimelineScrollAnchor | null>(initialAnchor)
  const anchorDeadlineRef = useRef(Date.now() + ANCHOR_RESTORE_WINDOW_MS)
  const anchorFrameRef = useRef<number | null>(null)
  const entries = useMemo(() => feeds.flatMap(feed => feed.items.map(item => ({ item, feedTitle: feed.feedTitle })))
    .sort((a, b) => new Date(b.item.pubDate ?? 0).getTime() - new Date(a.item.pubDate ?? 0).getTime()), [feeds])
  const sources = useMemo(() => feeds.map(feed => ({ id: feed.feedId, title: feed.feedTitle })), [feeds])
  const filteredEntries = selectedSourceId === '__all__'
    ? entries.filter(({ item }) => !item.read || sessionHandledIds.has(item.id))
    : entries.filter(entry => entry.item.feedId === selectedSourceId)
  const visibleEntries = filteredEntries.slice(0, renderedCount)

  // The restored source tab can point at a feed that has since been removed.
  // Fall back rather than showing an permanently empty timeline.
  useEffect(() => {
    if (selectedSourceId === '__all__' || feeds.length === 0) return
    if (!feeds.some(feed => feed.feedId === selectedSourceId)) setSelectedSourceId('__all__')
  }, [feeds, selectedSourceId])

  const changeSource = useCallback((sourceId: string) => {
    // A tab switch is the one moment the old anchor is meaningless.
    pendingAnchorRef.current = null
    writeTimelineAnchorBlock(null)
    setRenderedCount(INITIAL_CARD_COUNT)
    scrollerRef.current?.scrollTo({ top: 0 })
    setSelectedSourceId(sourceId)
  }, [])

  // Deliberately NOT reset when `entries` grows. Cached backlog pages stream in
  // for seconds after open, and shrinking the window mid-scroll both truncates
  // the list under the reader and clamps scrollTop back to the top.
  const registerCardNode = useCallback((itemId: string, node: HTMLElement | null) => {
    if (node) cardNodesRef.current.set(itemId, node)
    else cardNodesRef.current.delete(itemId)
  }, [])

  // Pull-to-refresh. Deliberately does not preventDefault: iOS rubber-bands the
  // scroller itself, and the indicator rides along with that motion, which is
  // what makes it feel native rather than like a web widget.
  const pullStartYRef = useRef<number | null>(null)
  const [pullDistance, setPullDistance] = useState(0)

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current
    pullStartYRef.current = scroller && scroller.scrollTop <= 0
      ? event.touches[0]?.clientY ?? null
      : null
  }, [])

  const handleTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startY = pullStartYRef.current
    if (startY === null) return
    const scroller = scrollerRef.current
    // The reader scrolled back into the list — this is no longer a pull.
    if (scroller && scroller.scrollTop > 0) {
      pullStartYRef.current = null
      setPullDistance(0)
      return
    }
    const delta = (event.touches[0]?.clientY ?? startY) - startY
    setPullDistance(delta <= 0 ? 0 : Math.min(delta / PULL_RESISTANCE, PULL_MAX_PX))
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (pullStartYRef.current !== null && pullDistance >= PULL_TRIGGER_PX / PULL_RESISTANCE) onRefresh()
    pullStartYRef.current = null
    setPullDistance(0)
  }, [pullDistance, onRefresh])

  // Record the top-most on-screen card on every settled scroll frame.
  const handleScroll = useCallback(() => {
    if (anchorFrameRef.current !== null) return
    anchorFrameRef.current = window.requestAnimationFrame(() => {
      anchorFrameRef.current = null
      const scroller = scrollerRef.current
      if (!scroller) return
      if (scroller.scrollTop <= 0) {
        writeTimelineAnchorBlock(null)
        return
      }
      const scrollerTop = scroller.getBoundingClientRect().top
      const cards = [...cardNodesRef.current].map(([itemId, node]) => {
        const rect = node.getBoundingClientRect()
        return { itemId, top: rect.top, bottom: rect.bottom }
      })
      const best = pickRssTimelineAnchorBlock(scrollerTop, cards)
      writeTimelineAnchorBlock(best ? { sourceId: selectedSourceId, ...best } : null)
    })
  }, [selectedSourceId])

  useEffect(() => () => {
    if (anchorFrameRef.current !== null) window.cancelAnimationFrame(anchorFrameRef.current)
  }, [])

  // Pull the anchor into the rendered window; it is usually well past the first
  // page, and it cannot be scrolled to while it is not in the DOM.
  const anchorIndex = pendingAnchorRef.current
    ? filteredEntries.findIndex(entry => entry.item.id === pendingAnchorRef.current?.itemId)
    : -1
  useEffect(() => {
    if (anchorIndex >= renderedCount) setRenderedCount(anchorIndex + CARD_PAGE_SIZE)
  }, [anchorIndex, renderedCount])

  // Runs on every render until it lands (or the window closes), because the
  // anchor card appears only once its backlog page has hydrated.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current
    if (!anchor) return
    if (Date.now() > anchorDeadlineRef.current) {
      pendingAnchorRef.current = null
      return
    }
    const scroller = scrollerRef.current
    const node = cardNodesRef.current.get(anchor.itemId)
    if (!scroller || !node) return
    scroller.scrollTop += (node.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - anchor.offset
    pendingAnchorRef.current = null
  })

  useEffect(() => {
    if (!loadMoreRef.current || renderedCount >= filteredEntries.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setRenderedCount(current => Math.min(current + CARD_PAGE_SIZE, filteredEntries.length))
    }, { rootMargin: '900px' })
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [renderedCount, filteredEntries.length])

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedItems = useMemo(() => entries
    .filter(entry => selectedIds.has(entry.item.id))
    .map(entry => entry.item), [entries, selectedIds])

  const leaveSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const markSelectedRead = useCallback(() => {
    if (selectedItems.length === 0) return
    setSessionHandledIds(previous => new Set([...previous, ...selectedItems.map(item => item.id)]))
    onMarkRead(selectedItems)
    leaveSelection()
  }, [selectedItems, onMarkRead, leaveSelection])

  const handleViewed = useCallback((item: RssFeedItemBlock) => {
    setSessionHandledIds(previous => new Set(previous).add(item.id))
    onViewed(item)
  }, [onViewed])

  const handleMarkRead = useCallback((item: RssFeedItemBlock) => {
    setSessionHandledIds(previous => new Set(previous).add(item.id))
    onMarkRead([item])
  }, [onMarkRead])

  // Articles the reader put back to unread. Without this the card is still on
  // screen when the mark clears, so the auto-view observer would re-mark it
  // ~900ms later and the undo would look like it did nothing.
  const [unmarkedIds, setUnmarkedIds] = useState<Set<string>>(new Set())

  const handleUnmarkRead = useCallback((item: RssFeedItemBlock) => {
    setUnmarkedIds(previous => new Set(previous).add(item.id))
    setSessionHandledIds(previous => {
      if (!previous.has(item.id)) return previous
      const next = new Set(previous)
      next.delete(item.id)
      return next
    })
    onUnmarkRead(item)
  }, [onUnmarkRead])

  const failedFeeds = useMemo(() => feeds.filter(feed => feed.error), [feeds])
  const stillLoading = loadingFeedIds.size > 0
  const showSkeleton = stillLoading && filteredEntries.length === 0

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-background pb-20 text-foreground"
    >
      <PullIndicator distance={pullDistance} refreshing={refreshing} />
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        {selectionMode ? (
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {selectedItems.length === 0 ? 'Select articles' : `${selectedItems.length} selected`}
            </span>
            <button
              type="button"
              onClick={markSelectedRead}
              disabled={selectedItems.length === 0}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              Mark read
            </button>
            <button
              type="button"
              onClick={leaveSelection}
              aria-label="Leave selection mode"
              className="ltm-touch-target shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          // Tabs and the select action share one row — the article count lived
          // here and cost a whole row for a number the panel header already shows.
          <div className="flex items-stretch gap-2 px-4 pt-2">
            <div
              role="tablist"
              aria-label="RSS sources"
              className="flex min-w-0 flex-1 gap-5 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              <SourceTab active={selectedSourceId === '__all__'} label="For you" onClick={() => changeSource('__all__')} />
              {sources.map(source => (
                <SourceTab key={source.id} active={selectedSourceId === source.id} label={source.title} onClick={() => changeSource(source.id)} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSelectionMode(true)}
              aria-label="Select articles"
              title="Select articles"
              className="ltm-touch-target -mt-0.5 shrink-0 self-start rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ListChecks className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl">
        {/* A feed that fails used to just vanish. Say so instead. */}
        {failedFeeds.length > 0 && (
          <div className="flex items-start gap-2.5 border-b border-border/60 bg-destructive/5 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-[13px] leading-5">
              <div className="font-medium text-destructive">
                {failedFeeds.length === 1
                  ? `${failedFeeds[0].feedTitle} didn't load`
                  : `${failedFeeds.length} feeds didn't load`}
              </div>
              <div className="mt-0.5 truncate text-muted-foreground">
                {failedFeeds.length === 1
                  ? failedFeeds[0].error
                  : failedFeeds.map(feed => feed.feedTitle).join(', ')}
              </div>
            </div>
          </div>
        )}

        {showSkeleton && Array.from({ length: 5 }, (_, index) => <TimelineCardSkeleton key={index} />)}

        {!showSkeleton && filteredEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-8 py-20 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-muted/40">
              <Rss className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-1 text-[15px] font-medium">
              {selectedSourceId === '__all__' ? "You're all caught up" : 'Nothing here yet'}
            </div>
            <div className="max-w-xs text-[13px] leading-5 text-muted-foreground">
              {selectedSourceId === '__all__'
                ? 'Read articles drop out of this view. Pick a source above to browse everything.'
                : 'This source has no articles in the current retention window.'}
            </div>
          </div>
        )}

        {visibleEntries.map(({ item, feedTitle }) => (
          <TimelineCard
            key={item.id}
            item={item}
            feedTitle={feedTitle}
            registerNode={registerCardNode}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onSelect={() => toggleSelection(item.id)}
            onOpen={() => onOpen(item)}
            onViewed={() => handleViewed(item)}
            onMarkRead={() => handleMarkRead(item)}
            onUnmarkRead={() => handleUnmarkRead(item)}
            autoViewSuppressed={unmarkedIds.has(item.id)}
            onToggleSaved={() => onToggleSaved(item)}
          />
        ))}

        {renderedCount < filteredEntries.length && <div ref={loadMoreRef} className="h-px" aria-label="Load more articles" />}

        {/* Feeds still arriving under an already-usable list. */}
        {stillLoading && filteredEntries.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading more sources…
          </div>
        )}
      </div>
    </div>
  )
}

/** Sits above the sticky header in the scroller's own coordinate space, so on
 *  iOS it rides the rubber-band down with the content. */
function PullIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  const active = refreshing || distance > 0
  if (!active) return null
  const armed = distance >= PULL_TRIGGER_PX / PULL_RESISTANCE
  return (
    <div
      className="pointer-events-none flex items-center justify-center overflow-hidden transition-[height] duration-150"
      style={{ height: refreshing ? 44 : Math.min(distance, PULL_MAX_PX) }}
      aria-hidden={!refreshing}
      aria-live="polite"
    >
      <Loader2
        className={cn(
          'h-4 w-4 text-muted-foreground',
          refreshing ? 'animate-spin' : 'transition-transform',
          armed && !refreshing && 'text-primary',
        )}
        style={refreshing ? undefined : { transform: `rotate(${distance * 4}deg)`, opacity: Math.min(distance / 24, 1) }}
      />
    </div>
  )
}

function SourceTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative shrink-0 px-0.5 pb-2.5 text-[15px] font-semibold transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
      )}
    >
      {label}
      {active && <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary" />}
    </button>
  )
}

function TimelineCardSkeleton() {
  return (
    <div className="flex gap-3 border-b border-border/60 px-4 py-3.5" aria-hidden>
      <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

function TimelineCard({
  item, feedTitle, registerNode, selectionMode, selected, onSelect, onOpen, onViewed,
  onMarkRead, onUnmarkRead, autoViewSuppressed, onToggleSaved,
}: {
  item: RssFeedItemBlock
  feedTitle: string
  /** Publishes the card element so the timeline can anchor its scroll to it. */
  registerNode: (itemId: string, node: HTMLElement | null) => void
  selectionMode: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onViewed: () => void
  onMarkRead: () => void
  onUnmarkRead: () => void
  /** True once the reader has put this article back to unread — stops the
   *  auto-view observer from immediately undoing that. */
  autoViewSuppressed: boolean
  onToggleSaved: () => void
}) {
  const ref = useRef<HTMLElement | null>(null)
  const setCardRef = useCallback((node: HTMLElement | null) => {
    ref.current = node
    registerNode(item.id, node)
  }, [registerNode, item.id])
  const timerRef = useRef<number | null>(null)
  const markReadTimerRef = useRef<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [viewedDuringVisit, setViewedDuringVisit] = useState(false)
  const [markedRead, setMarkedRead] = useState(false)

  useEffect(() => {
    if (autoViewSuppressed || item.viewedAt || item.dismissedAt || !ref.current || typeof IntersectionObserver === 'undefined') return
    const node = ref.current
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= VIEW_RATIO) {
        if (timerRef.current === null) timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          setViewedDuringVisit(true)
          onViewed()
        }, VIEW_DWELL_MS)
      } else if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }, { threshold: [VIEW_RATIO] })
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (markReadTimerRef.current !== null) window.clearTimeout(markReadTimerRef.current)
    }
  }, [autoViewSuppressed, item.viewedAt, item.dismissedAt, onViewed])

  const date = item.pubDate ? new Date(item.pubDate) : null
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      hour: 'numeric', minute: '2-digit',
    })
    : ''
  const wasViewed = Boolean(item.viewedAt || viewedDuringVisit)
  // Any read signal counts here — scrolling past an article marks it viewed, and
  // the reader needs to be able to undo that too, not just their own taps.
  const isMarkedRead = markedRead || item.read || Boolean(item.dismissedAt || item.viewedAt)
  const hasMore = item.title.length > 150 || item.description.length > 280

  const toggleMarkRead = () => {
    // Cancel a mark that hasn't committed yet, so a quick double-tap is a no-op
    // rather than a write followed by an undo.
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current)
      markReadTimerRef.current = null
      setMarkedRead(false)
      return
    }
    if (isMarkedRead) {
      setMarkedRead(false)
      setViewedDuringVisit(false)
      onUnmarkRead()
      return
    }
    setMarkedRead(true)
    markReadTimerRef.current = window.setTimeout(() => {
      markReadTimerRef.current = null
      onMarkRead()
    }, 360)
  }

  return (
    <article
      ref={setCardRef}
      className={cn(
        'relative flex gap-3 border-b border-border/60 px-4 py-3.5 transition-colors',
        selected && 'bg-primary/5',
        // Handled articles recede without disappearing — the reader can still
        // see what they just dealt with.
        !selected && isMarkedRead && 'opacity-55',
      )}
    >
      <div className="shrink-0 pt-0.5">
        {selectionMode ? (
          <button
            type="button"
            onClick={onSelect}
            aria-label={selected ? 'Deselect article' : 'Select article'}
            className={cn(
              'ltm-touch-target grid h-8 w-8 place-items-center rounded-full border transition-colors',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        ) : <SourceAvatar item={item} feedTitle={feedTitle} />}
      </div>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={selectionMode ? onSelect : onOpen} className="block w-full text-left">
          <div className="flex items-center gap-1.5 text-[13px] leading-5">
            <span className="min-w-0 truncate font-semibold">{feedTitle}</span>
            {dateLabel && (
              <>
                <span aria-hidden className="text-muted-foreground">·</span>
                <time className="shrink-0 text-muted-foreground">{dateLabel}</time>
              </>
            )}
            {!wasViewed && (
              <span aria-label="Unread" className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />
            )}
            {wasViewed && <Eye aria-label="Viewed" className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/70" />}
          </div>

          <div className="mt-1 flex gap-3">
            <div className="min-w-0 flex-1">
              <h3 className={cn(
                'text-[16px] font-semibold leading-[1.35] tracking-[-0.01em]',
                !expanded && 'line-clamp-3',
              )}>
                {item.title || '(Untitled)'}
              </h3>
              {/* Collapsed, the teaser sits beside the thumbnail. Expanded, it
                  moves below (see the full-width copy) so the long text uses the
                  whole card instead of wrapping in the narrow column the image
                  leaves behind. */}
              {item.description && !expanded && (
                // No `whitespace-pre-wrap`: WebKit silently refuses to apply
                // -webkit-line-clamp when white-space is pre-wrap, which let feed
                // descriptions run to full length and made cards enormous.
                // Normal whitespace handling also collapses the ragged newlines
                // that come out of stripped feed HTML.
                <p className="mt-1 line-clamp-2 text-[14px] leading-[1.45] text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>
            {item.imageUrl && <ArticleThumbnail url={item.imageUrl} />}
          </div>

          {item.description && expanded && (
            <p className="mt-2 text-[14px] leading-[1.5] text-muted-foreground">
              {item.description}
            </p>
          )}
        </button>

        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(current => !current)}
            className="mt-1 text-[14px] font-medium text-primary"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {!selectionMode && (
          <div className="mt-2 flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={toggleMarkRead}
              aria-pressed={isMarkedRead}
              title={isMarkedRead ? 'Marked read — tap to put back to unread' : 'Mark read'}
              className={cn(
                'ltm-touch-target inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] transition-all duration-200 hover:bg-muted hover:text-foreground active:scale-95',
                isMarkedRead && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              )}
            >
              {isMarkedRead
                ? <Check className="h-4 w-4 scale-110 transition-transform duration-200" />
                : <Circle className="h-4 w-4" />}
              {isMarkedRead ? 'Read' : 'Mark read'}
            </button>
            <button
              type="button"
              onClick={onToggleSaved}
              title={item.keep ? 'Remove from saved' : 'Save article'}
              aria-pressed={Boolean(item.keep)}
              className={cn(
                'ltm-touch-target ml-auto rounded-full p-1.5 hover:bg-muted',
                item.keep ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Bookmark className={cn('h-4 w-4', item.keep && 'fill-current')} />
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

/** Lead image. Collapses entirely if the URL 404s or the host blocks hotlinking,
 *  so a broken feed never leaves a torn box in the list. */
function ArticleThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-[76px] w-[76px] shrink-0 rounded-xl border border-border/60 object-cover"
    />
  )
}

/** Origins whose favicon we already tried and failed to load. Module-scoped so
 *  a source that has no favicon costs one request per session, not one per
 *  card — the old per-card guess produced a 404 storm while scrolling. */
const failedFaviconOrigins = new Set<string>()

function SourceAvatar({ item, feedTitle }: { item: RssFeedItemBlock; feedTitle: string }) {
  const origin = useMemo(() => {
    try { return new URL(item.link).origin } catch { return null }
  }, [item.link])
  const [failed, setFailed] = useState(() => (origin ? failedFaviconOrigins.has(origin) : true))
  const monogram = feedTitle.trim().slice(0, 1).toUpperCase()
  // Deterministic hue per source, so each feed keeps one identity down the list.
  const hue = useMemo(() => {
    let hash = 0
    for (let index = 0; index < feedTitle.length; index++) {
      hash = (hash * 31 + feedTitle.charCodeAt(index)) | 0
    }
    return Math.abs(hash) % 360
  }, [feedTitle])

  return (
    <span
      title={feedTitle}
      className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border/60 text-[13px] font-semibold"
      style={failed ? { backgroundColor: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 55% 28%)` } : undefined}
    >
      {origin && !failed ? (
        <img
          src={`${origin}/favicon.ico`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            failedFaviconOrigins.add(origin)
            setFailed(true)
          }}
          className="h-5 w-5"
        />
      ) : (monogram || <Rss className="h-4 w-4 text-muted-foreground" />)}
    </span>
  )
}
