import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { rssFeedIdsExcludedFromAllUnreadBlock, rssReaderFeedsBlock, type RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock, recentRssFeedsBlock, rssDayLabelBlock, rssStoryOthersLabelBlock, type RssStoryBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { readLastLibraryPassOrch } from '@/services/orchestrators/libraryFullTextOrch'
import { readLastValueLinePassOrch } from '@/personal_extension/services/orchestrators/webullValueLineOrch'
import { cn } from '@/lib/utils'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FEED_PASTELS_BLOCK, F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK, F9FactRowBlock, F9PanelBlock } from '../units/F9NativeBlock'
import type { useFeedAiReadBlock } from './FeedAiReaderBlock'

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
  const loud = useMemo(() => days.slice(0, 2)
    .flatMap(d => d.sources.flatMap(s => s.stories))
    .map(story => ({ story, sources: new Set([story.lead, ...story.others].map(m => m.feedTitle)).size }))
    .filter(entry => entry.sources >= 2)
    .sort((a, b) => b.sources - a.sources)
    .slice(0, 8), [days])

  const warnings = useMemo(() => {
    const out: string[] = []
    const aiOnly = preferences ? rssFeedIdsExcludedFromAllUnreadBlock(preferences.groups, preferences.feeds) : new Set<string>()
    const failing = feeds.filter(f => f.error && f.items.length === 0)
    const mine = failing.filter(f => !aiOnly.has(f.feedId))
    const ai = failing.filter(f => aiOnly.has(f.feedId))
    if (mine.length) out.push(`${mine.length} ${mine.length === 1 ? 'source is' : 'sources are'} not loading: ${mine.slice(0, 3).map(f => f.feedTitle).join(', ')}${mine.length > 3 ? '…' : ''}`)
    if (ai.length) out.push(`${ai.length} of the AI's sources ${ai.length === 1 ? 'is' : 'are'} not loading`)
    if (reader.available && !reader.settings.on) out.push('The AI reader is off; turn it on in Sources.')
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

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        {chart}
        {history.length > 0 && <DayBarsBlock rows={[...history].reverse()} />}
        {loud.length > 0 && (
          <F9PanelBlock className="overflow-hidden text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-[18px]">
              <p className="font-semibold">Stories many are telling</p>
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400">carried by several sources, today and yesterday</span>
            </div>
            {loud.map(({ story, sources }) => {
              const others = rssStoryOthersLabelBlock(story)
              return (
                <button
                  key={story.lead.item.id}
                  type="button"
                  onClick={() => onOpenItem(story.lead.item)}
                  className="flex w-full items-start gap-4 border-t-[0.5px] border-[#EFEFF2] px-5 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block leading-snug', story.read ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100')}>{story.lead.item.title}</span>
                    {story.lead.item.aiSummary && <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{story.lead.item.aiSummary.text}</span>}
                  </span>
                  <span className="shrink-0 pt-px text-right text-[12px] text-zinc-500 dark:text-zinc-400" title={others?.title}>
                    {story.lead.feedTitle}
                    <span className="block tabular-nums text-zinc-400">{sources} sources</span>
                  </span>
                </button>
              )
            })}
          </F9PanelBlock>
        )}
      </div>

      {/* Where things stand, beside the charts */}
      <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
        <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
          <p className="font-semibold">Today</p>
          <p className="mt-2.5 text-2xl font-semibold tabular-nums">{todayStories.length} {todayStories.length === 1 ? 'story' : 'stories'}</p>
          <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {reader.progress
              ? `The AI is reading · ${reader.progress.done} of ${reader.progress.total}`
              : latest ? `Latest: ${latest.lead.feedTitle}, ${new Date(latest.lead.item.pubDate ?? '').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Nothing yet today'}
          </p>
          <F9FactRowBlock divided label="Read by you" value={todayStories.filter(s => s.read).length} />
          <F9FactRowBlock label="Read by the AI" value={todayStories.filter(storyReadByAiBlock).length} />
          {newStories !== null && <F9FactRowBlock divided label="New since your last visit" value={newStories} />}
          <F9FactRowBlock divided={newStories === null} label="This week" value={weekStories} sub={`${history.reduce((n, d) => n + d.read, 0)} read by you`} />
        </F9PanelBlock>

        {sourcesToday.length > 0 && (
          <F9PanelBlock className="px-4 py-3.5 text-[13px]">
            <p className="mb-1 font-semibold">Where it came from today</p>
            {sourcesToday.map(([title, count], index) => (
              <F9FactRowBlock key={title} divided={index > 0} label={title} value={count} />
            ))}
          </F9PanelBlock>
        )}

        {warnings.length > 0 && (
          <F9PanelBlock className="px-4 py-3.5 text-[13px]">
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
