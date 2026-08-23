import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, ExternalLink, Loader2, Undo2 } from 'lucide-react'
import {
  buildUnreadInboxItemsBlock,
  rssSourceHueBlock,
  type RssFeedItemBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import RssSourceAvatarBlock from '@/components/lego_blocks/units/RssSourceAvatarBlock'
import {
  hasTagBlock,
  tagColorClassBlock,
  tagColorStyleBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import { cn } from '@/lib/utils'

/** How many cards either side of the active one stay mounted. Every card is a
 *  full viewport with a full-bleed image, so an unwindowed list is the exact
 *  shape IOS-MEMORY.md warns about — decoded bitmaps for the whole backlog is
 *  a WebContent kill, not a slow scroll. Two is enough that a fast flick never
 *  lands on an unmounted card. */
const WINDOW_RADIUS = 2

interface RssReelsBlockProps {
  feeds: RssFeedResultBlock[]
  /** Articles read earlier in this session — they stay pinned in the queue so
   *  the deck does not reshuffle under the reader mid-swipe. */
  sessionReadIds: Set<string>
  loadingFeedIds: Set<string>
  /** Tag vocabulary from RSS preferences — the chips the card offers. */
  presetTags: string[]
  tagColors: Record<string, string>
  onOpen: (item: RssFeedItemBlock) => void
  onMarkRead: (items: RssFeedItemBlock[]) => void
  onUnmarkRead: (item: RssFeedItemBlock) => void
  onToggleSaved: (item: RssFeedItemBlock) => void
  onToggleTag: (item: RssFeedItemBlock, tag: string) => void
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
  presetTags,
  tagColors,
  onOpen,
  onMarkRead,
  onUnmarkRead,
  onToggleSaved,
  onToggleTag,
}: RssReelsBlockProps) {
  const entries = useMemo(
    () => buildUnreadInboxItemsBlock(feeds, sessionReadIds),
    [feeds, sessionReadIds],
  )
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const cardNodesRef = useRef(new Map<number, HTMLElement>())
  const [activeIndex, setActiveIndex] = useState(0)

  // Articles the reader explicitly put back to unread — leaving such a card
  // must not immediately undo the undo.
  const keptUnreadRef = useRef(new Set<string>())
  const onMarkReadRef = useRef(onMarkRead)
  onMarkReadRef.current = onMarkRead

  /** Commit the cards just left behind. Called with everything passed in one
   *  scroll, so a fast flick over several cards is still a single write. */
  const commitReads = useCallback((items: RssFeedItemBlock[]) => {
    const pending = items.filter(item => !item.dismissedAt && !keptUnreadRef.current.has(item.id))
    if (pending.length > 0) onMarkReadRef.current(pending)
  }, [])

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
        if (index > from) {
          const passed: RssFeedItemBlock[] = []
          for (let i = from; i < index; i++) {
            const entry = entriesRef.current[i]
            if (entry) passed.push(entry.item)
          }
          commitReads(passed)
        }
        setActiveIndex(index)
      }
    }, { root: scroller, threshold: [0.6] })
    for (const node of cardNodesRef.current.values()) observer.observe(node)
    return () => observer.disconnect()
    // Re-observes when the rendered window changes, which is how newly mounted
    // cards get picked up.
  }, [entries.length, activeIndex, commitReads])

  const handleKeepUnread = useCallback((item: RssFeedItemBlock) => {
    keptUnreadRef.current.add(item.id)
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
                  presetTags={presetTags}
                  tagColors={tagColors}
                  onToggleTag={(tag) => onToggleTag(entry.item, tag)}
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
  presetTags, tagColors, onToggleTag,
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
  presetTags: string[]
  tagColors: Record<string, string>
  onToggleTag: (tag: string) => void
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
                so the gradient is what guarantees contrast, not the image.
                Dark end is at the top, where the copy now lives. */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/90 via-black/55 to-black/25" />
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
      <div className="relative flex min-h-0 flex-1 flex-col justify-start overflow-hidden pb-28 pl-5 pr-16 pt-6 text-white">
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
          {/* Position in the queue. Reading an inbox down is a finite task, so
              the card says how much of it is left — this is the one number that
              makes a deck feel bounded rather than endless. */}
          <span className="ml-auto shrink-0 rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur-sm">
            {position}/{total}
          </span>
        </div>

        <button type="button" onClick={onOpen} className="mt-3 flex min-h-0 flex-1 flex-col text-left">
          <h2 className={cn(
            'shrink-0 font-semibold leading-[1.15] tracking-[-0.01em]',
            // Short headlines get to be posters; long ones step down so they
            // still fit without truncation doing the design's job.
            item.title.length < 70 ? 'text-[30px]' : item.title.length < 130 ? 'text-[24px]' : 'text-[20px]',
          )}>
            {item.title}
          </h2>
          {item.description && (
            // Full-text feeds (Slashdot and friends) put the whole article in
            // `description` — the parser already prefers `content` over the
            // summary. A fixed line clamp threw that away, so the body claims
            // whatever height the card has left and fades out where it runs
            // over, which is as much as fits without a second scroll axis.
            <p className="ltm-reels-body mt-3 min-h-0 flex-1 overflow-hidden text-[15px] leading-relaxed text-white/80">
              {item.description}
            </p>
          )}
          <span className="mt-4 inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[13px] font-medium backdrop-blur-sm">
            Read article <ExternalLink className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* Tag bar, pinned to the space the copy vacated when it moved to the top.
          Pinned rather than flowed because a long headline would otherwise push
          the chips off the card, and a tag you cannot reach is not a feature. */}
      <div className="absolute inset-x-0 bottom-0 px-5 pb-8 pr-20">
        {/* Tag bar. Deliberately outside the open button above — a tag tap files
            the article, it does not open it. `color-scheme: dark` is what makes
            the shared chip palette correct here: tagColorStyleBlock resolves via
            light-dark(), and this card is dark regardless of the app theme, so
            without it a light-themed app would paint light chips on a dark card. */}
        {presetTags.length > 0 && (
          <div className="ltm-reels-tags flex flex-wrap gap-1.5" style={{ colorScheme: 'dark' }}>
            {presetTags.map(tag => {
              const selected = hasTagBlock(item.tags ?? [], tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  aria-pressed={selected}
                  title={selected ? `Remove ${tag}` : `Add ${tag}`}
                  className={cn(
                    'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    tagColorClassBlock(tag, selected ? 'selected' : 'unselected'),
                    // The unselected chip is an outline over photography, which
                    // the palette never had to survive — lift it so it reads on
                    // a bright image without competing with a selected chip.
                    !selected && 'border-white/35 bg-black/25 text-white/85 backdrop-blur-sm',
                  )}
                  style={tagColorStyleBlock(tag, selected ? 'selected' : 'unselected', tagColors[tagLookupKeyBlock(tag)])}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        )}
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
