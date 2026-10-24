import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { rssFeedIdsExcludedFromAllUnreadBlock, rssReaderFeedsBlock, type RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock, recentRssFeedsBlock, rssDayLabelBlock, rssLoudStoriesBlock, rssStoryPublishersBlock, type RssStoryBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { storyCardForBlock } from '@/services/orchestrators/rssStoryCardOrch'
import { readLastLibraryPassOrch } from '@/services/orchestrators/libraryFullTextOrch'
import { readLastValueLinePassOrch } from '@/personal_extension/services/orchestrators/webullValueLineOrch'
import { cn } from '@/lib/utils'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'
import { Bar, BarChart, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FEED_PASTELS_BLOCK, F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK, F9FactRowBlock, F9PanelBlock } from '../units/F9NativeBlock'
import { useStoryCardsBlock, type useFeedAiReadBlock } from './FeedAiReaderBlock'
import { FeedReadingNotesPanelBlock } from './FeedReadingNotesPanelBlock'

const LAST_SEEN_KEY_BLOCK = 'ltm-feed-overview-last-seen'

function readLastSeenBlock(): number {
  try { return Number(localStorage.getItem(LAST_SEEN_KEY_BLOCK)) || 0 } catch { return 0 }
}

const storyReadByAiBlock = (story: RssStoryBlock) => [story.lead, ...story.others].some(m => m.item.aiSummary)

// The last days as soft bars: stories, and how many each reader got through
function DayBarsBlock({ rows }: { rows: Array<{ day: string; stories: number; read: number; ai: number }> }) {
  const data = rows.map(r => ({ ...r, label: rssDayLabelBlock(r.day).replace(/^(\w+), /, '').replace('Yesterday', 'Yest.') }))
  const key = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px]" style={{ background: color }} />{label}</span>
  )
  return (
    <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">The last week</p>
        <span className="flex items-center gap-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {key(FEED_PASTELS_BLOCK.lavender.fill, 'Stories')}
          {key(FEED_PASTELS_BLOCK.mint.fill, 'Read by you')}
          {key(FEED_PASTELS_BLOCK.peach.fill, 'Read by the AI')}
        </span>
      </div>
        <div className="h-[170px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
              <YAxis width={30} tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} allowDecimals={false} tickCount={3} />
              <Tooltip
                cursor={{ fill: 'rgba(127,127,127,0.06)' }}
                contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
                labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
                formatter={(value, name) => [value, name === 'stories' ? 'Stories' : name === 'read' ? 'Read by you' : 'Read by the AI']}
              />
              <Bar dataKey="stories" fill={FEED_PASTELS_BLOCK.lavender.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="read" fill={FEED_PASTELS_BLOCK.mint.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="ai" fill={FEED_PASTELS_BLOCK.peach.fill} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
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

function ArrivalsChartBlock({ rows }: { rows: ReturnType<typeof feedArrivalsByHourBlock> }) {
  const key = (color: string, label: string, line?: boolean) => (
    <span className="inline-flex items-center gap-1.5"><span className={line ? 'h-0.5 w-3 rounded-full' : 'h-2 w-2 rounded-[3px]'} style={{ background: color }} />{label}</span>
  )
  return (
    <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">When it landed today</p>
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
              formatter={(value, name) => [value ?? '–', name === 'today' ? 'Today' : 'A usual day']}
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
export function FeedOverviewBlock({ reader, onOpenItem, chart, header }: {
  reader: ReturnType<typeof useFeedAiReadBlock>
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

  // Today, yesterday and the week are all this page shows: group only those
  // days, at low priority, so arriving feeds never hold up the page.
  const deferredFeeds = useDeferredValue(feeds)
  // Remembered across visits: the same feed snapshot never regroups
  const days = useMemo(
    () => identityMemoBlock('feed-overview-days', [deferredFeeds, preferences], () =>
      buildRssDayInboxBlock({ feeds: recentRssFeedsBlock(rssReaderFeedsBlock(deferredFeeds, preferences), 8), configs: preferences?.feeds ?? [] })),
    [deferredFeeds, preferences],
  )
  const todayStories = useMemo(
    () => (days[0] && rssDayLabelBlock(days[0].day) === 'Today' ? days[0].sources.flatMap(s => s.stories) : []),
    [days],
  )
  const newStories = useMemo(
    () => (lastSeen ? days.flatMap(d => d.sources.flatMap(s => s.stories)).filter(story => Date.parse(story.lead.item.pubDate ?? '') > lastSeen).length : null),
    [days, lastSeen],
  )
  const storyCards = useStoryCardsBlock()
  const loud = useMemo(() => rssLoudStoriesBlock(days, preferences?.feeds ?? []).slice(0, 10)
    .map(({ story, publishers }) => ({ story, publishers, names: rssStoryPublishersBlock(story).map(p => p.name), card: storyCardForBlock(story, storyCards) })),
  [days, preferences, storyCards])

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

  const history = days.filter(d => d.day !== 'undated').slice(0, 7).map(d => {
    const stories = d.sources.flatMap(s => s.stories)
    return { day: d.day, stories: stories.length, read: stories.filter(s => s.read).length, ai: stories.filter(storyReadByAiBlock).length }
  })

  const weekStories = history.reduce((n, d) => n + d.stories, 0)
  const arrivals = useMemo(
    () => identityMemoBlock('feed-overview-arrivals', [deferredFeeds, preferences], () =>
      feedArrivalsByHourBlock(recentRssFeedsBlock(rssReaderFeedsBlock(deferredFeeds, preferences), 8).flatMap(f => f.items))),
    [deferredFeeds, preferences],
  )

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      {/* The title spans both columns, so the charts and the side panels start level */}
      <div className="min-w-0 lg:col-span-2">{header}</div>
      <div className="flex min-w-0 flex-col gap-5">
        {todayStories.length > 0 && <ArrivalsChartBlock rows={arrivals} />}
        {history.length > 0 && <DayBarsBlock rows={[...history].reverse()} />}
        {chart}
        {loud.length > 0 && (
          <F9PanelBlock className="overflow-hidden text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-[18px]">
              <p className="font-semibold">Stories many are telling</p>
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400">carried by several publishers, today and yesterday; most first</span>
            </div>
            {loud.map(({ story, publishers, names, card }) => (
              <button
                key={story.lead.item.id}
                type="button"
                onClick={() => onOpenItem(story.lead.item)}
                className="flex w-full items-start gap-4 border-t-[0.5px] border-[#EFEFF2] px-5 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block leading-snug', story.read ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100')}>{story.lead.item.title}</span>
                  {card ? (
                    <>
                      <span className="mt-1.5 block text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300">{card.common}</span>
                      {card.differ && (
                        <span className="mt-1.5 block text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
                          <span className="mr-1.5 rounded bg-violet-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Differs</span>
                          {card.differ}
                        </span>
                      )}
                    </>
                  ) : story.lead.item.aiSummary && (
                    <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{story.lead.item.aiSummary.text.replace(/\n/g, ' ')}</span>
                  )}
                </span>
                <span className="w-[150px] shrink-0 pt-px text-right text-[12px] text-zinc-500 dark:text-zinc-400" title={names.join(', ')}>
                  <span className="block font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{publishers} sources</span>
                  <span className="mt-0.5 block leading-snug">{names.slice(0, 4).join(', ')}{names.length > 4 ? ` +${names.length - 4}` : ''}</span>
                </span>
              </button>
            ))}
          </F9PanelBlock>
        )}
      </div>

      {/* Where things stand, beside the charts */}
      <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
        <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
          <p className="font-semibold">Today</p>
          <p className="mt-2.5 text-2xl font-semibold tabular-nums">{todayStories.length} {todayStories.length === 1 ? 'story' : 'stories'}</p>
          <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {reader.progress
              ? reader.progress.kind === 'stories'
                ? `The AI is writing story cards · ${reader.progress.done} of ${reader.progress.total}`
                : `The AI is reading · ${reader.progress.done} of ${reader.progress.total}`
              : latest ? `Latest: ${latest.lead.feedTitle}, ${new Date(latest.lead.item.pubDate ?? '').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Nothing yet today'}
          </p>
          <ShareRowBlock divided label="Read by you" count={todayStories.filter(s => s.read).length} total={todayStories.length} color={FEED_PASTELS_BLOCK.mint.line} />
          <ShareRowBlock label="Read by the AI" count={todayStories.filter(storyReadByAiBlock).length} total={todayStories.length} color={FEED_PASTELS_BLOCK.peach.line} />
          {newStories !== null && <F9FactRowBlock divided label="New since your last visit" value={newStories} />}
          <F9FactRowBlock divided={newStories === null} label="This week" value={weekStories} sub={(() => { const read = history.reduce((n, d) => n + d.read, 0); return `${read} read by you${weekStories ? ` · ${Math.round((read / weekStories) * 100)}%` : ''}` })()} />
        </F9PanelBlock>

        <FeedReadingNotesPanelBlock feeds={feeds} onOpenItem={onOpenItem} />

        {sourcesToday.length > 0 && (
          <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
            <p className="mb-1 font-semibold">Where it came from today</p>
            {sourcesToday.map(([title, count], index) => (
              <F9FactRowBlock key={title} divided={index > 0} label={title} value={count} />
            ))}
          </F9PanelBlock>
        )}

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
