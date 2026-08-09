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
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 pb-20">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="flex min-w-0 items-center justify-between px-3 pt-2">
          <div className="text-xs text-muted-foreground">
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
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
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
      <div className="mx-auto max-w-2xl space-y-3 p-3">
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
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
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
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
    : ''
  const wasSeen = Boolean(item.viewedAt || item.dismissedAt)

  return (
    <article ref={ref} className={cn(
      'relative overflow-hidden rounded-xl border bg-background shadow-sm transition-colors',
      selected && 'border-primary ring-2 ring-primary/25',
      wasSeen && !selected && 'border-border/60 opacity-70',
    )}>
      <button type="button" onClick={selectionMode ? onSelect : onOpen} className="block w-full p-4 text-left active:bg-muted/40">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {selectionMode ? <span className={cn('grid h-5 w-5 place-items-center rounded-full border', selected && 'border-primary bg-primary text-primary-foreground')}>
            {selected && <Check className="h-3.5 w-3.5" />}
          </span> : <Rss className="h-3.5 w-3.5 text-orange-400" />}
          <span className="min-w-0 flex-1 truncate">{feedTitle}</span>
          {dateLabel && <time>{dateLabel}</time>}
          {wasSeen && !selectionMode && <Eye className="h-3.5 w-3.5" aria-label="Viewed" />}
        </div>
        <h3 className="text-[17px] font-semibold leading-snug text-foreground">{item.title || '(Untitled)'}</h3>
        {item.description && <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">{item.description}</div>}
      </button>
      {!selectionMode && <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
        <button type="button" onClick={onMarkRead} className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">Mark read</button>
        <button type="button" onClick={onToggleSaved} className={cn('ml-auto rounded-md p-1.5 hover:bg-muted', item.keep ? 'text-amber-500' : 'text-muted-foreground')} title={item.keep ? 'Remove from saved' : 'Save article'}>
          <Bookmark className={cn('h-4 w-4', item.keep && 'fill-current')} />
        </button>
      </div>}
    </article>
  )
}
