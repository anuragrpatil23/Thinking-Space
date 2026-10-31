import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { rssFeedIdsExcludedFromAllUnreadBlock, rssReaderFeedsBlock, type RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock, recentRssFeedsBlock, rssDayLabelBlock, type RssStoryBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { localDayBlock, rssTopicItemsBlock, rssTopicsShownBlock, type RssTopicBlock } from '@/services/lego_blocks/units/rssTopicBlock'
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
function FeedTopicRowBlock({ entry, sourceOf, onOpenItem, mood }: { entry: FeedTopicEntryBlock; sourceOf: (item: RssFeedItemBlock) => string; onOpenItem: (item: RssFeedItemBlock) => void; mood?: boolean }) {
  const [open, setOpen] = useState(false)
  const { topic, items } = entry
  const outlets = [...new Set(items.map(item => publisherNameBlock(sourceOf(item))).filter(Boolean))]
  const lead = topic.detail ?? items[0]?.aiSummary?.text.split('\n').find(Boolean)?.replace(/^-\s*/, '') ?? null
  return (
    <div className={cn('border-t-[0.5px] border-[#EFEFF2] dark:border-zinc-800', mood && 'border-l-2 border-l-amber-300 dark:border-l-amber-500/60')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-4 px-5 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug text-zinc-900 dark:text-zinc-100">{topic.name}</span>
          {lead && <span className={cn('mt-1 block text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300', !open && 'line-clamp-3')}>{lead}</span>}
        </span>
        <span className="w-[120px] shrink-0 pt-px text-right text-[12px] text-zinc-500 dark:text-zinc-400" title={outlets.join(', ')}>
          <span className="block font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{items.length} {items.length === 1 ? 'article' : 'articles'}</span>
          <span className="mt-0.5 block tabular-nums">{outlets.length} {outlets.length === 1 ? 'outlet' : 'outlets'}</span>
        </span>
      </button>
      {open && (
        <div className="pb-2.5 pl-5 pr-5">
          {items.map(item => (
            <button key={item.id} type="button" onClick={() => onOpenItem(item)} className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">{item.title}</span>
              <span className="shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-400">
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

function FeedTopicsPanelBlock({ topics, sourceOf, onOpenItem, dayLabel }: { topics: FeedTopicEntryBlock[]; sourceOf: (item: RssFeedItemBlock) => string; onOpenItem: (item: RssFeedItemBlock) => void; dayLabel: string | null }) {
  const [showSingles, setShowSingles] = useState(false)
  const mood = topics.filter(t => t.topic.kind === 'mood')
  const subjects = topics.filter(t => t.topic.kind !== 'mood')
  const many = subjects.filter(t => t.items.length > 1)
  const singles = subjects.filter(t => t.items.length === 1)
  const articles = topics.reduce((n, t) => n + t.items.length, 0)
  return (
    <F9PanelBlock className="overflow-hidden text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-[18px]">
        <p className="font-semibold">{dayLabel ? `What happened on ${dayLabel}` : "What's happening today"}</p>
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
          {[mood.length > 0 ? `${mood.length} on the market` : null, `${subjects.length} ${subjects.length === 1 ? 'topic' : 'topics'}`, `${articles} ${articles === 1 ? 'article' : 'articles'}`].filter(Boolean).join(' · ')}, sorted by the AI
        </span>
      </div>
      {mood.length > 0 && (
        <>
          <p className={STRIP_CLASS_BLOCK}>Market mood</p>
          {mood.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} mood />)}
          {/* With a mood strip above, the subjects get their own label, so the two read apart */}
          {subjects.length > 0 && <p className={STRIP_CLASS_BLOCK}>Topics</p>}
        </>
      )}
      {many.map(entry => <FeedTopicRowBlock key={entry.topic.id} entry={entry} sourceOf={sourceOf} onOpenItem={onOpenItem} />)}
      {singles.length > 0 && (
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
          ? <FeedTopicsPanelBlock topics={topics} sourceOf={sourceOf} onOpenItem={onOpenItem} dayLabel={dayLabel} />
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
