import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { FEED_OTHER_THEME_BLOCK } from '@/services/lego_blocks/units/intelligence/contracts/feedTopicThemesContractBlock'
import { useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { rssFeedIdsExcludedFromAllUnreadBlock, rssReaderFeedsBlock, type RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock, recentRssFeedsBlock, rssDayLabelBlock, type RssStoryBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { localDayBlock, rssDistinctHeadlinesBlock, rssOutsideCountsBlock, rssTopicItemsBlock, rssTopicsShownBlock, type RssTopicBlock } from '@/services/lego_blocks/units/rssTopicBlock'
import { readLastLibraryPassOrch } from '@/services/orchestrators/libraryFullTextOrch'
import { readLastValueLinePassOrch } from '@/personal_extension/services/orchestrators/webullValueLineOrch'
import { cn } from '@/lib/utils'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'
import { Bar, BarChart, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { feedDayNowBlock, feedDayShortLabelBlock, feedDaysAgoBlock, feedDaysEndingBlock } from '@/personal_extension/services/lego_blocks/units/feedDayBlock'
import { FEED_PASTELS_BLOCK, F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK, F9FactRowBlock, F9PanelBlock } from '../units/F9NativeBlock'
import { useRssTopicsBlock, type useFeedAiReadBlock } from './FeedAiReaderBlock'
import { FeedReadingNotesPanelBlock } from './FeedReadingNotesPanelBlock'

const LAST_SEEN_KEY_BLOCK = 'ltm-feed-overview-last-seen'

function readLastSeenBlock(): number {
  try { return Number(localStorage.getItem(LAST_SEEN_KEY_BLOCK)) || 0 } catch { return 0 }
}

const storyReadByAiBlock = (story: RssStoryBlock) => [story.lead, ...story.others].some(m => m.item.aiSummary)

// The week up to the Feed's day as soft bars: stories, and how many each
// reader got through. The day shown is full strength; a click on another goes there.
function DayBarsBlock({ rows, day, onPickDay }: { rows: Array<{ day: string; stories: number; read: number; ai: number }>; day: string; onPickDay: (day: string) => void }) {
  const data = rows.map(r => ({ ...r, label: rssDayLabelBlock(r.day).replace(/^(\w+), /, '').replace('Yesterday', 'Yest.') }))
  const cells = (fill: string) => data.map(r => <Cell key={r.day} fill={fill} fillOpacity={r.day === day ? 1 : 0.45} />)
  const key = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px]" style={{ background: color }} />{label}</span>
  )
  return (
    <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{rows.length > 0 && rows[rows.length - 1].day !== localDayBlock(new Date()) ? `The week to ${feedDayShortLabelBlock(rows[rows.length - 1].day)}` : 'The last week'}</p>
        <span className="flex items-center gap-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {key(FEED_PASTELS_BLOCK.lavender.fill, 'Stories')}
          {key(FEED_PASTELS_BLOCK.mint.fill, 'Read by you')}
          {key(FEED_PASTELS_BLOCK.peach.fill, 'Read by the AI')}
        </span>
      </div>
        <div className="h-[170px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              barGap={2}
              barCategoryGap="22%"
              className="cursor-pointer"
              onClick={(state) => { const r = data[Number(state?.activeTooltipIndex)]; if (r) onPickDay(r.day) }}
            >
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
              <YAxis width={30} tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} allowDecimals={false} tickCount={3} />
              <Tooltip
                cursor={{ fill: 'rgba(127,127,127,0.06)' }}
                contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
                labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
                formatter={(value, name) => [value, name === 'stories' ? 'Stories' : name === 'read' ? 'Read by you' : 'Read by the AI']}
              />
              <Bar dataKey="stories" fill={FEED_PASTELS_BLOCK.lavender.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>{cells(FEED_PASTELS_BLOCK.lavender.fill)}</Bar>
              <Bar dataKey="read" fill={FEED_PASTELS_BLOCK.mint.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>{cells(FEED_PASTELS_BLOCK.mint.fill)}</Bar>
              <Bar dataKey="ai" fill={FEED_PASTELS_BLOCK.peach.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>{cells(FEED_PASTELS_BLOCK.peach.fill)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
    </F9PanelBlock>
  )
}

/** One share of today's stories: the count, its percentage, and a thin bar. */
function ShareRowBlock({ label, count, total, color, divided }: { label: string; count: number; total: number; color: string; divided?: boolean }) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className={cn('py-2 tabular-nums', divided && 'mt-2 border-t border-zinc-200/80 dark:border-zinc-800')}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span><span className="font-medium">{count}</span><span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">{share}%</span></span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${share}%`, background: color }} />
      </div>
    </div>
  )
}

/** Articles that arrived in each hour today (bars), against the week's usual hour (line). */
export function feedArrivalsByHourBlock(items: Array<{ pubDate?: string | null }>, now = new Date()): Array<{ hour: number; today: number | null; usual: number }> {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startWeek = startToday - 7 * 86_400_000
  const today = new Array<number>(24).fill(0)
  const week = new Array<number>(24).fill(0)
  for (const item of items) {
    const t = item.pubDate ? Date.parse(item.pubDate) : NaN
    if (Number.isNaN(t) || t < startWeek || t > now.getTime()) continue
    const hour = new Date(t).getHours()
    if (t >= startToday) today[hour] += 1
    else week[hour] += 1
  }
  return today.map((count, hour) => ({
    hour,
    // Hours still to come today show no bar, not a zero
    today: hour <= now.getHours() ? count : null,
    usual: Math.round((week[hour] / 7) * 10) / 10,
  }))
}

function hourLabelBlock(hour: number): string {
  return hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`
}

function ArrivalsChartBlock({ rows, dayLabel }: { rows: ReturnType<typeof feedArrivalsByHourBlock>; dayLabel: string | null }) {
  const key = (color: string, label: string, line?: boolean) => (
    <span className="inline-flex items-center gap-1.5"><span className={line ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-[3px]'} style={{ background: color }} />{label}</span>
  )
  return (
    <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{dayLabel ? `When it landed on ${dayLabel}` : 'When it landed today'}</p>
        <span className="flex items-center gap-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {key(FEED_PASTELS_BLOCK.lavender.fill, 'Articles this hour')}
          {key(FEED_PASTELS_BLOCK.peach.line, 'A usual day (last 7)', true)}
        </span>
      </div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
            <XAxis dataKey="hour" tickFormatter={hourLabelBlock} interval={2} tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
            <YAxis width={30} tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} allowDecimals={false} tickCount={3} />
            <Tooltip
              cursor={{ fill: 'rgba(127,127,127,0.06)' }}
              contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
              labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
              labelFormatter={(hour) => `${hourLabelBlock(Number(hour))}–${hourLabelBlock((Number(hour) + 1) % 24)}`}
              formatter={(value, name) => [value ?? '–', name === 'today' ? (dayLabel ?? 'Today') : 'A usual day']}
            />
            <Bar dataKey="today" fill={FEED_PASTELS_BLOCK.lavender.fill} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Line dataKey="usual" type="monotone" stroke={FEED_PASTELS_BLOCK.peach.line} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </F9PanelBlock>
  )
}

/**
 * The Feed's landing page: where things stand today, what is loud, what needs
 * attention, and how the last days went. Nothing here ranks articles by
 * importance; "loud" is only how many sources carry a story.
 */
type FeedTopicEntryBlock = { topic: RssTopicBlock; items: RssFeedItemBlock[] }

const publisherNameBlock = (title: string) => title.split(/\s[|:–—-]\s/)[0].replace(/^Latest from\s+/i, '').trim()

/** One topic: its name, key details and how many articles; open it for the articles, from every outlet. */
/** What the other sources carried, per theme and topic: read where the rows draw their counts. */
const OutsideCountsContextBlock = createContext<ReturnType<typeof rssOutsideCountsBlock> | null>(null)

/**
 * A row's size: the total articles, a small bar split in two greys (the darker
 * share your reading list, the lighter the other sources the AI read), then its
 * topics and outlets. The split is spelled out on hover.
 */
/** About the split card's width, to decide whether it fits right of the counts. */
const SPLIT_CARD_WIDTH_BLOCK = 380

function CountsSplitLineBlock({ swatch, label, articles, outlets }: { swatch: string; label: string; articles: number; outlets: number }) {
  return (
    <span className="flex items-center gap-2 py-0.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-sm', swatch)} aria-hidden />
      <span className="flex-1 whitespace-nowrap pr-4">{label}</span>
      <span className="whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">{articles} {articles === 1 ? 'article' : 'articles'} · {outlets} {outlets === 1 ? 'outlet' : 'outlets'}</span>
    </span>
  )
}

/** A split line's outlets under it, wrapping to a few lines; a long list ends in "and N more". */
function CountsOutletNamesBlock({ names }: { names: string[] }) {
  const shown = names.slice(0, OUTLET_NAMES_SHOWN_BLOCK)
  const more = names.length - shown.length
  return (
    <span className="mb-1.5 block max-w-[340px] whitespace-normal pl-4 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
      {shown.join(', ')}{more > 0 ? ` and ${more} more` : ''}
    </span>
  )
}

const OUTLET_NAMES_SHOWN_BLOCK = 15

function RowCountsBlock({ own, other, ownOutlets, otherOutlets, topics, outletNames, otherOutletNames }: { own: number; other: number; ownOutlets: number; otherOutlets: number; topics?: number; outletNames: string[]; otherOutletNames: string[] }) {
  const total = own + other
  const outlets = ownOutlets + otherOutlets
  const articles = `${total} ${total === 1 ? 'article' : 'articles'}`
  const outletsLabel = `${outlets} ${outlets === 1 ? 'outlet' : 'outlets'}`
  // A theme leads with its topics, then its articles and outlets; a topic (no topics count) with its articles
  const lead = topics !== undefined ? `${topics} ${topics === 1 ? 'topic' : 'topics'}` : articles
  const rest = topics !== undefined ? `${articles} · ${outletsLabel}` : outletsLabel
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    // With other sources, hovering shows the split at once; without, the outlet names (native, as before)
    <span
      className="block"
      title={other > 0 ? undefined : outletNames.join(', ')}
      onMouseEnter={other > 0 ? e => setAt(e.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={() => setAt(null)}
    >
      <span className="block font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{lead}</span>
      <span className="mt-1 block tabular-nums">{rest}</span>
      {other > 0 && (
        // Small and in two greys: your reading list the darker share, the other sources the lighter
        <span className="ml-auto mt-1.5 flex h-[3px] w-14 overflow-hidden rounded-full" aria-hidden>
          <span className="h-full bg-zinc-500 dark:bg-zinc-300" style={{ width: `${(own / total) * 100}%` }} />
          <span className="h-full bg-zinc-200 dark:bg-zinc-600" style={{ width: `${(other / total) * 100}%` }} />
        </span>
      )}
      {at && createPortal(
        // On the page, not in the panel (which clips its edges): to the right of the counts, or left when the window has no room
        <span
          className="pointer-events-none fixed z-50 w-max rounded-lg border-[0.5px] border-zinc-200 bg-white px-3 py-2 text-left text-[12px] text-zinc-600 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          style={window.innerWidth - at.right > SPLIT_CARD_WIDTH_BLOCK + 24
            ? { left: at.right + 12, top: at.top }
            : { right: window.innerWidth - at.left + 12, top: at.top }}
          role="tooltip"
        >
          <CountsSplitLineBlock swatch="bg-zinc-500 dark:bg-zinc-300" label="Your reading list" articles={own} outlets={ownOutlets} />
          {outletNames.length > 0 && <CountsOutletNamesBlock names={outletNames} />}
          <CountsSplitLineBlock swatch="bg-zinc-200 dark:bg-zinc-600" label="Other sources the AI read" articles={other} outlets={otherOutlets} />
          {otherOutletNames.length > 0 && <CountsOutletNamesBlock names={otherOutletNames} />}
        </span>,
        document.body,
      )}
    </span>
  )
}

function FeedTopicRowBlock({ entry, sourceOf, onOpenItem, mood }: { entry: FeedTopicEntryBlock; sourceOf: (item: RssFeedItemBlock) => string; onOpenItem: (item: RssFeedItemBlock) => void; mood?: boolean }) {
  const [open, setOpen] = useState(false)
  const outsideCounts = useContext(OutsideCountsContextBlock)
  const { topic, items } = entry
  const outside = outsideCounts?.byTopic.get(topic.name)
  const outlets = [...new Set(items.map(item => publisherNameBlock(sourceOf(item))).filter(Boolean))]
  // A wire piece re-published through the day (and through several feeds) is one row, with its copies counted
  const distinct = useMemo(() => rssDistinctHeadlinesBlock(items), [items])
  const lead = topic.detail ?? items[0]?.aiSummary?.text.split('\n').find(Boolean)?.replace(/^-\s*/, '') ?? null
  return (
    <div className={cn('border-t-[0.5px] border-[#EFEFF2] dark:border-zinc-800', mood && 'border-l-2 border-l-amber-300 dark:border-l-amber-500/60')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug text-zinc-900 dark:text-zinc-100">{topic.name}</span>
          {lead && <span className={cn('mt-1 block text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300', !open && 'line-clamp-3')}>{lead}</span>}
        </span>
        <span className="w-[140px] shrink-0 pt-px text-right text-[12px] text-zinc-500 dark:text-zinc-400">
          <RowCountsBlock own={distinct.length} other={outside?.articles ?? 0} ownOutlets={outlets.length} otherOutlets={outside?.outlets ?? 0} outletNames={outlets} otherOutletNames={outside?.outletNames ?? []} />
        </span>
      </button>
      {open && (
        <div className="pb-2.5 pl-5 pr-5">
          {distinct.map(({ item, copies }) => (
            <button key={item.id} type="button" onClick={() => onOpenItem(item)} className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">{item.title}</span>
              <span className="shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                {copies > 1 && <span className="mr-1.5 tabular-nums" title={`Published ${copies} times; the latest opens`}>×{copies}</span>}
                {publisherNameBlock(sourceOf(item))}{item.pubDate ? ` · ${new Date(item.pubDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Today's news by what is happening, not who published it: the market's mood
 * on its own strip, then each subject with its key details, the most articles
 * first. Topics of one article sit folded at the end.
 */
const STRIP_CLASS_BLOCK = 'border-t-[0.5px] border-[#EFEFF2] px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400'

/** Up to this many topics a theme lists as rows; more go into three columns. */
const THEME_ROWS_BLOCK = 4

/** Themes from the AI's list, then Other news, then topics it has not placed yet. */
const UNPLACED_THEME_BLOCK = 'Not grouped yet'

/**
 * One theme ("Intel", "Q3 earnings"): its name, how much is under it, and its
 * biggest topics by name; open it for each topic, which opens for its articles.
 */
function FeedThemeRowBlock({ theme, entries, sourceOf, onOpenItem, mood, defaultOpen = false }: { theme: string; entries: FeedTopicEntryBlock[]; sourceOf: (item: RssFeedItemBlock) => string; onOpenItem: (item: RssFeedItemBlock) => void; mood?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const outsideCounts = useContext(OutsideCountsContextBlock)
  const outside = outsideCounts?.byTheme.get(mood ? `Market · ${theme}` : theme)
  // Copies of one headline count once, as in each topic
  const articles = useMemo(() => rssDistinctHeadlinesBlock(entries.flatMap(e => e.items)).length, [entries])
  const outlets = new Set(entries.flatMap(e => e.items.map(item => publisherNameBlock(sourceOf(item))).filter(Boolean)))
  return (
    <div className={cn('border-t-[0.5px] border-[#EFEFF2] dark:border-zinc-800', mood && 'border-l-2 border-l-amber-300 dark:border-l-amber-500/60')}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <ChevronRight className={cn('mt-[3px] h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{theme}</span>
          {/* Its topics, easy to scan: a few as plain rows read whole; more
              than that as a small three-column table, one name a cell */}
          {!open && (
            <span className={cn('mt-1.5 grid gap-x-5 gap-y-1 text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400', entries.length > THEME_ROWS_BLOCK ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1')}>
              {entries.map(e => <span key={e.topic.id} className={entries.length > THEME_ROWS_BLOCK ? 'truncate' : undefined} title={e.topic.name}>{e.topic.name}</span>)}
            </span>
          )}
        </span>
        <span className="w-[140px] shrink-0 pt-px text-right text-[12px] text-zinc-500 dark:text-zinc-400">
          <RowCountsBlock own={articles} other={outside?.articles ?? 0} ownOutlets={outlets.size} otherOutlets={outside?.outlets ?? 0} topics={entries.length} outletNames={[...outlets]} otherOutletNames={outside?.outletNames ?? []} />
        </span>
      </button>
      {open && (
        <div className="ml-[38px] border-l border-zinc-200 dark:border-zinc-800">
          {entries.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} mood={mood} />)}
        </div>
      )}
    </div>
  )
}

/**
 * Topics by theme once the AI has placed any: the most articles first, Other
 * news and anything not placed yet last. Null before then, for the flat list.
 */
function topicsByThemeBlock(entries: FeedTopicEntryBlock[]): Array<[string, FeedTopicEntryBlock[]]> | null {
  if (!entries.some(t => t.topic.theme)) return null
  const byTheme = new Map<string, FeedTopicEntryBlock[]>()
  for (const entry of entries) {
    const name = entry.topic.theme || UNPLACED_THEME_BLOCK
    byTheme.set(name, [...(byTheme.get(name) ?? []), entry])
  }
  const last = (name: string) => (name === UNPLACED_THEME_BLOCK ? 2 : name === FEED_OTHER_THEME_BLOCK ? 1 : 0)
  const size = (list: FeedTopicEntryBlock[]) => rssDistinctHeadlinesBlock(list.flatMap(e => e.items)).length
  return [...byTheme.entries()].sort((a, b) => last(a[0]) - last(b[0]) || size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]))
}

function FeedTopicsPanelBlock({ topics, sourceOf, onOpenItem, dayLabel }: { topics: FeedTopicEntryBlock[]; sourceOf: (item: RssFeedItemBlock) => string; onOpenItem: (item: RssFeedItemBlock) => void; dayLabel: string | null }) {
  const [showSingles, setShowSingles] = useState(false)
  const mood = topics.filter(t => t.topic.kind === 'mood')
  const subjects = topics.filter(t => t.topic.kind !== 'mood')
  // Copies of one headline count once: a topic of one re-published wire piece is a single
  const distinctOf = (t: FeedTopicEntryBlock) => rssDistinctHeadlinesBlock(t.items).length
  const many = subjects.filter(t => distinctOf(t) > 1)
  const singles = subjects.filter(t => distinctOf(t) === 1)
  const articles = rssDistinctHeadlinesBlock(topics.flatMap(t => t.items)).length
  // Once the AI has placed topics under themes, both read by theme: the
  // market by what moved ("Whole market", "Chips"), the rest by subject
  const themes = topicsByThemeBlock(subjects)
  const moodThemes = topicsByThemeBlock(mood)
  return (
    <F9PanelBlock className="overflow-hidden text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-[18px]">
        <p className="font-semibold">{dayLabel ? `What happened on ${dayLabel}` : "What's happening today"}</p>
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
          {[
            mood.length > 0 ? `${mood.length} on the market` : null,
            themes ? `${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}` : null,
            `${subjects.length} ${subjects.length === 1 ? 'topic' : 'topics'}`,
            `${articles} ${articles === 1 ? 'article' : 'articles'}`,
          ].filter(Boolean).join(' · ')}, sorted by the AI
        </span>
      </div>
      {mood.length > 0 && (
        <>
          <p className={STRIP_CLASS_BLOCK}>Market mood</p>
          {moodThemes
            // The day's biggest move stays open, as the single list showed it
            ? moodThemes.map(([name, entries], i) => <FeedThemeRowBlock key={name} theme={name} entries={entries} sourceOf={sourceOf} onOpenItem={onOpenItem} mood defaultOpen={i === 0} />)
            : mood.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} mood />)}
          {/* With a mood strip above, the subjects get their own label, so the two read apart */}
          {subjects.length > 0 && <p className={STRIP_CLASS_BLOCK}>{themes ? 'Themes' : 'Topics'}</p>}
        </>
      )}
      {themes && themes.map(([name, entries]) => <FeedThemeRowBlock key={name} theme={name} entries={entries} sourceOf={sourceOf} onOpenItem={onOpenItem} />)}
      {!themes && many.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} />)}
      {!themes && singles.length > 0 && (
        showSingles
          ? singles.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} />)
          : (
            <button type="button" onClick={() => setShowSingles(true)} className="block w-full border-t-[0.5px] border-[#EFEFF2] px-5 py-2.5 text-left text-[12px] text-[#3b6fb6] hover:bg-zinc-50 dark:border-zinc-800 dark:text-sky-400 dark:hover:bg-zinc-800/50">
              {singles.length} more {singles.length === 1 ? 'topic' : 'topics'} with one article each
            </button>
          )
      )}
    </F9PanelBlock>
  )
}

