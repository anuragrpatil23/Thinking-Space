import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, SkipForward, Undo2 } from 'lucide-react'
import {
  buildRssDeckEntriesBlock,
  buildRssTimelineDayGroupsBlock,
  buildRssCalendarWeeksBlock,
  rssDayDateLabelBlock,
  rssDeckDayCountsBlock,
  rssMonthLabelBlock,
  rssMonthOfDayKeyBlock,
  rssTraversalStepBlock,
  rssItemDayKeyBlock,
  rssSourceHueBlock,
  type RssFeedItemBlock,
  type RssDeckFilterBlock,
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

const DECK_FILTER_KEY = 'ltm-rss-reels-filter'
const DECK_SOURCES_KEY = 'ltm-rss-reels-sources'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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

  // Source filter. Empty means every source — an explicit "all" member would
  // have to be kept in sync as feeds come and go.
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DECK_SOURCES_KEY)
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch { /* storage is optional */ }
    return new Set()
  })

  const sources = useMemo(
    () => feeds.map(feed => ({ id: feed.feedId, title: feed.feedTitle })),
    [feeds],
  )

  const allEntries = useMemo(() => {
    const entries = buildRssDeckEntriesBlock(feeds)
    if (selectedSources.size === 0) return entries
    return entries.filter(entry => selectedSources.has(entry.item.feedId))
  }, [feeds, selectedSources])

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

  /** Rebuilding membership is the one thing that may reorder the deck under the
   *  reader, so it happens only on an explicit change to what the deck is of. */
  const rebuildDeck = useCallback(() => {
    admittedRef.current = new Set()
    setAdmissionTick(tick => tick + 1)
    // Indices no longer point at the same articles, so the traversal restarts
    // rather than carrying a stale cursor that would mark the wrong span.
    navigatingRef.current = true
    lastIndexRef.current = 0
    committedRef.current = new Set()
    setActiveIndex(0)
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  const changeFilter = useCallback((next: RssDeckFilterBlock) => {
    rebuildDeck()
    setFilter(next)
    try { localStorage.setItem(DECK_FILTER_KEY, next) } catch { /* optional */ }
  }, [rebuildDeck])

  const toggleSource = useCallback((feedId: string | null) => {
    setSelectedSources(current => {
      // null is the "All sources" chip — it clears rather than selecting every
      // id, so a newly added feed is included by default.
      const next = feedId === null
        ? new Set<string>()
        : new Set(current)
      if (feedId !== null) {
        if (next.has(feedId)) next.delete(feedId)
        else next.add(feedId)
      }
      try { localStorage.setItem(DECK_SOURCES_KEY, JSON.stringify([...next])) } catch { /* optional */ }
      return next
    })
    rebuildDeck()
  }, [rebuildDeck])

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
  const [visibleMonth, setVisibleMonth] = useState<{ year: number; monthIndex: number } | null>(null)
  const pendingJumpRef = useRef<number | null>(null)

  /** Day key -> where that stack starts, so a calendar cell can jump straight
   *  into the deck without the calendar knowing anything about indices. */
  const dayStartIndex = useMemo(() => {
    const map = new Map<string, number>()
    for (const group of dayGroups) map.set(group.key, group.firstIndex)
    return map
  }, [dayGroups])

  const calendarMonth = visibleMonth ?? rssMonthOfDayKeyBlock(activeDayKey)
  const calendarWeeks = useMemo(
    () => buildRssCalendarWeeksBlock(calendarMonth.year, calendarMonth.monthIndex, dayCounts),
    [calendarMonth.year, calendarMonth.monthIndex, dayCounts],
  )

  const shiftMonth = useCallback((delta: number) => {
    setVisibleMonth(current => {
      const base = current ?? rssMonthOfDayKeyBlock(activeDayKey)
      const date = new Date(base.year, base.monthIndex + delta, 1)
      return { year: date.getFullYear(), monthIndex: date.getMonth() }
    })
  }, [activeDayKey])

  const jumpToDayKey = useCallback((key: string) => {
    const index = dayStartIndex.get(key)
    if (index === undefined) return
    setDatePickerOpen(false)
    navigatingRef.current = true
    lastIndexRef.current = index
    setActiveIndex(index)
    pendingJumpRef.current = index
  }, [dayStartIndex])


  useEffect(() => {
    const index = pendingJumpRef.current
    if (index === null) return
    pendingJumpRef.current = null
    cardNodesRef.current.get(index)?.scrollIntoView({ block: 'start' })
  }, [activeIndex])

  /** The next unread article after the current card, or the first one anywhere
   *  if there is none ahead — in an "Everything" deck most cards are already
   *  read, so the reader needs a way past them that is not 40 swipes. */
  const nextUnreadIndex = useMemo(() => {
    for (let i = activeIndex + 1; i < entries.length; i++) {
      if (!entries[i].item.read) return i
    }
    for (let i = 0; i <= activeIndex && i < entries.length; i++) {
      if (!entries[i].item.read) return i
    }
    return null
  }, [entries, activeIndex])

  const skipToNextUnread = useCallback(() => {
    if (nextUnreadIndex === null) return
    // Deliberately does NOT mark the cards it passes. Skipping to unread is
    // navigation; the swipe is what constitutes reading.
    navigatingRef.current = true
    lastIndexRef.current = nextUnreadIndex
    setActiveIndex(nextUnreadIndex)
    pendingJumpRef.current = nextUnreadIndex
  }, [nextUnreadIndex])

  const registerCardNode = useCallback((index: number, node: HTMLElement | null) => {
    if (node) cardNodesRef.current.set(index, node)
    else cardNodesRef.current.delete(index)
  }, [])

  // Which card owns the viewport, and therefore what counts as read.
  //
  // This used to be an IntersectionObserver, which made the read mark
  // probabilistic in three ways: iOS drops intersection callbacks during
  // momentum snap scrolling, so a fast pass could leave cards unmarked;
  // `activeIndexRef` lags between the observer's setState and React's commit,
  // so two callbacks in one frame shared a stale starting point; and the effect
  // tore itself down and rebuilt on every index change, losing callbacks in the
  // gap. The symptom was a day's unread count that only sometimes went down.
  //
  // Geometry is exact instead. Every card is one scroller-height, so the index
  // IS `scrollTop / clientHeight` — no thresholds, no dwell, nothing to miss.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  /** The card we were last settled on. Reads are committed for the span
   *  between here and where we land, so marking follows actual traversal
   *  rather than a high-water mark — otherwise jumping forward would mark the
   *  whole backlog read. */
  const lastIndexRef = useRef(0)
  /** Set while a jump is in flight, so calendar and skip-to-unread move the
   *  reader without reading anything on the way. */
  const navigatingRef = useRef(false)
  /** Ids already handed to the store, so a settle that re-reports the same
   *  position cannot re-issue a write. */
  const committedRef = useRef(new Set<string>())
  const settleFrameRef = useRef<number | null>(null)

  const commitReadsRef = useRef(commitReads)
  commitReadsRef.current = commitReads

  const commitSpan = useCallback((from: number, to: number) => {
    const passed: RssFeedItemBlock[] = []
    for (let i = from; i < to; i++) {
      const entry = entriesRef.current[i]
      if (!entry || committedRef.current.has(entry.item.id)) continue
      committedRef.current.add(entry.item.id)
      passed.push(entry.item)
    }
    if (passed.length > 0) commitReads(passed)
  }, [commitReads])

  const settle = useCallback(() => {
    settleFrameRef.current = null
    const scroller = scrollerRef.current
    if (!scroller || scroller.clientHeight === 0) return
    const total = entriesRef.current.length
    if (total === 0) return
    const index = Math.min(total - 1, Math.max(0, Math.round(scroller.scrollTop / scroller.clientHeight)))

    const step = rssTraversalStepBlock(lastIndexRef.current, index, navigatingRef.current)
    navigatingRef.current = false
    if (step.commitTo > step.commitFrom) commitSpan(step.commitFrom, step.commitTo)
    lastIndexRef.current = step.nextCursor
    setActiveIndex(current => (current === index ? current : index))
  }, [commitSpan])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onScroll = () => {
      // One settle per frame: scroll fires far more often than the deck can
      // meaningfully change, and each settle may mount a card window.
      if (settleFrameRef.current === null) {
        settleFrameRef.current = requestAnimationFrame(settle)
      }
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (settleFrameRef.current !== null) {
        cancelAnimationFrame(settleFrameRef.current)
        settleFrameRef.current = null
      }
    }
  }, [settle])

  // Leaving the mode is leaving the current card, which is the same disposition
  // as swiping past it. Without this the last article of every session stayed
  // unread — the most visible way the count "did not go down".
  useEffect(() => () => {
    const entry = entriesRef.current[lastIndexRef.current]
    if (!entry || committedRef.current.has(entry.item.id)) return
    committedRef.current.add(entry.item.id)
    commitReadsRef.current([entry.item])
  }, [])


  const handleKeepUnread = useCallback((item: RssFeedItemBlock) => {
    keptUnreadRef.current.add(item.id)
    // Also mark it committed: a later settle spanning this index must not
    // re-issue the read it just undid.
    committedRef.current.add(item.id)
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
          {/* Spelled out rather than "1/30 unread": a bare fraction reads as
              "one thirtieth of them are unread", which is the opposite of what
              it means. The two numbers describe different things — one moves,
              one does not — so they get their own labels. */}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{activeCounts.unread}</span> unread
            <span aria-hidden className="mx-1 opacity-50">·</span>
            {activeCounts.total} total
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

        {datePickerOpen && (
          <div className="border-t border-border/40 px-4 py-3">
            {/* Sources. "All" clears the set rather than selecting every id, so
                a feed added later is included instead of silently missing. */}
            {sources.length > 1 && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => toggleSource(null)}
                  aria-pressed={selectedSources.size === 0}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium',
                    selectedSources.size === 0
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  All sources
                </button>
                {sources.map(source => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => toggleSource(source.id)}
                    aria-pressed={selectedSources.has(source.id)}
                    className={cn(
                      'shrink-0 max-w-[9rem] truncate rounded-full border px-2.5 py-1 text-[12px] font-medium',
                      selectedSources.has(source.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {source.title}
                  </button>
                ))}
              </div>
            )}

            {/* Month grid. A horizontal chip row could only ever show the last
                few days; the backlog runs months deep, and a calendar is how a
                reader already thinks about "go to the 21st". */}
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="ltm-touch-target rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 flex-1 text-center text-[13px] font-semibold">
                {rssMonthLabelBlock(calendarMonth.year, calendarMonth.monthIndex)}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="ltm-touch-target rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_LABELS.map(label => (
                <div key={label} className="pb-1 text-[10px] font-medium uppercase text-muted-foreground/70">
                  {label}
                </div>
              ))}
              {calendarWeeks.flat().map((cell, index) => {
                if (!cell) return <div key={`pad-${index}`} />
                const hasArticles = cell.total > 0
                const isActive = cell.key === activeDayKey
                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={!hasArticles}
                    onClick={() => jumpToDayKey(cell.key)}
                    aria-label={`${cell.day}: ${cell.unread} unread of ${cell.total}`}
                    className={cn(
                      'flex flex-col items-center rounded-lg py-1 text-[13px] tabular-nums transition-colors',
                      // A day with nothing in it is not a destination. Dimming
                      // rather than hiding keeps the grid readable as a month.
                      !hasArticles && 'text-muted-foreground/30',
                      hasArticles && !isActive && 'hover:bg-muted',
                      isActive && 'bg-primary text-primary-foreground',
                    )}
                  >
                    <span className={cn('leading-tight', hasArticles && !isActive && 'font-semibold')}>
                      {cell.day}
                    </span>
                    {/* Unread over total, same pair as the date bar. Unread is
                        the number that moves, so it carries the emphasis. */}
                    <span className={cn(
                      'text-[9px] leading-tight',
                      isActive ? 'text-primary-foreground/80' : 'text-muted-foreground/70',
                    )}>
                      {hasArticles ? `${cell.unread}/${cell.total}` : '\u00A0'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

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
                  position={index === activeIndex ? positionInDay : 0}
                  total={activeCounts.total}
                  read={Boolean(entry.item.read)}
                  onOpen={() => onOpen(entry.item)}
                  onToggleSaved={() => onToggleSaved(entry.item)}
                  presetTags={presetTags}
                  tagColors={tagColors}
                  onToggleTag={(tag) => onToggleTag(entry.item, tag)}
                  onSkipToNextUnread={skipToNextUnread}
                  hasNextUnread={nextUnreadIndex !== null}
                  onKeepUnread={() => handleKeepUnread(entry.item)}
                  keptUnread={keptUnreadRef.current.has(entry.item.id)}
                />
              ) : null}
            </section>
          )
        })}
      </div>
      </div>
    </div>
  )
}

/** One article, full viewport. */
function ReelCard({
  item, feedTitle, active, position, total, onOpen, onToggleSaved, onKeepUnread, keptUnread,
  read, presetTags, tagColors, onToggleTag, onSkipToNextUnread, hasNextUnread,
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
  onSkipToNextUnread: () => void
  /** Hidden rather than disabled when nothing is unread — a permanently dead
   *  control on a card that fills the screen is just noise. */
  hasNextUnread: boolean
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

      {/* Status stack: where you are in the day, and what this card is. Both are
          facts about the card rather than actions on it, so they sit apart from
          the action rail, on the same right-hand axis. */}
      <div className="absolute right-3 top-4 flex flex-col items-end gap-1.5">
        {position > 0 && (
          <span className="rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur-sm">
            {position}/{total}
          </span>
        )}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            read ? 'bg-emerald-500/90 text-white' : 'bg-white/90 text-black',
          )}
        >
          {read ? 'Read' : 'New'}
        </span>
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
        {hasNextUnread && (
          <RailButton
            label="Next new"
            active={false}
            onClick={onSkipToNextUnread}
          >
            <SkipForward className="h-5 w-5" />
          </RailButton>
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
          label={keptUnread ? 'Kept' : 'Unread'}
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
