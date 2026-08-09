import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, Eye, ListChecks, Rss, X } from 'lucide-react'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { cn } from '@/lib/utils'

const VIEW_RATIO = 0.6
const VIEW_DWELL_MS = 900
const INITIAL_CARD_COUNT = 12
const CARD_PAGE_SIZE = 8

interface RssTimelineBlockProps {
  feeds: RssFeedResultBlock[]
  onOpen: (item: RssFeedItemBlock) => void
  onViewed: (item: RssFeedItemBlock) => void
  onMarkRead: (items: RssFeedItemBlock[]) => void
  onToggleSaved: (item: RssFeedItemBlock) => void
}

/** A deliberately spacious, low-input RSS surface. It is a view over the same
 * feed model as the compact explorer—not a second reader implementation. */
export default function RssTimelineBlock({
  feeds,
  onOpen,
  onViewed,
  onMarkRead,
  onToggleSaved,
}: RssTimelineBlockProps) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renderedCount, setRenderedCount] = useState(INITIAL_CARD_COUNT)
  const [selectedSourceId, setSelectedSourceId] = useState<string>('__all__')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(() => feeds.flatMap(feed => feed.items.map(item => ({ item, feedTitle: feed.feedTitle })))
    .sort((a, b) => new Date(b.item.pubDate ?? 0).getTime() - new Date(a.item.pubDate ?? 0).getTime()), [feeds])
  const sources = useMemo(() => feeds.map(feed => ({ id: feed.feedId, title: feed.feedTitle })), [feeds])
  const filteredEntries = selectedSourceId === '__all__'
    ? entries
    : entries.filter(entry => entry.item.feedId === selectedSourceId)
  const visibleEntries = filteredEntries.slice(0, renderedCount)

  useEffect(() => {
    setRenderedCount(INITIAL_CARD_COUNT)
  }, [selectedSourceId, entries.length])

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
    onMarkRead(selectedItems)
    leaveSelection()
  }, [selectedItems, onMarkRead, leaveSelection])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-black pb-20 pt-[calc(var(--ltm-safe-top,0px)+0.25rem)] text-zinc-100">
      <div className="sticky top-[calc(var(--ltm-safe-top,0px)+0.25rem)] z-10 border-b border-white/10 bg-black/95 backdrop-blur">
        <div className="flex min-w-0 items-center justify-between px-3 pt-2">
          <div className="text-xs text-zinc-500">
            {filteredEntries.length} article{filteredEntries.length === 1 ? '' : 's'} · scroll to mark viewed
          </div>
        {selectionMode ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={markSelectedRead} disabled={selectedItems.length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
              <Check className="h-3.5 w-3.5" /> Mark read {selectedItems.length > 0 && selectedItems.length}
            </button>
            <button type="button" onClick={leaveSelection} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSelectionMode(true)} title="Select articles"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
            <ListChecks className="h-4 w-4" />
          </button>
        )}
        </div>
        <div role="tablist" aria-label="RSS sources" className="mt-2 flex gap-5 overflow-x-auto px-3">
          <SourceTab active={selectedSourceId === '__all__'} label="For you" onClick={() => setSelectedSourceId('__all__')} />
          {sources.map(source => (
            <SourceTab key={source.id} active={selectedSourceId === source.id} label={source.title} onClick={() => setSelectedSourceId(source.id)} />
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-2xl">
        {visibleEntries.map(({ item, feedTitle }) => (
          <TimelineCard
            key={item.id}
            item={item}
            feedTitle={feedTitle}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onSelect={() => toggleSelection(item.id)}
            onOpen={() => onOpen(item)}
            onViewed={() => onViewed(item)}
            onMarkRead={() => onMarkRead([item])}
            onToggleSaved={() => onToggleSaved(item)}
          />
        ))}
        {renderedCount < filteredEntries.length && <div ref={loadMoreRef} className="h-px" aria-label="Load more articles" />}
      </div>
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
        'relative shrink-0 px-0.5 pb-3 text-[15px] font-semibold transition-colors',
        active ? 'text-white' : 'text-zinc-500',
      )}
    >
      {label}
      {active && <span className="absolute inset-x-0 -bottom-px h-1 rounded-full bg-white" />}
    </button>
  )
}

