import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, CalendarDays, Check, ExternalLink, Loader2, Undo2 } from 'lucide-react'
import {
  buildRssDeckEntriesBlock,
  buildRssTimelineDayGroupsBlock,
  rssDayDateLabelBlock,
  rssDeckDayCountsBlock,
  rssItemDayKeyBlock,
  rssSourceHueBlock,
  type RssFeedItemBlock,
  type RssDeckFilterBlock,
  type RssFeedResultBlock,
  type RssTimelineDayGroupBlock,
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

const DECK_FILTER_KEY = 'ltm-rss-reels-filter'

interface RssReelsBlockProps {
  feeds: RssFeedResultBlock[]
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
  loadingFeedIds,
  presetTags,
  tagColors,
  onOpen,
  onMarkRead,
  onUnmarkRead,
  onToggleSaved,
  onToggleTag,
}: RssReelsBlockProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const cardNodesRef = useRef(new Map<number, HTMLElement>())
  const [activeIndex, setActiveIndex] = useState(0)

  const [filter, setFilter] = useState<RssDeckFilterBlock>(() => {
    try {
      const saved = localStorage.getItem(DECK_FILTER_KEY)
      if (saved === 'all' || saved === 'unread') return saved
    } catch { /* storage is optional */ }
    return 'all'
  })

  // Membership is an ADMISSION SET, not a live predicate. Once an article is in
  // the deck it stays until the filter changes, so reading a card never removes
  // it from under the reader — the old deck was `unread ∪ read-this-session`,
  // which is neither a stable stack nor a true unread pile, and its size meant
  // nothing. Admission also has to be incremental: cached backlog pages stream
  // in for seconds after open, and a snapshot taken at mount would miss them.
  const admittedRef = useRef<Set<string>>(new Set())
  const [admissionTick, setAdmissionTick] = useState(0)

  const allEntries = useMemo(() => buildRssDeckEntriesBlock(feeds), [feeds])

  useEffect(() => {
    let admittedAny = false
    for (const entry of allEntries) {
      if (admittedRef.current.has(entry.item.id)) continue
      // `unread` admits on the state the article had when it first appeared —
      // that is what makes the pile drain monotonically instead of churning.
      if (filter === 'unread' && entry.item.read) continue
      admittedRef.current.add(entry.item.id)
      admittedAny = true
    }
    if (admittedAny) setAdmissionTick(tick => tick + 1)
  }, [allEntries, filter])

  const entries = useMemo(
    () => allEntries.filter(entry => admittedRef.current.has(entry.item.id)),
    // admissionTick is the dependency that matters — admittedRef is a ref so
    // that admission does not re-run this memo mid-pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEntries, admissionTick],
  )

  const changeFilter = useCallback((next: RssDeckFilterBlock) => {
    // A filter change is the one moment the deck is allowed to be rebuilt.
    admittedRef.current = new Set()
    setAdmissionTick(tick => tick + 1)
    setActiveIndex(0)
    setFilter(next)
    try { localStorage.setItem(DECK_FILTER_KEY, next) } catch { /* optional */ }
  }, [])

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

  // Day stacks. The deck is chronological, so a day is a contiguous run of
  // cards — the same grouping the timeline's date filter uses, over the same
  // helper, so the two surfaces can never disagree about where a day starts.
  const dayGroups = useMemo(
    () => buildRssTimelineDayGroupsBlock(entries.map(entry => entry.item.pubDate)),
    [entries],
  )
  const activeDayKey = rssItemDayKeyBlock(entries[activeIndex]?.item.pubDate ?? null) ?? '__undated__'
  const activeGroup = dayGroups.find(group => group.key === activeDayKey) ?? null

  /** Unread and total per day, both over the deck as it stands. The stack size
   *  is fixed; only the unread half moves, and it only ever moves down. */
  const dayCounts = useMemo(() => rssDeckDayCountsBlock(entries), [entries])
  const activeCounts = dayCounts.get(activeDayKey) ?? { unread: 0, total: 0 }

  /** Position within the day's stack, not the whole deck. A denominator of
   *  12,000 says nothing; "4 of 47 on Friday" is a task you can finish. */
  const positionInDay = activeGroup ? activeIndex - activeGroup.firstIndex + 1 : 0

  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const pendingJumpRef = useRef<number | null>(null)

  const jumpToDay = useCallback((group: RssTimelineDayGroupBlock) => {
    setDatePickerOpen(false)
    // Mount the target's window first — the card sections always render, but
    // their content is windowed, so jumping without this lands on a blank card
    // for a frame.
    setActiveIndex(group.firstIndex)
    pendingJumpRef.current = group.firstIndex
  }, [])

  useEffect(() => {
    const index = pendingJumpRef.current
    if (index === null) return
    pendingJumpRef.current = null
    cardNodesRef.current.get(index)?.scrollIntoView({ block: 'start' })
  }, [activeIndex])

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
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Date bar. Always visible, because "which day am I in" is the question
          a chronological deck constantly raises and a full-screen card gives no
          other way to answer — the timeline can show day headers between cards,
          reels cannot. The count is the stack's, not the whole inbox's. */}
      <div className="shrink-0 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setDatePickerOpen(open => !open)}
          aria-expanded={datePickerOpen}
          aria-label="Jump to a date"
          className="flex w-full items-center gap-2 px-4 py-2 text-left"
        >
          <CalendarDays className={cn('h-4 w-4 shrink-0', datePickerOpen ? 'text-foreground' : 'text-muted-foreground')} />
          <span className="min-w-0 truncate text-[13px] font-semibold">
            {rssDayDateLabelBlock(activeDayKey)}
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{activeCounts.unread}</span>
            /{activeCounts.total} unread
          </span>
        </button>

        {datePickerOpen && (
          <div className="flex items-center gap-1 border-t border-border/40 px-4 py-2">
            <span className="mr-1 text-[11px] text-muted-foreground">Stack</span>
            {(['all', 'unread'] as const).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => changeFilter(option)}
                aria-pressed={filter === option}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] font-medium',
                  filter === option
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {option === 'all' ? 'Everything' : 'Unread only'}
              </button>
            ))}
          </div>
        )}

        {datePickerOpen && dayGroups.length > 0 && (
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain border-t border-border/40 px-4 py-2.5 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {dayGroups.map(group => (
              <button
                key={group.key}
                type="button"
                onClick={() => jumpToDay(group)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                  group.key === activeDayKey
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 hover:bg-muted',
                )}
              >
                {rssDayDateLabelBlock(group.key)}
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {dayCounts.get(group.key)?.unread ?? 0}/{dayCounts.get(group.key)?.total ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="ltm-reels-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain"
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
                  position={index === activeIndex ? positionInDay : 0}
                  total={activeCounts.total}
                  read={Boolean(entry.item.read)}
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
  read, presetTags, tagColors, onToggleTag,
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
  /** Whether the article is already read. Swiping is what marks it, so the card
   *  has to show the result — otherwise the one action the mode is built around
   *  produces no visible feedback. */
  read: boolean
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
      <div className="relative flex min-h-0 flex-1 flex-col justify-start overflow-hidden pl-5 pr-20 pt-6 text-white pb-[calc(env(safe-area-inset-bottom,0px)+5rem)]">
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
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              read
                ? 'bg-white/15 text-white/60'
                : 'bg-white/90 text-black',
            )}
          >
            {read ? 'Read' : 'New'}
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
        </button>

        {/* Tag bar. In the flow directly under the body rather than pinned to
            the card's bottom edge: that edge is iOS chrome — home indicator and
            the app-switcher banner sit on it — so a pinned row was unreachable.
            The body above is the flex child that gives, so the chips hold this
            position no matter how long the article runs.

            Outside the open button above, because a tag tap files the article,
            it does not open it. `color-scheme: dark` is load-bearing:
            tagColorStyleBlock resolves through light-dark(), and this card is
            dark whatever the app theme, so without it a light-themed app paints
            light chips onto a dark card. */}
        {presetTags.length > 0 && (
          <div
            className="ltm-reels-tags mt-4 flex shrink-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{ colorScheme: 'dark' }}
          >
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
                    'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
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
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-3.5 text-white">
        {/* Position in the queue. Reading an inbox down is a finite task, so the
            card says how much of it is left — this is the one number that makes
            a deck feel bounded rather than endless. It sits with the controls
            rather than in the meta row so the right edge owns every per-card
            affordance, and at rail width rather than the 10px it started at. */}
        {position > 0 && (
          <span className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur-sm">
            {position}/{total}
          </span>
        )}
        <RailButton
          label="Read"
          active={false}
          onClick={onOpen}
        >
          <ExternalLink className="h-5 w-5" />
        </RailButton>
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
