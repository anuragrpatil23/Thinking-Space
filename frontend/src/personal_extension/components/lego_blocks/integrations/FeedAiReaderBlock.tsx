import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { replaceRssItemBlock, useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import {
  FEED_AI_PROVIDER_LABELS_BLOCK,
  feedAiReadAvailableOrch,
  feedAiReaderProviderOrch,
  feedAiUnreadItemsBlock,
  readFeedAiReaderOrch,
  readFeedAiReadProgressOrch,
  readLastFeedAiReadOrch,
  runFeedAiNextOrch,
  subscribeFeedAiReadOrch,
  writeFeedAiReaderOrch,
} from '@/services/orchestrators/rssAiReadOrch'
import { loadStoryCardsOrch, readStoryCardsOrch, subscribeStoryCardsOrch } from '@/services/orchestrators/rssStoryCardOrch'
import { F9PanelBlock } from '../units/F9NativeBlock'

/**
 * The AI reads the feed while the Feed is open on the desktop: a job starts
 * when there is something to do (the Feed opening, a refresh bringing new
 * articles, the reader being switched on) and the next when one ends. No
 * timers. Order and jobs: runFeedAiNextOrch.
 */
export function useFeedAiReadBlock() {
  const { feeds, preferences } = useRssFeedsBlock()
  const progress = useSyncExternalStore(subscribeFeedAiReadOrch, readFeedAiReadProgressOrch)
  // Settings changes notify the same subscribers; re-read them each time
  const settings = useMemo(() => readFeedAiReaderOrch(), [progress]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => feedAiUnreadItemsBlock(feeds).length, [feeds])
  const available = feedAiReadAvailableOrch()

  useEffect(() => {
    if (!available || !settings.on || progress) return
    void runFeedAiNextOrch(feeds, preferences, replaceRssItemBlock)
  }, [available, settings.on, waiting, preferences, progress === null]) // eslint-disable-line react-hooks/exhaustive-deps

  return { available, settings, progress, waiting, last: readLastFeedAiReadOrch() }
}

/** The story cards the AI has written (loaded from the vault once). */
export function useStoryCardsBlock() {
  useEffect(() => { void loadStoryCardsOrch() }, [])
  return useSyncExternalStore(subscribeStoryCardsOrch, readStoryCardsOrch)
}

/** Whether the AI reads the feed, and how it is going. The model is Settings → AI's. */
export function FeedAiReaderSettingsBlock({ reader }: { reader: ReturnType<typeof useFeedAiReadBlock> }) {
  const { available, settings, progress, waiting, last } = reader
  const navigate = useNavigate()
  const provider = FEED_AI_PROVIDER_LABELS_BLOCK[feedAiReaderProviderOrch()]
  const model = last?.model ? ` · ${last.model}` : ''

  const status = !available
    ? 'The AI reads from the desktop app; its summaries reach this device through the vault.'
    : !settings.on
      ? 'Off. Turn it on to have every new article summarised.'
      : progress
        ? progress.kind === 'stories'
          ? `Writing story cards · ${progress.done} of ${progress.total}`
          : `Reading · ${progress.done} of ${progress.total}`
        : waiting > 0
          ? `${waiting} waiting`
          : `Up to date${last?.read ? ` · ${last.read} read last time` : ''}`

  return (
    <F9PanelBlock className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
      <span className="font-semibold">AI reader</span>
      <span className="min-w-0 flex-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        {status}
        {!progress && last?.error && settings.on && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      </span>
      {available && (
        <span className="flex items-center gap-3 text-[12px]">
          {settings.on && (
            <button
              type="button"
              onClick={() => navigate('/settings?tab=ai')}
              title="The reader uses the app's AI settings"
              className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {provider}{model} · Settings → AI
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={settings.on}
            aria-label="AI reader"
            onClick={() => writeFeedAiReaderOrch({ on: !settings.on })}
            className={cn('relative h-5 w-9 rounded-full transition-colors', settings.on ? 'bg-zinc-800 dark:bg-zinc-200' : 'bg-zinc-300 dark:bg-zinc-700')}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform dark:bg-zinc-900', settings.on ? 'translate-x-4' : 'translate-x-0.5')} />
          </button>
        </span>
      )}
    </F9PanelBlock>
  )
}