function TimelineCard({
  item, feedTitle, selectionMode, selected, onSelect, onOpen, onViewed, onMarkRead, onToggleSaved,
}: {
  item: RssFeedItemBlock
  feedTitle: string
  selectionMode: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onViewed: () => void
  onMarkRead: () => void
  onToggleSaved: () => void
}) {
  const ref = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (item.viewedAt || item.dismissedAt || !ref.current || typeof IntersectionObserver === 'undefined') return
    const node = ref.current
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= VIEW_RATIO) {
        if (timerRef.current === null) timerRef.current = window.setTimeout(() => {
          timerRef.current = null
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
    }
  }, [item.viewedAt, item.dismissedAt, onViewed])

  const date = item.pubDate ? new Date(item.pubDate) : null
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      hour: 'numeric', minute: '2-digit',
    })
    : ''
  const wasSeen = Boolean(item.viewedAt || item.dismissedAt)
  const hasMore = item.description.length > 520

  return (
    <article ref={ref} className={cn(
      'relative flex gap-3 border-b border-white/10 bg-black px-4 py-3 transition-colors',
      selected && 'bg-white/10',
      wasSeen && !selected && 'opacity-70',
    )}>
      <div className="shrink-0 pt-0.5">
        {selectionMode ? <button type="button" onClick={onSelect} className={cn('grid h-8 w-8 place-items-center rounded-full border border-zinc-500', selected && 'border-sky-500 bg-sky-500 text-white')}>
            {selected && <Check className="h-3.5 w-3.5" />}
          </button> : <SourceAvatar item={item} feedTitle={feedTitle} />}
      </div>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={selectionMode ? onSelect : onOpen} className="block w-full text-left active:opacity-75">
          <div className="flex items-center gap-1 text-[14px] leading-5">
            <span className="min-w-0 truncate font-semibold text-white">{feedTitle}</span>
            <span className="text-zinc-500">·</span>
            {dateLabel && <time className="shrink-0 text-zinc-500">{dateLabel}</time>}
            {wasSeen && !selectionMode && <Eye className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Viewed" />}
          </div>
          <h3 className="mt-0.5 text-[17px] font-semibold leading-snug text-white">{item.title || '(Untitled)'}</h3>
          {item.description && <div className={cn('mt-1 whitespace-pre-wrap text-[15px] leading-[1.45] text-zinc-300', !expanded && 'line-clamp-6')}>{item.description}</div>}
        </button>
        {hasMore && !expanded && <button type="button" onClick={() => setExpanded(true)} className="mt-0.5 text-[15px] text-sky-500">Show more</button>}
        {expanded && hasMore && <button type="button" onClick={() => setExpanded(false)} className="mt-0.5 text-[15px] text-sky-500">Show less</button>}
        {!selectionMode && <div className="mt-2 flex items-center gap-1 text-zinc-500">
          <button type="button" onClick={onMarkRead} className="rounded-full px-2 py-1 text-[12px] hover:bg-white/10 hover:text-white">Mark read</button>
          <button type="button" onClick={onToggleSaved} className={cn('ml-auto rounded-full p-1.5 hover:bg-white/10', item.keep ? 'text-sky-500' : 'text-zinc-500')} title={item.keep ? 'Remove from saved' : 'Save article'}>
            <Bookmark className={cn('h-4 w-4', item.keep && 'fill-current')} />
          </button>
        </div>}
      </div>
    </article>
  )
}

function SourceAvatar({ item, feedTitle }: { item: RssFeedItemBlock; feedTitle: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  let iconUrl: string | null = null
  try {
    const url = new URL(item.link)
    iconUrl = `${url.origin}/favicon.ico`
  } catch { /* fall back to the source monogram */ }
  return (
    <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-zinc-800 text-sm font-semibold text-zinc-200" title={feedTitle}>
      {iconUrl && !imageFailed
        ? <img src={iconUrl} alt="" onError={() => setImageFailed(true)} className="h-5 w-5" />
        : <span>{feedTitle.trim().slice(0, 1).toUpperCase() || <Rss className="h-4 w-4" />}</span>}
    </span>
  )
}