export function FeedOverviewBlock({ reader, onOpenItem, chart, header, day, onPickDay }: {
  reader: ReturnType<typeof useFeedAiReadBlock>
  /** The Feed's day, YYYY-MM-DD: today unless another was picked */
  day: string
  onPickDay: (day: string) => void
  onOpenItem: (item: RssFeedItemBlock) => void
  /** The page's title and view switch, at the top of the main column */
  header: React.ReactNode
  /** The articles-per-day chart, owned by the Feed page */
  chart: React.ReactNode
}) {
  const { feeds, preferences } = useRssFeedsBlock()
  // "Since you last looked" compares with the visit before this one
  const [lastSeen] = useState(readLastSeenBlock)
  useEffect(() => () => {
    try { localStorage.setItem(LAST_SEEN_KEY_BLOCK, String(Date.now())) } catch { /* optional */ }
  }, [])

  // The day and the week before it are all this page shows: group only from
  // that week to now, at low priority, so arriving feeds never hold up the page.
  const deferredFeeds = useDeferredValue(feeds)
  const today = localDayBlock(new Date())
  const isToday = day === today
  const dayLabel = isToday ? null : feedDayShortLabelBlock(day)
  const span = feedDaysAgoBlock(day, today) + 8
  // Remembered across visits: the same feed snapshot never regroups
  const days = useMemo(
    () => identityMemoBlock('feed-overview-days', [deferredFeeds, preferences, span], () =>
      buildRssDayInboxBlock({ feeds: recentRssFeedsBlock(rssReaderFeedsBlock(deferredFeeds, preferences), span), configs: preferences?.feeds ?? [] })),
    [deferredFeeds, preferences, span],
  )
  // Named todayStories from when the page only showed today: the Feed's day's stories
  const todayStories = useMemo(
    () => days.find(d => d.day === day)?.sources.flatMap(s => s.stories) ?? [],
    [days, day],
  )
  const newStories = useMemo(
    () => (lastSeen && isToday ? days.flatMap(d => d.sources.flatMap(s => s.stories)).filter(story => Date.parse(story.lead.item.pubDate ?? '') > lastSeen).length : null),
    [days, lastSeen, isToday],
  )
  // The day's news by what is happening, as the AI sorted it
  const topicState = useRssTopicsBlock(day)
  const outsideCounts = useMemo(() => rssOutsideCountsBlock(topicState), [topicState])
  const { topics, sourceOf } = useMemo(() => {
    const readerFeeds = rssReaderFeedsBlock(deferredFeeds, preferences)
    const source = new Map<string, string>()
    for (const feed of readerFeeds) for (const item of feed.items) source.set(item.id, feed.feedTitle)
    return {
      topics: rssTopicsShownBlock(topicState, rssTopicItemsBlock(readerFeeds.flatMap(feed => feed.items), day)),
      sourceOf: (item: RssFeedItemBlock) => source.get(item.id) ?? '',
    }
  }, [deferredFeeds, preferences, topicState, day])

  const warnings = useMemo(() => {
    const out: string[] = []
    const aiOnly = preferences ? rssFeedIdsExcludedFromAllUnreadBlock(preferences.groups, preferences.feeds) : new Set<string>()
    const failing = feeds.filter(f => f.error && f.items.length === 0)
    const mine = failing.filter(f => !aiOnly.has(f.feedId))
    const ai = failing.filter(f => aiOnly.has(f.feedId))
    if (mine.length) out.push(`${mine.length} ${mine.length === 1 ? 'source is' : 'sources are'} not loading: ${mine.slice(0, 3).map(f => f.feedTitle).join(', ')}${mine.length > 3 ? '…' : ''}`)
    if (ai.length) out.push(`${ai.length} of the AI's sources ${ai.length === 1 ? 'is' : 'are'} not loading`)
    if (reader.available && !reader.settings.on) out.push('The AI reader is off; turn it on in Settings → Webull.')
    if (reader.available && reader.last?.error && reader.settings.on) out.push(`AI reader: ${reader.last.error}`)
    const library = readLastLibraryPassOrch()
    if (library?.error) out.push(`Library: ${library.error}`)
    const valueLine = readLastValueLinePassOrch()
    if (valueLine?.failed?.length) out.push(`Value Line: ${valueLine.failed.length} ${valueLine.failed.length === 1 ? 'company' : 'companies'} failed`)
    return out
  }, [feeds, preferences, reader.available, reader.settings.on, reader.last])

  const sourcesToday = useMemo(() => {
    const counts = new Map<string, number>()
    for (const story of todayStories) counts.set(story.lead.feedTitle, (counts.get(story.lead.feedTitle) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [todayStories])
  const latest = todayStories.reduce<RssStoryBlock | null>((best, story) => (!best || Date.parse(story.lead.item.pubDate ?? '') > Date.parse(best.lead.item.pubDate ?? '') ? story : best), null)

  // The seven days ending with the Feed's day, newest first
  const history = feedDaysEndingBlock(day, 7).reverse().map(key => {
    const stories = days.find(d => d.day === key)?.sources.flatMap(s => s.stories) ?? []
    return { day: key, stories: stories.length, read: stories.filter(s => s.read).length, ai: stories.filter(storyReadByAiBlock).length }
  })

  const weekStories = history.reduce((n, d) => n + d.stories, 0)
  const arrivals = useMemo(
    () => identityMemoBlock('feed-overview-arrivals', [deferredFeeds, preferences, day], () =>
      feedArrivalsByHourBlock(recentRssFeedsBlock(rssReaderFeedsBlock(deferredFeeds, preferences), span).flatMap(f => f.items), feedDayNowBlock(day))),
    [deferredFeeds, preferences, day, span],
  )

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      {/* The title spans both columns, so the charts and the side panels start level */}
      <div className="min-w-0 lg:col-span-2">{header}</div>
      <div className="flex min-w-0 flex-col gap-5">
        {todayStories.length > 0 && <ArrivalsChartBlock rows={arrivals} dayLabel={dayLabel} />}
        <DayBarsBlock rows={[...history].reverse()} day={day} onPickDay={onPickDay} />
        {chart}
        {topics.length > 0
          ? (
            <OutsideCountsContextBlock.Provider value={outsideCounts}>
              <FeedTopicsPanelBlock topics={topics} sourceOf={sourceOf} onOpenItem={onOpenItem} dayLabel={dayLabel} />
            </OutsideCountsContextBlock.Provider>
          )
          : !isToday && todayStories.length > 0 && (
            <F9PanelBlock className="px-5 py-4 text-[13px] text-zinc-500 dark:text-zinc-400">
              {reader.progress?.kind === 'topics'
                ? `The AI is sorting the news · ${reader.progress.done} of ${reader.progress.total}`
                : reader.available && reader.settings.on
                  ? `The AI sorts ${dayLabel}'s news into topics once today's reading is done.`
                  : `${dayLabel}'s news was never sorted into topics; turn the AI reader on in Settings → Webull to sort it.`}
            </F9PanelBlock>
          )}
      </div>

      {/* Where things stand, beside the charts */}
      <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
        <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
          <p className="font-semibold">{isToday ? 'Today' : rssDayLabelBlock(day)}</p>
          <p className="mt-2.5 text-2xl font-semibold tabular-nums">{todayStories.length} {todayStories.length === 1 ? 'story' : 'stories'}</p>
          <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {reader.progress
              ? reader.progress.kind === 'topics'
                ? `The AI is sorting today's news · ${reader.progress.done} of ${reader.progress.total}`
                : `The AI is reading · ${reader.progress.done} of ${reader.progress.total}`
              : latest ? `${isToday ? 'Latest' : 'Last'}: ${latest.lead.feedTitle}, ${new Date(latest.lead.item.pubDate ?? '').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : isToday ? 'Nothing yet today' : 'Nothing that day'}
          </p>
          {reader.available && !reader.progress && (
            reader.settings.on
              ? (
                <button
                  type="button"
                  onClick={() => { void reader.runNow() }}
                  title="Read what is waiting, sort the news into topics and write their key details, one job after another until nothing is left"
                  className="mb-1.5 text-[12px] font-medium text-[#3b6fb6] hover:underline dark:text-sky-400"
                >
                  Run the AI now{reader.waiting > 0 ? ` · ${reader.waiting} waiting` : ''}
                </button>
              )
              : <p className="mb-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">The AI reader is off (Settings → Webull)</p>
          )}
          {reader.available && !reader.progress && reader.settings.on && reader.last?.error && (
            <p className="mb-1.5 text-[12px] text-red-600 dark:text-red-400">Last run: {reader.last.error}</p>
          )}
          <ShareRowBlock divided label="Read by you" count={todayStories.filter(s => s.read).length} total={todayStories.length} color={FEED_PASTELS_BLOCK.mint.line} />
          <ShareRowBlock label="Read by the AI" count={todayStories.filter(storyReadByAiBlock).length} total={todayStories.length} color={FEED_PASTELS_BLOCK.peach.line} />
          {newStories !== null && <F9FactRowBlock divided label="New since your last visit" value={newStories} />}
          <F9FactRowBlock divided={newStories === null} label={isToday ? 'This week' : `The week to ${dayLabel}`} value={weekStories} sub={(() => { const read = history.reduce((n, d) => n + d.read, 0); return `${read} read by you${weekStories ? ` · ${Math.round((read / weekStories) * 100)}%` : ''}` })()} />
        </F9PanelBlock>

        {sourcesToday.length > 0 && (
          <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
            <p className="mb-1 font-semibold">{isToday ? 'Where it came from today' : `Where it came from on ${dayLabel}`}</p>
            {sourcesToday.map(([title, count], index) => (
              <F9FactRowBlock key={title} divided={index > 0} label={title} value={count} />
            ))}
          </F9PanelBlock>
        )}

        <FeedReadingNotesPanelBlock feeds={feeds} onOpenItem={onOpenItem} />

        {warnings.length > 0 && (
          <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
            <p className="mb-1.5 font-semibold">Worth a look</p>
            {warnings.map((w, i) => (
              <div key={w} className={cn('flex items-start gap-2.5 py-2 text-zinc-600 dark:text-zinc-300', i > 0 && 'border-t border-zinc-200/80 dark:border-zinc-800')}>
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" aria-hidden />
                {w}
              </div>
            ))}
          </F9PanelBlock>
        )}
      </div>
    </div>
  )
}
