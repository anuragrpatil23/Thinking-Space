import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { replaceRssItemBlock, useRssFeedsBlock } from '@/components/lego_blocks/hooks/shared/useRssFeedsBlock'
import {
  feedAiReadAvailableOrch,
  feedAiUnreadItemsBlock,
  readFeedAiReaderOrch,
  readFeedAiReadProgressOrch,
  readLastFeedAiReadOrch,
  runFeedAiNextOrch,
  subscribeFeedAiReadOrch,
} from '@/services/orchestrators/rssAiReadOrch'
import { loadStoryCardsOrch, readStoryCardsOrch, subscribeStoryCardsOrch } from '@/services/orchestrators/rssStoryCardOrch'

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
