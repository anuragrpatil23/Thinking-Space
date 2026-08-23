import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, ExternalLink, Loader2, Rss, Undo2 } from 'lucide-react'
import {
  buildUnreadInboxItemsBlock,
  rssSourceHueBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import RssSourceAvatarBlock from '@/components/lego_blocks/units/RssSourceAvatarBlock'
import { cn } from '@/lib/utils'

/** How many cards either side of the active one stay mounted. Every card is a
 *  full viewport with a full-bleed image, so an unwindowed list is the exact
 *  shape IOS-MEMORY.md warns about — decoded bitmaps for the whole backlog is
 *  a WebContent kill, not a slow scroll. Two is enough that a fast flick never
 *  lands on an unmounted card. */
const WINDOW_RADIUS = 2

/** Read marks are buffered and flushed in batches rather than written per
 *  swipe: a fast pass through the inbox would otherwise be one vault write per
 *  flick. Flushed on this count, and unconditionally on exit — never on a
 *  timer, per ENERGY.md. */
const READ_FLUSH_BATCH = 4

interface RssReelsBlockProps {
  feeds: RssFeedResultBlock[]
  /** Articles read earlier in this session — they stay pinned in the queue so
   *  the deck does not reshuffle under the reader mid-swipe. */
  sessionReadIds: Set<string>
  loadingFeedIds: Set<string>
  onOpen: (item: RssFeedItemBlock) => void
  onMarkRead: (items: RssFeedItemBlock[]) => void
  onUnmarkRead: (item: RssFeedItemBlock) => void
  onToggleSaved: (item: RssFeedItemBlock) => void
}

/**
 * Full-screen, one-article-per-card vertical deck — the "reels" reading mode.
 *
 * The point is not the aesthetic: it is that read state stops being a guess.
 * The timeline infers a read from a 60%-visibility dwell timer, which is
 * ambiguous enough that it needs unmark-suppression machinery to stay honest.
 * Here a card owns the whole viewport, so *advancing past it* is an
 * unambiguous disposition — the article was on screen alone, and the reader
 * chose to leave. Nothing is marked while a card is centred; the mark is made
 * for the card you just left.
 */
export default function RssReelsBlock({
  feeds,
  sessionReadIds,
  loadingFeedIds,
  onOpen,
  onMarkRead,
  onUnmarkRead,
  onToggleSaved,
}: RssReelsBlockProps) {
  const entries = useMemo(
    () => buildUnreadInboxItemsBlock(feeds, sessionReadIds),
    [feeds, sessionReadIds],
  )
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const cardNodesRef = useRef(new Map<number, HTMLElement>())
  const [activeIndex, setActiveIndex] = useState(0)

  // Buffered read marks, keyed by id so a card left twice is written once.
  const pendingReadRef = useRef(new Map<string, RssFeedItemBlock>())
  // Articles the reader explicitly put back to unread — they must survive the
  // flush, otherwise leaving the card would immediately undo the undo.
  const keptUnreadRef = useRef(new Set<string>())
  const onMarkReadRef = useRef(onMarkRead)
  onMarkReadRef.current = onMarkRead

  const flushReads = useCallback(() => {
    const pending = [...pendingReadRef.current.values()]
      .filter(item => !keptUnreadRef.current.has(item.id))
    pendingReadRef.current.clear()
    if (pending.length > 0) onMarkReadRef.current(pending)
  }, [])

  const queueRead = useCallback((item: RssFeedItemBlock) => {
    if (item.dismissedAt || keptUnreadRef.current.has(item.id)) return
    pendingReadRef.current.set(item.id, item)
    if (pendingReadRef.current.size >= READ_FLUSH_BATCH) flushReads()
  }, [flushReads])

  // Leaving the mode is a commit point — anything still buffered is a real
  // disposition the reader made, and dropping it would silently lose reads.
  useEffect(() => () => { flushReads() }, [flushReads])

  const registerCardNode = useCallback((index: number, node: HTMLElement | null) => {
    if (node) cardNodesRef.current.set(index, node)
    else cardNodesRef.current.delete(index)
  }, [])

  // Which card owns the viewport. Snap points mean exactly one card clears the
  // majority threshold at rest, so this needs no dwell timer — the observer
  // fires once per settled card.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(observed => {
      for (const entry of observed) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue
        const index = Number((entry.target as HTMLElement).dataset.reelIndex)
        if (Number.isNaN(index) || index === activeIndexRef.current) continue
        // Everything strictly between where we were and where we landed was
        // passed over — a fast flick skips cards, and skipping is a decision
        // just as much as swiping one at a time.
        const from = activeIndexRef.current
        const step = index > from ? 1 : -1
        if (step === 1) {
          for (let i = from; i < index; i++) {
            const passed = entriesRef.current[i]
            if (passed) queueRead(passed.item)
          }
        }
        setActiveIndex(index)
      }
    }, { root: scroller, threshold: [0.6] })
    for (const node of cardNodesRef.current.values()) observer.observe(node)
    return () => observer.disconnect()
    // Re-observes when the rendered window changes, which is how newly mounted
    // cards get picked up.
  }, [entries.length, activeIndex, queueRead])

  const handleKeepUnread = useCallback((item: RssFeedItemBlock) => {
    keptUnreadRef.current.add(item.id)
    pendingReadRef.current.delete(item.id)
    onUnmarkRead(item)
  }, [onUnmarkRead])

  const loading = loadingFeedIds.size > 0

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading your feeds…</p>
          </>
        ) : (
          <>
            <div className="grid h-14 w-14 place-items-center rounded-full bg-muted/60">
              <Check className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Inbox clear</p>
            <p className="text-xs text-muted-foreground">
              Nothing unread. Pull a refresh from the timeline view to fetch more.
            </p>
          </>
        )}
      </div>
    )
  }

  const windowStart = Math.max(0, activeIndex - WINDOW_RADIUS)
  const windowEnd = Math.min(entries.length - 1, activeIndex + WINDOW_RADIUS)

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        className="ltm-reels-scroller h-full overflow-y-auto overscroll-contain"
      >
        {entries.map((entry, index) => {
          const mounted = index >= windowStart && index <= windowEnd
          return (
            <section
              key={entry.item.id}
              data-reel-index={index}
              ref={node => registerCardNode(index, node)}
              className="ltm-reels-card relative flex h-full w-full flex-col"
            >
              {mounted ? (
                <ReelCard
                  item={entry.item}
                  feedTitle={entry.feedTitle}
                  active={index === activeIndex}
                  position={index + 1}
                  total={entries.length}
                  onOpen={() => onOpen(entry.item)}
                  onToggleSaved={() => onToggleSaved(entry.item)}
                  onKeepUnread={() => handleKeepUnread(entry.item)}
                  keptUnread={keptUnreadRef.current.has(entry.item.id)}
                />
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** One article, full viewport. */
function ReelCard({
  item, feedTitle, active, position, total, onOpen, onToggleSaved, onKeepUnread, keptUnread,
}: {
  item: RssFeedItemBlock
  feedTitle: string
  /** Only the centred card decodes its image, so a flick past a card never
   *  pays for a bitmap the reader did not stop on. */
  active: boolean
  position: number
  total: number
  onOpen: () => void
  onToggleSaved: () => void
  onKeepUnread: () => void
  keptUnread: boolean
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(item.imageUrl) && !imageFailed && active
  // Text-only feeds are the common case, not the exception — a reels card that
  // only works with art would look broken for most sources. The fallback is a
  // deliberate typographic treatment on the source's own hue, not a grey box.
  const hue = useMemo(() => rssSourceHueBlock(feedTitle), [feedTitle])
  const date = item.pubDate ? new Date(item.pubDate) : null
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      hour: 'numeric', minute: '2-digit',
    })
    : ''

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 overflow-hidden">
        {showImage ? (
          <>
            <img
              src={item.imageUrl ?? ''}
              alt=""
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
            {/* Legibility scrim — the text sits on unpredictable photography,
                so the gradient is what guarantees contrast, not the image. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/25" />
          </>
        ) : (
          <div
            className="h-full w-full"
            style={{
              background:
                `linear-gradient(160deg, hsl(${hue} 62% 32%) 0%, hsl(${hue} 55% 16%) 55%, hsl(${(hue + 28) % 360} 45% 10%) 100%)`,
            }}
          />
        )}
      </div>

      {/* Content */}
      <div className="relative flex min-h-0 flex-1 flex-col justify-end px-5 pb-10 pt-16 text-white">
        <div className="flex items-center gap-2 text-[13px]">
          <RssSourceAvatarBlock
            link={item.link}
            feedTitle={feedTitle}
            className="h-7 w-7 border-white/25 text-[11px]"
            imgClassName="h-4 w-4"
          />
          <span className="min-w-0 truncate font-semibold">{feedTitle}</span>
          {dateLabel && (
            <>
              <span aria-hidden className="text-white/50">·</span>
              <time className="shrink-0 text-white/70">{dateLabel}</time>
            </>
          )}
        </div>

        <button type="button" onClick={onOpen} className="mt-3 block text-left">
          <h2 className={cn(
            'font-semibold leading-[1.15] tracking-[-0.01em]',
            // Short headlines get to be posters; long ones step down so they
            // still fit without truncation doing the design's job.
            item.title.length < 70 ? 'text-[30px]' : item.title.length < 130 ? 'text-[24px]' : 'text-[20px]',
          )}>
            {item.title}
          </h2>
          {item.description && (
            <p className="ltm-reels-clamp mt-3 text-[15px] leading-relaxed text-white/80">
              {item.description}
            </p>
          )}
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[13px] font-medium backdrop-blur-sm">
            Read article <ExternalLink className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* Action rail — the familiar reels affordance, and deliberately buttons
          rather than horizontal swipes: a left/right drag here would fight the
          iOS interactive-pop edge gesture. */}
      <div className="absolute bottom-28 right-3 flex flex-col items-center gap-4 text-white">
        <RailButton
          label={item.keep ? 'Saved' : 'Save'}
          active={item.keep}
          onClick={onToggleSaved}
        >
          <Bookmark className={cn('h-5 w-5', item.keep && 'fill-current')} />
        </RailButton>
        <RailButton
          label={keptUnread ? 'Kept unread' : 'Keep unread'}
          active={keptUnread}
          onClick={onKeepUnread}
        >
          <Undo2 className="h-5 w-5" />
        </RailButton>
        <div className="flex flex-col items-center gap-1 text-[10px] tabular-nums text-white/60">
          <Rss className="h-3.5 w-3.5" />
          {position}/{total}
        </div>
      </div>
    </>
  )
}

function RailButton({
  label, active, onClick, children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="ltm-touch-target flex flex-col items-center gap-1"
    >
      <span className={cn(
        'grid h-11 w-11 place-items-center rounded-full border backdrop-blur-sm transition-colors',
        active ? 'border-white/70 bg-white/25' : 'border-white/20 bg-black/25',
      )}>
        {children}
      </span>
      <span className="text-[10px] text-white/70">{label}</span>
    </button>
  )
}
