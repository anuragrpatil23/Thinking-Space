import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { checkPricesNowOrch, pricesAvailableOrch, readLastPricesPassOrch, readPricesPassProgressOrch, subscribePricesPassOrch } from '@/personal_extension/services/orchestrators/webullPricesOrch'
import { PassQueueListBlock } from '@/components/lego_blocks/units/PassQueueListBlock'
import type { PassItemBlock } from '@/services/lego_blocks/units/passQueueBlock'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtDayMonthBlock } from '@/services/lego_blocks/units/aiActivityStripBlock'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { askRssTopicsForDayOrch, setRssThemeListPathOrch } from '@/services/orchestrators/rssTopicOrch'
import { feedDayKeyBlock, parseFeedDayBlock, shiftFeedDayBlock } from '@/personal_extension/services/lego_blocks/units/feedDayBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { cn } from '@/lib/utils'
import RssArticleViewBlock from '@/components/lego_blocks/integrations/RssArticleViewBlock'
import RssFeedPanelBlock, { type RssThemeDigestEntryBlock } from '@/components/lego_blocks/integrations/RssFeedPanelBlock'
import { FeedThemeDigestViewBlock } from './FeedThemeDigestViewBlock'
import { loadRssFeedsBlock, replaceRssItemBlock, useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import { rssReaderFeedsBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { loadRssItemByIdOrch, readRssFeedPreferencesOrch, updateRssFeedOrch } from '@/services/orchestrators/rssFeedOrch'
import {
  libraryAvailableOrch,
  libraryPassDueOrch,
  readLastLibraryPassOrch,
  runLibraryPassOrch,
  type LibraryPassBlock,
} from '@/services/orchestrators/libraryFullTextOrch'
import {
  rssDailyVolumeBlock,
  rssFeedHealthBlock,
  rssFeedIdsExcludedFromAllUnreadBlock,
  rssMergedViewsModeBlock,
  type RssArticleNavStateBlock,
  type RssFeedItemBlock,
  type RssMergedViewsModeBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import { checkEarningsCallsNowOrch, earningsCallsAvailableOrch, readEarningsCallPassProgressOrch, readLastEarningsCallPassOrch, subscribeEarningsCallPassOrch } from '@/personal_extension/services/orchestrators/webullEarningsCallsOrch'
import { checkValueLineNowOrch, readLastValueLinePassOrch, readValueLinePassProgressOrch, subscribeValueLinePassOrch, valueLineAvailableOrch } from '@/personal_extension/services/orchestrators/webullValueLineOrch'
import { useFeedAiReadBlock } from './FeedAiReaderBlock'
import { FeedNoteCaptureBlock } from './FeedNoteCaptureBlock'
import { nameNoteCompaniesOrch, pickUpTaggedArticlesOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'
import { FeedOverviewBlock } from './FeedOverviewBlock'
import { identityMemoBlock } from '@/services/lego_blocks/units/identityMemoBlock'
import { WEBULL_FOLD_SIDEBAR_GROUPS_EVENT_BLOCK } from './WebullSidebarBlock'
import type { WebullUniverseCompanyBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'
import { FEED_DROPS_AVAILABLE, PrivateFeedDropsBlock } from '../units/privatePersonalBlock'
import { writeFeedReadLogsOrch } from '@/personal_extension/services/orchestrators/feedReadLogOrch'
import { readWebullExecutionSettingsOrch } from '@/personal_extension/services/orchestrators/webullExecutionSettingsOrch'
import { feedReadLogPathBlock, feedThemeListPathBlock } from '@/personal_extension/services/lego_blocks/units/feedReadLogBlock'
import { useReadingAttentionBlock } from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
import { F9_CHART_TOOLTIP_STYLE_BLOCK, F9PanelBlock, F9SegmentedBlock } from '../units/F9NativeBlock'

// F9's Feed: the front of the loop, where things are first seen. One product
// in three views: Overview (where things stand, what is loud, what needs
// attention, the last days), Reading (the inbox by day, one row per story,
// whoever read it — you or the AI), and Sources (settings and status: each
// source's trust and reels setting, the AI reader, the library, Value Line,
// and the sources only the AI reads). The reader itself is the app's RSS
// reader (shared code).

type FeedViewBlock = 'overview' | 'reading' | 'drops' | 'sources'

const TRUST_OPTIONS_BLOCK: Array<{ value: 'high' | 'normal' | 'low'; label: string }> = [
  { value: 'high', label: 'Trusted' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

// How far a source is trusted, as a quiet menu: decides which source a story
// shown by several is listed under. Nothing is hidden by it.
function TrustMenuBlock({ value, isDefault, label, onChange, disabled }: {
  value: 'high' | 'normal' | 'low' | 'mixed'
  isDefault?: boolean
  label: string
  onChange: (trust: 'high' | 'normal' | 'low') => void
  disabled?: boolean
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value as 'high' | 'normal' | 'low')}
      className={cn(
        'w-[76px] cursor-pointer appearance-none rounded-md bg-transparent py-0.5 pl-2 pr-1 text-right text-[12px] outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:opacity-50 dark:hover:bg-zinc-800',
        value === 'high' ? 'font-medium text-emerald-700 dark:text-emerald-400' : value === 'low' ? 'text-amber-700 dark:text-amber-400' : isDefault ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-200',
      )}
    >
      {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
      {TRUST_OPTIONS_BLOCK.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

interface OpenArticleBlock {
  item: RssFeedItemBlock
  onItemUpdate: (updated: RssFeedItemBlock) => void
  onItemRemove: () => void
  presetTags: string[]
  tagColors: Record<string, string>
}

const MODE_OPTIONS_BLOCK: Array<{ value: RssMergedViewsModeBlock; label: string }> = [
  { value: 'readable', label: 'Only readable' },
  { value: 'show', label: 'Everything' },
  { value: 'hidden', label: 'Hidden' },
]

// The library pass: fills paywalled articles with their text from Gale. Runs
// when the Feed opens or the app comes back to the front after a while (no
// timers), and from the button in Sources.
function useLibraryPassBlock() {
  const { feeds } = useRssFeedsBlock()
  const [last, setLast] = useState<LibraryPassBlock | null>(() => readLastLibraryPassOrch())
  const [progress, setProgress] = useState<{ done: number; total: number; items: PassItemBlock[] } | null>(null)
  const available = libraryAvailableOrch()

  const run = useCallback(async () => {
    if (!available || feeds.length === 0) return
    setProgress({ done: 0, total: 0, items: [] })
    try {
      // Filled articles are updated in place; reloading every feed re-read the whole cache
      const byId = new Map(feeds.flatMap((feed) => feed.items.map((item) => [item.id, item] as const)))
      const pass = await runLibraryPassOrch(feeds, (done, total, items) => setProgress({ done, total, items }), (itemId, text) => {
        const item = byId.get(itemId)
        if (item) replaceRssItemBlock({ ...item, description: text, textInCache: true })
      })
      setLast(pass)
    } finally {
      setProgress(null)
    }
  }, [available, feeds])

  useEffect(() => {
    if (!available || feeds.length === 0) return
    if (libraryPassDueOrch()) void run()
    const onVisible = () => { if (document.visibilityState === 'visible' && libraryPassDueOrch()) void run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // Feeds arriving is what makes a pass possible; run is stable per feeds
  }, [available, feeds.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  return { available, last, progress, run }
}

function minutesAgoBlock(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

function LibraryStatusBlock({ library, reader }: { library: ReturnType<typeof useLibraryPassBlock>; reader: ReturnType<typeof useFeedAiReadBlock> }) {
  const { available, last, progress, run } = library
  const [open, setOpen] = useState(false)
  if (!available) {
    return <p className="mx-1 text-[12px] text-zinc-500 dark:text-zinc-400">Library full text is filled in from the desktop app.</p>
  }
  return (
    <F9PanelBlock className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title="Show each article in the pass" className="inline-flex items-center gap-1 font-semibold hover:underline">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />Library
      </button>
      <span className="min-w-0 flex-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        {progress
          ? `Filling from the library${progress.total ? ` · ${progress.done} of ${progress.total}` : '…'}`
          : last
            ? [
              `${last.filled} ${last.filled === 1 ? 'article' : 'articles'} filled in, ${minutesAgoBlock(last.at)}`,
              ...last.sources.filter((src) => src.tried > 0).map((src) => `${src.name} ${src.filled} of ${src.tried}${src.citationOnly ? ` (${src.citationOnly} citation only)` : ''}`),
            ].join(' · ')
            : 'Not run yet'}
        {last?.error && !progress && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
        {!progress && <button type="button" onClick={() => { void run() }} className="ml-2 text-[#3b6fb6] hover:underline dark:text-sky-400">Check now</button>}
      </span>
      <button
        type="button"
        onClick={() => {
          // Different sources, own queues: they run side by side
          if (!progress) void run()
          void checkValueLineNowOrch()
          void checkEarningsCallsNowOrch()
          void checkPricesNowOrch()
          void reader.runNow()
        }}
        title="Library articles, Value Line, earnings calls and prices, now"
        className="text-[13px] text-sky-600 hover:text-sky-700 dark:text-sky-400"
      >
        Check all
      </button>
      {open && <div className="basis-full"><PassQueueListBlock items={progress?.items ?? last?.items ?? []} /></div>}
      <ValueLineStatusBlock />
      <EarningsCallsStatusBlock />
      <PricesStatusBlock />
      <AiReadsStatusBlock reader={reader} />
    </F9PanelBlock>
  )
}

// The daily Value Line pass runs from the F9 page (useValueLinePassBlock); this
// only reports the last one.
function ValueLineStatusBlock() {
  const [open, setOpen] = useState(false)
  const running = useSyncExternalStore(subscribeValueLinePassOrch, readValueLinePassProgressOrch)
  // Re-read the last pass whenever a pass moves or ends
  const last = useMemo(() => readLastValueLinePassOrch(), [running]) // eslint-disable-line react-hooks/exhaustive-deps
  const listBlock = (tickers: string[]) => (tickers.length > 4 ? `${tickers.slice(0, 4).join(', ')}…` : tickers.join(', '))
  return (
    <span className="basis-full text-[12px] text-zinc-500 dark:text-zinc-400">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title="Show each company in the pass" className="mr-2 inline-flex items-center gap-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />Value Line
      </button>
      {running
        ? `Fetching reports · ${running.done} of ${running.total}${running.fetched ? ` · ${running.fetched} new so far` : ''}`
        : last
        ? [
          last.fetched.length > 0 ? `${last.fetched.length} new ${last.fetched.length === 1 ? 'report' : 'reports'} (${listBlock(last.fetched)})` : 'No new reports',
          last.notCovered.length > 0 ? `${last.notCovered.length} not covered` : null,
          last.failed?.length ? `${last.failed.length} failed (${listBlock(last.failed)})` : null,
          minutesAgoBlock(last.at),
        ].filter(Boolean).join(' · ')
        : 'Not run yet; it runs when the F9 page opens'}
      {!running && last?.error && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      {!running && valueLineAvailableOrch() && (
        <button type="button" onClick={() => { void checkValueLineNowOrch() }} className="ml-2 text-[#3b6fb6] hover:underline dark:text-sky-400">Check now</button>
      )}
      {open && <PassQueueListBlock items={running?.items ?? last?.items ?? []} />}
    </span>
  )
}

// The AI reading the feed (switched on in Settings → Webull): each article it
// distils and each story card it writes, live, and what came of the last job.
function AiReadsStatusBlock({ reader }: { reader: ReturnType<typeof useFeedAiReadBlock> }) {
  const [open, setOpen] = useState(false)
  const { available, settings, progress, waiting, last, runNow } = reader
  if (!available) return null
  return (
    <span className="basis-full text-[12px] text-zinc-500 dark:text-zinc-400">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title="Show each article and story card in the job" className="mr-2 inline-flex items-center gap-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />AI reads
      </button>
      {!settings.on
        ? 'Off: turn it on in Settings → Webull'
        : progress
          ? (() => {
            // `waiting` is every article not yet read, this batch's unfinished ones included
            const after = progress.kind === 'articles' ? waiting - (progress.total - progress.done) : waiting
            return `${progress.kind === 'topics' ? 'Sorting today into topics' : progress.kind === 'stories' ? 'Writing story cards' : 'Reading'} · ${progress.done} of ${progress.total} in this batch${after > 0 ? ` · ${after} more after it` : ''}`
          })()
          : [
            waiting > 0 ? `${waiting} waiting` : 'Up to date',
            last?.read ? `${last.read} read last time` : null,
            last?.model || null,
            last ? minutesAgoBlock(last.at) : null,
          ].filter(Boolean).join(' · ')}
      {!progress && settings.on && last?.error && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      {!progress && settings.on && (
        <button type="button" onClick={() => { void runNow() }} className="ml-2 text-[#3b6fb6] hover:underline dark:text-sky-400">Check now</button>
      )}
      {open && <PassQueueListBlock items={progress?.items ?? last?.items ?? []} />}
    </span>
  )
}

// The daily prices pass runs beside Value Line's; this reports it.
function PricesStatusBlock() {
  const [open, setOpen] = useState(false)
  const running = useSyncExternalStore(subscribePricesPassOrch, readPricesPassProgressOrch)
  const last = useMemo(() => readLastPricesPassOrch(), [running]) // eslint-disable-line react-hooks/exhaustive-deps
  const listBlock = (tickers: string[]) => (tickers.length > 4 ? `${tickers.slice(0, 4).join(', ')}…` : tickers.join(', '))
  return (
    <span className="basis-full text-[12px] text-zinc-500 dark:text-zinc-400">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title="Show each company in the pass" className="mr-2 inline-flex items-center gap-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />Prices
      </button>
      {running
        ? `Fetching · ${running.done} of ${running.total}${running.fetched ? ` · ${running.fetched} updated` : ''}`
        : last
          ? [
            last.fetched.length > 0 ? `Updated ${listBlock(last.fetched)}` : 'Nothing new',
            last.failed.length > 0 ? `${last.failed.length} failed (${listBlock(last.failed)})` : null,
            minutesAgoBlock(last.at),
          ].filter(Boolean).join(' · ')
          : 'Not run yet; it runs when the F9 page opens'}
      {!running && last?.error && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      {!running && pricesAvailableOrch() && (
        <button type="button" onClick={() => { void checkPricesNowOrch() }} className="ml-2 text-[#3b6fb6] hover:underline dark:text-sky-400">Check now</button>
      )}
      {open && <PassQueueListBlock items={running?.items ?? last?.items ?? []} />}
    </span>
  )
}

// The daily earnings call pass runs beside Value Line's; this reports it.
function EarningsCallsStatusBlock() {
  const [open, setOpen] = useState(false)
  const running = useSyncExternalStore(subscribeEarningsCallPassOrch, readEarningsCallPassProgressOrch)
  const last = useMemo(() => readLastEarningsCallPassOrch(), [running]) // eslint-disable-line react-hooks/exhaustive-deps
  const listBlock = (tickers: string[]) => (tickers.length > 4 ? `${tickers.slice(0, 4).join(', ')}…` : tickers.join(', '))
  return (
    <span className="basis-full text-[12px] text-zinc-500 dark:text-zinc-400">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title="Show each company in the pass" className="mr-2 inline-flex items-center gap-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />Earnings calls
      </button>
      {running
        ? `Fetching · ${running.done} of ${running.total}${running.fetched ? ` · ${running.fetched} with new calls` : ''}`
        : last
          ? [
            last.fetched.length > 0 ? `New calls for ${listBlock(last.fetched)}` : 'No new calls',
            last.notCovered.length > 0 ? `${last.notCovered.length} not covered` : null,
            last.failed.length > 0 ? `${last.failed.length} failed (${listBlock(last.failed)})` : null,
            minutesAgoBlock(last.at),
          ].filter(Boolean).join(' · ')
          : 'Not run yet; it runs when the F9 page opens'}
      {!running && last?.error && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      {!running && earningsCallsAvailableOrch() && (
        <button type="button" onClick={() => { void checkEarningsCallsNowOrch() }} className="ml-2 text-[#3b6fb6] hover:underline dark:text-sky-400">Check now</button>
      )}
      {open && <PassQueueListBlock items={running?.items ?? last?.items ?? []} />}
    </span>
  )
}

// Articles per day over the last 30 days, one bar a day: the part the app can
// show in full at the bottom, headline-only on top, so the bar's height is
// everything that arrived. In full is part of all, so two overlapping smoothed
// areas drew one number twice and curved through days that never happened.
const VOLUME_COLORS_BLOCK = {
  // Your reading list in teal, the rest in two steps of one lavender; checked
  // with the dataviz palette validator in each mode.
  light: { list: '#1F9E89', full: '#5B52C9', teaser: '#A29BEC', grid: '#EFEFF2', cursor: 'rgba(0,0,0,0.04)' },
  dark: { list: '#2BA592', full: '#8C85E3', teaser: '#5B52C9', grid: '#27272a', cursor: 'rgba(255,255,255,0.05)' },
}

function VolumeTooltipBlock({ active, payload, colors }: {
  active?: boolean
  payload?: Array<{ payload: { label: string; all: number; inList: number; otherFull: number; teaser: number; today: boolean } }>
  colors: { list: string; full: string; teaser: string }
}) {
  const d = active ? payload?.[0]?.payload : undefined
  if (!d) return null
  const row = (color: string, name: string, value: number) => (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
      <span className="text-zinc-500 dark:text-zinc-400">{name}</span>
      <span className="ml-auto pl-4 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{value.toLocaleString()}</span>
    </div>
  )
  return (
    <div style={F9_CHART_TOOLTIP_STYLE_BLOCK} className="min-w-[150px] space-y-1 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-zinc-500 dark:text-zinc-400">{d.label}{d.today ? ', so far' : ''}</span>
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{d.all.toLocaleString()}</span>
      </div>
      {row(colors.list, 'In your reading list', d.inList)}
      {row(colors.full, 'In full, other sources', d.otherFull)}
      {row(colors.teaser, 'Headline only', d.teaser)}
    </div>
  )
}

function VolumeChartBlock({ day, onPickDay }: { day: string; onPickDay: (day: string) => void }) {
  const { feeds, preferences } = useRssFeedsBlock()
  const { hostRef, isDark } = useDarkModeClassBlock()
  const colors = isDark ? VOLUME_COLORS_BLOCK.dark : VOLUME_COLORS_BLOCK.light
  const data = useMemo(() => {
    const days = identityMemoBlock('feed-volume', [feeds, preferences, new Date().toDateString()], () => {
      // The reading list's articles: what the Reading tab and the stories count
      const listIds = new Set(rssReaderFeedsBlock(feeds, preferences).flatMap(f => f.items.map(item => item.id)))
      return rssDailyVolumeBlock(feeds, new Date(), 30, listIds)
    })
    return days.map((d, i) => ({
      day: d.day,
      all: d.readable + d.teaser,
      readable: d.readable,
      inList: d.inList,
      otherFull: d.readable - d.inList,
      teaser: d.teaser,
      today: i === days.length - 1,
      label: new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }))
  }, [feeds, preferences])
  const total = data.reduce((n, d) => n + d.all, 0)
  const readable = data.reduce((n, d) => n + d.readable, 0)
  // A day's average over the full days only; today is still arriving.
  const past = data.slice(0, -1)
  const average = past.length > 0 ? Math.round(past.reduce((n, d) => n + d.all, 0) / past.length) : 0
  const swatch = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  )
  const tick = { fontSize: 10, fill: isDark ? '#71717a' : '#8E8E93' }
  return (
    <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
      <div ref={hostRef} className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold">Articles per day</p>
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{total.toLocaleString()} in 30 days · {total > 0 ? Math.round((readable / total) * 100) : 0}% in full</span>
        </div>
        <span className="flex items-center gap-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {swatch(colors.list, 'Your reading list')}
          {swatch(colors.full, 'In full')}
          {swatch(colors.teaser, 'Headline only')}
        </span>
      </div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="22%"
            className="cursor-pointer"
            onClick={(state) => { const d = data[Number(state?.activeTooltipIndex)]; if (d) onPickDay(d.day) }}
          >
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={6} />
            <YAxis width={30} tick={tick} axisLine={false} tickLine={false} allowDecimals={false} tickCount={3} />
            <Tooltip cursor={{ fill: colors.cursor }} content={<VolumeTooltipBlock colors={colors} />} isAnimationActive={false} />
            {average > 0 && (
              <ReferenceLine
                y={average}
                stroke={isDark ? '#52525b' : '#C7C7CC'}
                strokeDasharray="3 3"
                label={{ value: `avg ${average}`, position: 'insideTopRight', fontSize: 10, fill: tick.fill }}
              />
            )}
            {/* The Feed's day at full strength, so the bar for the day shown stands out */}
            <Bar dataKey="inList" stackId="v" fill={colors.list} radius={[0, 0, 2, 2]} isAnimationActive={false}>
              {data.map(d => <Cell key={d.day} fillOpacity={d.day === day ? 1 : 0.55} />)}
            </Bar>
            <Bar dataKey="otherFull" stackId="v" fill={colors.full} isAnimationActive={false}>
              {data.map(d => <Cell key={d.day} fillOpacity={d.day === day ? 1 : 0.55} />)}
            </Bar>
            <Bar dataKey="teaser" stackId="v" fill={colors.teaser} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map(d => <Cell key={d.day} fillOpacity={d.day === day ? 1 : 0.55} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </F9PanelBlock>
  )
}

// The Feed's day, read as part of the title ("Feed for 31st Oct ‹ ›"), written
// the way AI activity writes its day. A click on the date opens the calendar,
// which also has its own Today; the arrows step a day. Every view but Sources
// shows this day.
const FEED_DAY_STEP_CLASS_BLOCK = 'flex items-center justify-center rounded-md p-[0.1em] text-foreground/40 hover:bg-zinc-200/70 hover:text-foreground/80 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800'

function FeedDayTitleBlock({ day, today, onPick }: { day: string; today: string; onPick: (day: string) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const { day: dayNumber, ordinal, month } = fmtDayMonthBlock(day)
  const openCalendar = () => {
    const input = pickerRef.current
    if (!input) return
    // A click on a date input opens its calendar only on its own icon; ask for it directly
    try { input.showPicker() } catch { input.focus(); input.click() }
  }
  return (
    // The same gap after "Feed" as between the words of the date
    <span className="relative ml-[0.4em] inline-flex items-baseline gap-[0.3em]">
      {/* AI activity's date, scaled to the title: one line box (leading-none),
          words on the baseline, the suffix at the top of the numeral beside it */}
      <button type="button" onClick={openCalendar} title="Pick a day" className="inline-flex items-baseline gap-[0.3em] whitespace-nowrap leading-none">
        <span className="font-normal text-foreground/40">for</span>
        <span className="flex items-start">
          <span className="tabular-nums">{dayNumber}</span>
          <span className="ml-[0.05em] text-[0.42em] font-medium leading-none tracking-tight text-foreground/60">{ordinal}</span>
        </span>
        <span className="font-normal text-foreground/40">{month}</span>
      </button>
      {/* A day back and a day on; the date itself opens the calendar */}
      <span className="inline-flex items-center gap-0.5 self-center">
        <button type="button" onClick={() => onPick(shiftFeedDayBlock(day, -1))} className={FEED_DAY_STEP_CLASS_BLOCK} aria-label="The day before" title="The day before">
          <ChevronLeft className="h-[0.6em] w-[0.6em]" />
        </button>
        <button type="button" onClick={() => onPick(shiftFeedDayBlock(day, 1))} disabled={day >= today} className={FEED_DAY_STEP_CLASS_BLOCK} aria-label="The day after" title="The day after">
          <ChevronRight className="h-[0.6em] w-[0.6em]" />
        </button>
      </span>
      <input
        ref={pickerRef}
        type="date"
        value={day}
        max={today}
        onChange={(e) => onPick(e.target.value || today)}
        tabIndex={-1}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-full opacity-0"
        aria-label="Feed day"
      />
    </span>
  )
}

// The merged-views setting as a quiet menu: the current choice reads as text,
// muted when it is the default.
function ModeMenuBlock({ value, isDefault, label, onChange, disabled }: {
  value: RssMergedViewsModeBlock | 'mixed'
  isDefault?: boolean
  label: string
  onChange: (mode: RssMergedViewsModeBlock) => void
  disabled?: boolean
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value as RssMergedViewsModeBlock)}
      className={cn(
        'cursor-pointer appearance-none rounded-md bg-transparent py-0.5 pl-2 pr-1 text-right text-[12px] outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:opacity-50 dark:hover:bg-zinc-800',
        isDefault ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-200',
      )}
    >
      {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
      {MODE_OPTIONS_BLOCK.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

/** Readable share this week (or overall when nothing arrived this week), 0..1, or null. */
function readableShareBlock(health: ReturnType<typeof rssFeedHealthBlock> | undefined): number | null {
  if (!health) return null
  if (health.recent > 0) return health.recentReadable / health.recent
  return health.total > 0 ? health.readable / health.total : null
}

function ReadableMeterBlock({ share, title }: { share: number | null; title: string }) {
  if (share === null) return <span className="text-[12px] text-zinc-400">No items</span>
  const pct = Math.round(share * 100)
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span className={cn('block h-full rounded-full', share >= 0.8 ? 'bg-emerald-500' : share >= 0.3 ? 'bg-zinc-400' : 'bg-amber-500')} style={{ width: `${Math.max(pct, 3)}%` }} />
      </span>
      <span className="w-9 text-right text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{pct}%</span>
    </span>
  )
}

// Every source and whether it reaches All Unread and the reels. Sources that
// need a decision come first; the rest sit in their folders, folded, with one
// setting per folder. Unset sources are "Only readable"
// (RSS_DEFAULT_MERGED_VIEWS_MODE_BLOCK), so a paywalled one stays quiet until
// the library fills it.
function SourcesBlock() {
  const { feeds, preferences } = useRssFeedsBlock()
  const [saving, setSaving] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const now = useMemo(() => new Date(), [])
  const healthById = useMemo(() => new Map(feeds.map((f) => [f.feedId, rssFeedHealthBlock(f, now)])), [feeds, now])
  const errorById = useMemo(() => new Map(feeds.map((f) => [f.feedId, f.error])), [feeds])

  // AI's sources: folders kept out of the merged views because a tool reads
  // them (Crowd, Filings). They get their own panel, without a reels setting.
  const aiFeedIds = useMemo(
    () => (preferences ? rssFeedIdsExcludedFromAllUnreadBlock(preferences.groups, preferences.feeds) : new Set<string>()),
    [preferences],
  )
  const groupsFor = useCallback((ai: boolean) => {
    const configs = [...(preferences?.feeds ?? [])]
      .filter((f) => aiFeedIds.has(f.id) === ai)
      .sort((a, b) => a.title.localeCompare(b.title))
    const order = (preferences?.groups ?? []).map((g) => ({ id: g.id, name: g.name }))
    const byGroup = new Map<string, typeof configs>()
    for (const feed of configs) {
      const key = feed.groupId && order.some((g) => g.id === feed.groupId) ? feed.groupId : ''
      byGroup.set(key, [...(byGroup.get(key) ?? []), feed])
    }
    return [...order, { id: '', name: 'Not in a folder' }]
      .filter((g) => byGroup.has(g.id))
      .map((g) => ({ ...g, feeds: byGroup.get(g.id)! }))
  }, [aiFeedIds, preferences])
  const groups = useMemo(() => groupsFor(false), [groupsFor])
  const aiGroups = useMemo(() => groupsFor(true), [groupsFor])
  const lastItemById = useMemo(() => new Map(feeds.map((f) => [f.feedId, f.items.reduce((max, i) => Math.max(max, Date.parse(i.pubDate ?? '') || 0), 0)])), [feeds])

  const attention = useMemo(() => groups.flatMap((g) => g.feeds).flatMap((feed): Array<{ feed: (typeof groups)[number]['feeds'][number]; reason: string; detail: string; tone: 'red' | 'amber' }> => {
    const health = healthById.get(feed.id)
    const error = errorById.get(feed.id)
    const mode = rssMergedViewsModeBlock(feed)
    if (mode === 'hidden') return []
    if (error && !health?.total) return [{ feed, reason: 'Not loading', detail: error, tone: 'red' }]
    const share = readableShareBlock(health)
    if (mode === 'show' && share !== null && share < 0.3) {
      return [{ feed, reason: `${Math.round(share * 100)}% readable, all shown`, detail: 'Teasers that open a paywall reach the reels', tone: 'amber' }]
    }
    return []
  }), [errorById, groups, healthById])

  const setTrust = useCallback(async (feedIds: string[], trust: 'high' | 'normal' | 'low', key: string) => {
    setSaving(key)
    try {
      for (const id of feedIds) await updateRssFeedOrch(id, { trust })
      await loadRssFeedsBlock(false, false)
    } finally {
      setSaving(null)
    }
  }, [])

  const setModes = useCallback(async (feedIds: string[], mode: RssMergedViewsModeBlock, key: string) => {
    setSaving(key)
    try {
      for (const id of feedIds) await updateRssFeedOrch(id, { inMergedViews: mode })
      await loadRssFeedsBlock(false, false)
    } finally {
      setSaving(null)
    }
  }, [])

  const toggleGroup = (id: string) => setOpenGroups((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (groups.length === 0 && aiGroups.length === 0) {
    return <F9PanelBlock className="px-5 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">No sources yet. Add feeds in Settings → RSS.</F9PanelBlock>
  }

  const sourceRow = (feed: (typeof groups)[number]['feeds'][number], indent: boolean) => {
    const health = healthById.get(feed.id)
    const error = errorById.get(feed.id)
    const share = readableShareBlock(health)
    const meterTitle = health && health.total > 0
      ? `${health.readable} of ${health.total} readable in full${health.recent > 0 ? ` · ${health.recentReadable} of ${health.recent} this week` : ''}`
      : 'No items yet'
    return (
      <div key={feed.id} className={cn('flex items-center gap-4 border-t-[0.5px] border-[#EFEFF2] py-2 pr-4 dark:border-zinc-800', indent ? 'pl-10' : 'pl-5')}>
        <span className="min-w-0 flex-1 truncate">{feed.title}</span>
        {error && !health?.total
          ? <span className="text-[12px] text-red-600 dark:text-red-400" title={error}>Not loading</span>
          : <ReadableMeterBlock share={share} title={meterTitle} />}
        <TrustMenuBlock
          label={`How far ${feed.title} is trusted`}
          value={feed.trust ?? 'normal'}
          isDefault={!feed.trust}
          disabled={saving !== null}
          onChange={(trust) => { void setTrust([feed.id], trust, feed.id) }}
        />
        <ModeMenuBlock
          label={`${feed.title} in All Unread and reels`}
          value={rssMergedViewsModeBlock(feed)}
          isDefault={!feed.inMergedViews}
          disabled={saving !== null}
          onChange={(mode) => { void setModes([feed.id], mode, feed.id) }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {attention.length > 0 && (
        <F9PanelBlock className="overflow-hidden text-[13px]">
          <div className="px-5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Needs attention</div>
          {attention.map(({ feed, reason, detail, tone }) => (
            <div key={feed.id} className="flex items-center gap-4 border-t-[0.5px] border-[#EFEFF2] py-2 pl-5 pr-4 dark:border-zinc-800">
              <span className="min-w-0 flex-1 truncate">{feed.title}</span>
              <span className={cn('text-[12px]', tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')} title={detail}>{reason}</span>
              <ModeMenuBlock
                label={`${feed.title} in All Unread and reels`}
                value={rssMergedViewsModeBlock(feed)}
                isDefault={!feed.inMergedViews}
                disabled={saving !== null}
                onChange={(mode) => { void setModes([feed.id], mode, feed.id) }}
              />
            </div>
          ))}
        </F9PanelBlock>
      )}

      <F9PanelBlock className="overflow-hidden text-[13px]">
        <div className="flex items-center gap-4 px-5 pb-1.5 pt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="flex-1 font-semibold uppercase tracking-wide">Sources</span>
          <span>Readable this week</span>
          <span className="w-[76px] text-right">Trust</span>
          <span className="w-[104px] text-right">In reels</span>
        </div>
        {groups.map((group) => {
          const open = openGroups.has(group.id)
          const modes = new Set(group.feeds.map(rssMergedViewsModeBlock))
          const groupMode = modes.size === 1 ? [...modes][0] : 'mixed'
          const shares = group.feeds.map((f) => healthById.get(f.id)).filter((h): h is NonNullable<typeof h> => Boolean(h))
          const recent = shares.reduce((n, h) => n + (h.recent || h.total), 0)
          const readable = shares.reduce((n, h) => n + (h.recent ? h.recentReadable : h.readable), 0)
          const failing = group.feeds.filter((f) => errorById.get(f.id) && !healthById.get(f.id)?.total).length
          return (
            <div key={group.id || 'none'}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => toggleGroup(group.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleGroup(group.id) } }}
                className="flex cursor-pointer items-center gap-4 border-t-[0.5px] border-[#EFEFF2] bg-zinc-50/70 py-2 pl-5 pr-4 transition-colors hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/60"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform', open && 'rotate-90')} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {group.name}
                  <span className="ml-2 font-normal text-zinc-400">{group.feeds.length}</span>
                  {failing > 0 && <span className="ml-2 text-[12px] font-normal text-red-600 dark:text-red-400">{failing} not loading</span>}
                </span>
                <ReadableMeterBlock share={recent > 0 ? readable / recent : null} title={`${readable} of ${recent} readable in full`} />
                <TrustMenuBlock
                  label={`How far every source in ${group.name} is trusted`}
                  value={(() => { const t = new Set(group.feeds.map((f) => f.trust ?? 'normal')); return t.size === 1 ? [...t][0] : 'mixed' })()}
                  disabled={saving !== null}
                  onChange={(trust) => { void setTrust(group.feeds.map((f) => f.id), trust, `group:${group.id}`) }}
                />
                <ModeMenuBlock
                  label={`Every source in ${group.name}`}
                  value={groupMode}
                  disabled={saving !== null}
                  onChange={(mode) => { void setModes(group.feeds.map((f) => f.id), mode, `group:${group.id}`) }}
                />
              </div>
              {open && group.feeds.map((feed) => sourceRow(feed, true))}
            </div>
          )
        })}
      </F9PanelBlock>

      {aiGroups.length > 0 && <AiReadsPanelBlock groups={aiGroups} healthById={healthById} errorById={errorById} lastItemById={lastItemById} />}
    </div>
  )
}

function daysAgoBlock(ms: number): string {
  if (!ms) return 'nothing yet'
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} d ago`
}

// What the AI reads for the briefs and the digest: crowd headlines and filings
// for the companies you track. Never in All Unread or the reels, so no setting
// here; what matters is that each source is alive, because a silent source
// means a thinner brief.
function AiReadsPanelBlock({ groups, healthById, errorById, lastItemById }: {
  groups: Array<{ id: string; name: string; feeds: Array<{ id: string; title: string }> }>
  healthById: Map<string, ReturnType<typeof rssFeedHealthBlock>>
  errorById: Map<string, string | null>
  lastItemById: Map<string, number>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const silent = (id: string) => (errorById.get(id) && !healthById.get(id)?.total) || Date.now() - (lastItemById.get(id) ?? 0) > 14 * 86_400_000
  return (
    <F9PanelBlock className="overflow-hidden text-[13px]">
      <div className="px-5 pb-2 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">AI reads</div>
        <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
          Crowd headlines and filings for the companies you track. The AI reads them for the briefs and the digest; they stay out of All Unread and the reels.
        </p>
      </div>
      {groups.map((group) => {
        const expanded = open.has(group.id)
        const thisWeek = group.feeds.reduce((n, f) => n + (healthById.get(f.id)?.recent ?? 0), 0)
        const quiet = group.feeds.filter((f) => silent(f.id))
        return (
          <div key={group.id || 'none'}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(group.id)}
              className="flex w-full items-center gap-4 border-t-[0.5px] border-[#EFEFF2] bg-zinc-50/70 py-2 pl-5 pr-4 text-left transition-colors hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/60"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform', expanded && 'rotate-90')} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {group.name.replace(/\s*\((?:Kai|AI) reads\)\s*$/i, '')}
                <span className="ml-2 font-normal text-zinc-400">{group.feeds.length}</span>
              </span>
              {quiet.length > 0 && <span className="text-[12px] text-amber-700 dark:text-amber-400" title={quiet.map((f) => f.title).join(', ')}>{quiet.length} silent</span>}
              <span className="w-[120px] text-right text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{thisWeek} this week</span>
            </button>
            {expanded && group.feeds.map((feed) => {
              const health = healthById.get(feed.id)
              const error = errorById.get(feed.id)
              return (
                <div key={feed.id} className="flex items-center gap-4 border-t-[0.5px] border-[#EFEFF2] py-2 pl-10 pr-4 dark:border-zinc-800">
                  <span className="min-w-0 flex-1 truncate">{feed.title}</span>
                  {error && !health?.total
                    ? <span className="text-[12px] text-red-600 dark:text-red-400" title={error}>Not loading</span>
                    : <span className={cn('text-[12px]', silent(feed.id) ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400')}>Last item {daysAgoBlock(lastItemById.get(feed.id) ?? 0)}</span>}
                  <span className="w-[120px] text-right text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{health?.recent ?? 0} this week</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </F9PanelBlock>
  )
}

export default function WebullFeedBlock({ companies = [] }: { companies?: WebullUniverseCompanyBlock[] }) {
  const dropGroups = useMemo(() => Object.fromEntries(companies.flatMap(c => (c.ticker ? [[c.ticker, c.group] as const] : []))), [companies])
  const { layout } = useUILayoutBlock()
  const { openFile } = useMarkdownViewer()
  const phone = layout.mode === 'phone'
  const [view, setView] = useState<FeedViewBlock>('overview')
  const [article, setArticle] = useState<OpenArticleBlock | null>(null)
  const [nav, setNav] = useState<RssArticleNavStateBlock | null>(null)
  const { feeds, preferences } = useRssFeedsBlock()
  const library = useLibraryPassBlock()
  const aiReader = useFeedAiReadBlock()

  // Reading the feed is reading, credited as one document per day — the day's
  // record (F9-execution/feed/<day>.md) — so a pass through many articles is one
  // sitting in AI activity, not a row per article. The surface is the whole
  // Reading view (list and article): moving between articles keeps the
  // sitting; only a real break ends it. Text read in the reader view and keys
  // in the list count; a page in the in-app browser cannot be seen inside.
  const readingSurfaceRef = useRef<HTMLDivElement>(null)
  const [feedLogRoot, setFeedLogRoot] = useState<string | null>(null)
  useEffect(() => {
    void readWebullExecutionSettingsOrch().then(s => setFeedLogRoot(s.executionFolderPath || null)).catch(() => setFeedLogRoot(null))
  }, [])
  // The AI's theme list is an F9 record: beside the day logs, F9-execution/feed/themes.md
  useEffect(() => {
    setRssThemeListPathOrch(feedLogRoot ? feedThemeListPathBlock(feedLogRoot) : null)
  }, [feedLogRoot])
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  useReadingAttentionBlock(view === 'reading' && feedLogRoot ? feedReadLogPathBlock(feedLogRoot, todayKey) : null, view === 'reading', {
    surfaceRef: readingSurfaceRef,
    title: `Feed · ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
    inputs: { surface: 'f9-feed', articleOpen: article !== null },
  })

  // Reading wants the room: fold the sidebar's business groups when it opens
  useEffect(() => {
    if (view === 'reading') window.dispatchEvent(new Event(WEBULL_FOLD_SIDEBAR_GROUPS_EVENT_BLOCK))
  }, [view])

  // The lasting record (F9-execution/feed/<day>.md): written when the Feed
  // opens, when the AI finishes a pass, and when the Feed is left — read marks
  // made while reading land with the next of these. No timers.
  const latestRef = useRef({ feeds, preferences })
  latestRef.current = { feeds, preferences }
  const feedsReady = feeds.length > 0
  const aiReading = aiReader.progress !== null
  useEffect(() => {
    if (!feedsReady || aiReading) return
    void writeFeedReadLogsOrch(latestRef.current.feeds, latestRef.current.preferences)
  }, [feedsReady, aiReading])
  useEffect(() => () => {
    void writeFeedReadLogsOrch(latestRef.current.feeds, latestRef.current.preferences)
  }, [])

  // Articles tagged to come back to (new company, understand more, …) land in
  // the reading notes, and from there in the Overview and Noticed
  useEffect(() => {
    if (!feedsReady) return
    // Then the AI names the companies each kept article is about
    void pickUpTaggedArticlesOrch(feeds).then(() => nameNoteCompaniesOrch(feeds))
  }, [feeds, feedsReady])

  // From Overview: open the story in Reading, the list by theme with its theme open and the article in view
  const [readingFocus, setReadingFocus] = useState<{ itemId: string; nonce: number } | null>(null)
  const openFromOverview = useCallback((item: RssFeedItemBlock) => {
    setView('reading')
    setReadingFocus(prev => ({ itemId: item.id, nonce: (prev?.nonce ?? 0) + 1 }))
    setArticle({ item, onItemUpdate: () => {}, onItemRemove: () => {}, presetTags: preferences?.presetTags ?? [], tagColors: preferences?.tagColors ?? {} })
  }, [preferences])

  // `?rss=<item id>` (from Reading's "Open in reader", or an old Explorer link) opens that article
  const [searchParams, setSearchParams] = useSearchParams()
  const itemFromRoute = searchParams.get('rss')

  // The Feed's day, kept in the address as `?day=YYYY-MM-DD` so every view
  // shows the same one; no `day` is today.
  const pickedDay = parseFeedDayBlock(searchParams.get('day'), todayKey)
  const feedDay = pickedDay ?? todayKey
  const pickDay = useCallback((next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next >= feedDayKeyBlock(new Date())) params.delete('day')
      else params.set('day', next)
      return params
    }, { replace: true })
  }, [setSearchParams])
  // A past day's topics are sorted while it is open, after today's
  useEffect(() => {
    askRssTopicsForDayOrch(pickedDay)
  }, [pickedDay])
  useEffect(() => () => askRssTopicsForDayOrch(null), [])
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

  // A theme's digest from the other sources, opened beside the list like an article
  const [digestEntry, setDigestEntry] = useState<RssThemeDigestEntryBlock | null>(null)
  const openArticle = useCallback((item: RssFeedItemBlock, onItemUpdate: (u: RssFeedItemBlock) => void, onItemRemove: () => void, presetTags: string[], tagColors: Record<string, string>) => {
    setDigestEntry(null)
    setArticle({ item, onItemUpdate, onItemRemove, presetTags, tagColors })
  }, [])
  const openDigest = useCallback((entry: RssThemeDigestEntryBlock) => {
    setArticle(null)
    setDigestEntry(entry)
  }, [])
  // An article opened from a digest: the digest stays, so closing the article returns to it
  const openFromDigest = useCallback((item: RssFeedItemBlock) => {
    setArticle({ item, onItemUpdate: () => {}, onItemRemove: () => {}, presetTags: preferences?.presetTags ?? [], tagColors: preferences?.tagColors ?? {} })
  }, [preferences])
  const digestView = digestEntry && (
    <FeedThemeDigestViewBlock entry={digestEntry} feeds={feeds} onOpenItem={openFromDigest} onClose={() => setDigestEntry(null)} />
  )

  const reader = article && (
    // Not keyed by article: the reader (and its in-app browser) stays mounted and
    // navigates, which makes stepping to the next article immediate
    <RssArticleViewBlock
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
      belowSummary={<FeedNoteCaptureBlock item={article.item} feedTitle={feeds.find((f) => f.feedId === article.item.feedId)?.feedTitle ?? ''} />}
    />
  )

  // On iPhone an open article (or digest) is the next screen; the list waits underneath.
  if (phone && (article || digestEntry)) {
    return <div ref={readingSurfaceRef} className="ltm-page-push-in -mx-7 -my-6 h-[calc(100dvh-1rem)] min-h-0">{reader || digestView}</div>
  }

  const panel = (
    <RssFeedPanelBlock
      appearance="native"
      onOpenArticle={openArticle}
      onNavStateChange={setNav}
      articleOpen={article !== null}
      onClose={() => setArticle(null)}
      className="h-full"
      day={feedDay}
      focus={readingFocus}
      onOpenDigest={openDigest}
      activeDigestKey={article ? null : digestEntry?.key ?? null}
    />
  )

  // Reading keeps the header to one line, so the list and the article get the height
  const compactHeader = view === 'reading' && !phone
  const header = (
      <header className={cn('flex flex-wrap justify-between gap-4', compactHeader ? 'items-center' : 'items-start')}>
        <div className="min-w-0">
          {/* "Feed" and the day it shows, as one title */}
          <h1 className={cn('font-bold leading-tight tracking-tight', compactHeader ? 'text-[20px]' : 'text-[26px]')}>
            Feed{view !== 'sources' && <FeedDayTitleBlock day={feedDay} today={todayKey} onPick={pickDay} />}
          </h1>
          {!compactHeader && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">Where things are first seen. Write down what you notice.</p>}
        </div>
        <F9SegmentedBlock ariaLabel="Feed view" value={view} onChange={setView} options={[
          { value: 'overview', label: 'Overview' },
          { value: 'reading', label: 'Reading' },
          ...(FEED_DROPS_AVAILABLE ? [{ value: 'drops' as const, label: 'Drops' }] : []),
          { value: 'sources', label: 'Sources' },
        ]} />
      </header>
  )

  if (view === 'drops' && PrivateFeedDropsBlock) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Suspense fallback={null}><PrivateFeedDropsBlock groups={dropGroups} day={pickedDay} /></Suspense>
      </div>
    )
  }

  if (view === 'overview') {
    return <FeedOverviewBlock reader={aiReader} onOpenItem={openFromOverview} chart={<VolumeChartBlock day={feedDay} onPickDay={pickDay} />} header={header} day={feedDay} onPickDay={pickDay} />
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", compactHeader ? "gap-3" : "gap-4")}>
      {header}

      {view === 'sources' ? (
        <div className="space-y-4 pb-12">
          <LibraryStatusBlock library={library} reader={aiReader} />
          <SourcesBlock />
        </div>
      ) : phone ? (
        <div ref={readingSurfaceRef} className="-mx-7 min-h-0 flex-1">{panel}</div>
      ) : (
        // Desktop: the list beside the article. The pair is pinned to the window's
        // height so the list and the article each scroll on their own, not the page.
        <div ref={readingSurfaceRef} className="grid h-[calc(100dvh-10rem)] min-h-[420px] grid-cols-[minmax(320px,400px)_minmax(0,1fr)] gap-3">
          <F9PanelBlock className="flex min-h-0 flex-col overflow-hidden"><div className="h-full min-h-0 flex-1">{panel}</div></F9PanelBlock>
          <F9PanelBlock className="flex min-h-0 flex-col overflow-hidden">
            {reader
              // The reader fills its pane, as it does in the Explorer
              ? <div className="h-full min-h-0 flex-1">{reader}</div>
              : digestView
                ? <div className="h-full min-h-0 flex-1">{digestView}</div>
                : <p className="flex h-full items-center justify-center p-8 text-[13px] text-zinc-500 dark:text-zinc-400">Pick an article on the left.</p>}
          </F9PanelBlock>
        </div>
      )}
    </div>
  )
}
