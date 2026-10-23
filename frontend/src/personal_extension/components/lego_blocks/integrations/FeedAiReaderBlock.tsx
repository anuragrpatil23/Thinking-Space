import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { replaceRssItemBlock, useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import {
  FEED_AI_PROVIDER_LABELS_BLOCK,
  feedAiReadAvailableOrch,
  feedAiUnreadItemsBlock,
  readFeedAiReaderOrch,
  readFeedAiReadProgressOrch,
  readLastFeedAiReadOrch,
  runFeedAiReadPassOrch,
  subscribeFeedAiReadOrch,
  writeFeedAiReaderOrch,
  type FeedAiReaderSettingsBlock,
} from '@/services/orchestrators/rssAiReadOrch'
import { F9PanelBlock } from '../units/F9NativeBlock'

/**
 * The AI reads the feed while the Feed is open on the desktop: a pass starts
 * when there are recent articles it has not read (the Feed opening, a refresh
 * bringing new ones, or the model being switched on). No timers.
 */
export function useFeedAiReadBlock() {
  const { feeds } = useRssFeedsBlock()
  const progress = useSyncExternalStore(subscribeFeedAiReadOrch, readFeedAiReadProgressOrch)
  // Settings changes notify the same subscribers; re-read them each time
  const settings = useMemo(() => readFeedAiReaderOrch(), [progress]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => feedAiUnreadItemsBlock(feeds).length, [feeds])
  const available = feedAiReadAvailableOrch()

  useEffect(() => {
    if (!available || settings.provider === 'off' || waiting === 0 || progress) return
    void runFeedAiReadPassOrch(feeds, replaceRssItemBlock)
    // A pass covers what is waiting now; new arrivals change `waiting` and start the next
  }, [available, settings.provider, settings.model, waiting]) // eslint-disable-line react-hooks/exhaustive-deps

  return { available, settings, progress, waiting, last: readLastFeedAiReadOrch() }
}

const PROVIDERS_BLOCK = Object.keys(FEED_AI_PROVIDER_LABELS_BLOCK) as Array<FeedAiReaderSettingsBlock['provider']>

/** Which model reads the feed, and how it is going. */
export function FeedAiReaderSettingsBlock({ reader }: { reader: ReturnType<typeof useFeedAiReadBlock> }) {
  const { available, settings, progress, waiting, last } = reader
  const [model, setModel] = useState(settings.model)
  useEffect(() => { setModel(settings.model) }, [settings.model])

  const status = !available
    ? 'The AI reads from the desktop app; its summaries reach this device through the vault.'
    : settings.provider === 'off'
      ? 'Off. Pick a model to have every new article summarised.'
      : progress
        ? `Reading · ${progress.done} of ${progress.total}`
        : waiting > 0
          ? `${waiting} waiting`
          : last
            ? `Up to date${last.read ? ` · ${last.read} read last time` : ''}${last.model ? ` with ${last.model}` : ''}`
            : 'Up to date'

  return (
    <F9PanelBlock className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
      <span className="font-semibold">AI reader</span>
      <span className="min-w-0 flex-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        {status}
        {!progress && last?.error && settings.provider !== 'off' && <span className="ml-2 text-red-600 dark:text-red-400">{last.error}</span>}
      </span>
      {available && (
        <span className="flex items-center gap-2">
          <select
            aria-label="Model that reads the feed"
            value={settings.provider}
            onChange={(event) => writeFeedAiReaderOrch({ ...settings, provider: event.target.value as FeedAiReaderSettingsBlock['provider'] })}
            className="rounded-md bg-zinc-100 px-2 py-1 text-[12px] outline-none dark:bg-zinc-800"
          >
            {PROVIDERS_BLOCK.map((id) => <option key={id} value={id}>{FEED_AI_PROVIDER_LABELS_BLOCK[id]}</option>)}
          </select>
          {settings.provider !== 'off' && (
            <input
              aria-label="Model name"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => { if (model.trim() !== settings.model) writeFeedAiReaderOrch({ ...settings, model: model.trim() }) }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              placeholder="Default model"
              className={cn('w-40 rounded-md bg-zinc-100 px-2 py-1 text-[12px] outline-none dark:bg-zinc-800')}
            />
          )}
        </span>
      )}
    </F9PanelBlock>
  )
}
