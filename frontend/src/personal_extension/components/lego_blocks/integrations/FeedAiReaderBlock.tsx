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
import { loadRssTopicsOrch, readAskedRssTopicsDayOrch, readRssTopicsOrch, subscribeRssTopicsOrch } from '@/services/orchestrators/rssTopicOrch'

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
  // Opening a past day asks for its topics: that is something to do
  const askedDay = useSyncExternalStore(subscribeRssTopicsOrch, readAskedRssTopicsDayOrch)

  useEffect(() => {
    if (!available || !settings.on || progress) return
    void runFeedAiNextOrch(feeds, preferences, replaceRssItemBlock)
  }, [available, settings.on, waiting, preferences, progress === null, askedDay]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Check now" / "Run the AI now": the next job, whatever is waiting, even
  // within the wait after the provider was down (a job already running is
  // shared). When it ends the effect above starts the next, so one press runs
  // until nothing is left.
  const runNow = () => runFeedAiNextOrch(feeds, preferences, replaceRssItemBlock, true)

  return { available, settings, progress, waiting, last: readLastFeedAiReadOrch(), runNow }
}

/** A day's topics the AI has sorted the news into, today by default (loaded from the vault once). */
export function useRssTopicsBlock(day?: string) {
  useEffect(() => { void loadRssTopicsOrch(day) }, [day])
  return useSyncExternalStore(subscribeRssTopicsOrch, () => readRssTopicsOrch(day))
}

/** The story cards the AI has written (loaded from the vault once). */
export function useStoryCardsBlock() {
  useEffect(() => { void loadStoryCardsOrch() }, [])
  return useSyncExternalStore(subscribeStoryCardsOrch, readStoryCardsOrch)
}
