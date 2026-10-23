import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import RssArticleViewBlock from '@/components/lego_blocks/integrations/RssArticleViewBlock'
import RssFeedPanelBlock from '@/components/lego_blocks/integrations/RssFeedPanelBlock'
import { loadRssFeedsBlock, useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { loadRssItemByIdOrch, readRssFeedPreferencesOrch, updateRssFeedOrch } from '@/services/orchestrators/rssFeedOrch'
import {
  rssDailyVolumeBlock,
  rssFeedHealthBlock,
  type RssArticleNavStateBlock,
  type RssFeedItemBlock,
  type RssMergedViewsModeBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import { F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK, F9PanelBlock, F9SegmentedBlock } from '../units/F9NativeBlock'

// F9's Feed: the front of the loop, where things are first seen. The reader is
// the app's RSS reader (shared code); F9 hosts it as its own subtab. Sources
// shows how much of each source the app can actually show in full, and sets
// whether it reaches the merged views (All Unread, the timeline, the reels):
// a paywalled source on "Only when readable" keeps its dead links out.

type FeedViewBlock = 'reading' | 'sources'

interface OpenArticleBlock {
  item: RssFeedItemBlock
  onItemUpdate: (updated: RssFeedItemBlock) => void
  onItemRemove: () => void
  presetTags: string[]
  tagColors: Record<string, string>
}

const MODE_OPTIONS_BLOCK: Array<{ value: RssMergedViewsModeBlock; label: string }> = [
  { value: 'show', label: 'Show' },
  { value: 'readable', label: 'Only readable' },
  { value: 'hidden', label: 'Hide' },
]

// Articles per day over the last 30 days: how much arrives, and how much of it
// the app can show in full (the rest are teasers behind a paywall).
function VolumeChartBlock() {
  const { feeds } = useRssFeedsBlock()
  const data = useMemo(() => rssDailyVolumeBlock(feeds, new Date(), 30).map((d) => ({
    ...d,
    label: new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  })), [feeds])
  const total = data.reduce((n, d) => n + d.readable + d.teaser, 0)
  const readable = data.reduce((n, d) => n + d.readable, 0)
  return (
    <F9PanelBlock className="px-5 pb-3 pt-4 text-[13px]">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">Articles per day</p>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          last 30 days · {total} in all · <span className="text-emerald-600 dark:text-emerald-400">{readable} readable in full</span>
        </p>
      </div>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} interval={6} />
            <YAxis width={32} tick={{ fontSize: 10, fill: '#8E8E93' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'rgba(127,127,127,0.08)' }}
              contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
              labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
              formatter={(value, name) => [value, name === 'readable' ? 'Readable in full' : 'Teaser only']}
            />
            <Bar dataKey="readable" stackId="v" fill="#34C759" isAnimationActive={false} />
            <Bar dataKey="teaser" stackId="v" fill="#8E8E93" fillOpacity={0.45} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </F9PanelBlock>
  )
}

function SourcesBlock() {
  const { feeds, preferences } = useRssFeedsBlock()
  const [saving, setSaving] = useState<string | null>(null)
  const now = useMemo(() => new Date(), [])
  const groupName = useMemo(() => new Map((preferences?.groups ?? []).map((g) => [g.id, g.name])), [preferences])
  const healthById = useMemo(() => new Map(feeds.map((f) => [f.feedId, rssFeedHealthBlock(f, now)])), [feeds, now])
  const errorById = useMemo(() => new Map(feeds.map((f) => [f.feedId, f.error])), [feeds])
  const configs = useMemo(() => [...(preferences?.feeds ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [preferences])

  const setMode = useCallback(async (feedId: string, mode: RssMergedViewsModeBlock) => {
    setSaving(feedId)
    try {
      await updateRssFeedOrch(feedId, { inMergedViews: mode })
      await loadRssFeedsBlock(false, false)
    } finally {
      setSaving(null)
    }
  }, [])

  if (configs.length === 0) {
    return <F9PanelBlock className="px-5 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">No sources yet. Add feeds in Settings → RSS.</F9PanelBlock>
  }

  return (
    <F9PanelBlock className="overflow-hidden text-[13px]">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto] items-center gap-x-4 border-b-[0.5px] border-[#EFEFF2] px-5 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>Source</span><span>Readable in full</span><span>In All Unread and reels</span>
      </div>
      {configs.map((feed, i) => {
        const health = healthById.get(feed.id)
        const error = errorById.get(feed.id)
        const share = health && health.total > 0 ? health.readable / health.total : null
        return (
          <div key={feed.id} className={cn('grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto] items-center gap-x-4 px-5 py-2.5', i > 0 && 'border-t-[0.5px] border-[#EFEFF2] dark:border-zinc-800')}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{feed.title}</span>
              <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {[feed.groupId ? groupName.get(feed.groupId) : null, feed.fetchedExternally ? 'fetched by a tool' : null].filter(Boolean).join(' · ') || feed.url}
              </span>
            </span>
            <span className={cn('tabular-nums', share === null ? 'text-zinc-400' : share >= 0.8 ? 'text-emerald-600 dark:text-emerald-400' : share >= 0.3 ? 'text-zinc-700 dark:text-zinc-200' : 'text-amber-700 dark:text-amber-400')}>
              {error && !health?.total
                ? <span className="text-red-600 dark:text-red-400" title={error}>Not loading</span>
                : health && health.total > 0
                  ? <>{health.readable} of {health.total}{health.recent > 0 && <span className="text-zinc-500 dark:text-zinc-400"> · {health.recentReadable} of {health.recent} this week</span>}</>
                  : 'No items yet'}
            </span>
            <span className={cn(saving === feed.id && 'opacity-50')}>
              <F9SegmentedBlock
                ariaLabel={`${feed.title} in merged views`}
                value={feed.inMergedViews ?? 'show'}
                onChange={(mode) => { void setMode(feed.id, mode) }}
                options={MODE_OPTIONS_BLOCK}
              />
            </span>
          </div>
        )
      })}
    </F9PanelBlock>
  )
}

export default function WebullFeedBlock() {
  const { layout } = useUILayoutBlock()
  const { openFile } = useMarkdownViewer()
  const phone = layout.mode === 'phone'
  const [view, setView] = useState<FeedViewBlock>('reading')
  const [article, setArticle] = useState<OpenArticleBlock | null>(null)
  const [nav, setNav] = useState<RssArticleNavStateBlock | null>(null)
  const { feeds } = useRssFeedsBlock()

  // `?rss=<item id>` (from Reading's "Open in reader", or an old Explorer link) opens that article
  const [searchParams, setSearchParams] = useSearchParams()
  const itemFromRoute = searchParams.get('rss')
  useEffect(() => {
    if (!itemFromRoute) return
    let cancelled = false
    void (async () => {
      const [item, prefs] = await Promise.all([loadRssItemByIdOrch(itemFromRoute), readRssFeedPreferencesOrch()])
      if (cancelled) return
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('rss')
        return next
      }, { replace: true })
      if (!item) return
      setView('reading')
      setArticle({ item, onItemUpdate: () => {}, onItemRemove: () => {}, presetTags: prefs.presetTags, tagColors: prefs.tagColors })
    })()
    return () => { cancelled = true }
  }, [itemFromRoute, setSearchParams])

  const openArticle = useCallback((item: RssFeedItemBlock, onItemUpdate: (u: RssFeedItemBlock) => void, onItemRemove: () => void, presetTags: string[], tagColors: Record<string, string>) => {
    setArticle({ item, onItemUpdate, onItemRemove, presetTags, tagColors })
  }, [])

  const reader = article && (
    <RssArticleViewBlock
      key={article.item.id}
      item={article.item}
      onClose={() => setArticle(null)}
      onItemUpdate={(updated) => {
        setArticle((prev) => (prev ? { ...prev, item: updated } : null))
        article.onItemUpdate(updated)
      }}
      onMoved={(newPath) => {
        article.onItemRemove()
        setArticle(null)
        openFile(newPath, { mode: 'view' })
      }}
      presetTags={article.presetTags}
      tagColors={article.tagColors}
      nav={nav}
      appearance="native"
      sourceLabel={feeds.find((f) => f.feedId === article.item.feedId)?.feedTitle.replace(/\s*\(.*\)$/, '')}
    />
  )

  // On iPhone an open article is the next screen; the list waits underneath.
  if (phone && article) {
    return <div className="ltm-page-push-in -mx-7 -my-6 h-[calc(100dvh-1rem)] min-h-0">{reader}</div>
  }

  const panel = (
    <RssFeedPanelBlock
      appearance="native"
      onOpenArticle={openArticle}
      onNavStateChange={setNav}
      articleOpen={article !== null}
      onClose={() => setArticle(null)}
      className="h-full"
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">Feed</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">Where things are first seen. Write down what you notice.</p>
        </div>
        <F9SegmentedBlock ariaLabel="Feed view" value={view} onChange={setView} options={[{ value: 'reading', label: 'Reading' }, { value: 'sources', label: 'Sources' }]} />
      </header>

      {view === 'sources' ? (
        <div className="space-y-4 pb-12">
          <VolumeChartBlock />
          <SourcesBlock />
        </div>
      ) : phone ? (
        <div className="-mx-7 min-h-0 flex-1">{panel}</div>
      ) : (
        // Desktop: the list beside the article. The pair is pinned to the window's
        // height so the list and the article each scroll on their own, not the page.
        <div className="grid h-[calc(100dvh-12rem)] min-h-[420px] grid-cols-[minmax(300px,380px)_minmax(0,1fr)] gap-4">
          <F9PanelBlock className="flex min-h-0 flex-col overflow-hidden"><div className="h-full min-h-0 flex-1">{panel}</div></F9PanelBlock>
          <F9PanelBlock className="flex min-h-0 flex-col overflow-hidden">
            {reader
              // The reader fills its pane, as it does in the Explorer
              ? <div className="h-full min-h-0 flex-1">{reader}</div>
              : <p className="flex h-full items-center justify-center p-8 text-[13px] text-zinc-500 dark:text-zinc-400">Pick an article on the left.</p>}
          </F9PanelBlock>
        </div>
      )}
    </div>
  )
}
