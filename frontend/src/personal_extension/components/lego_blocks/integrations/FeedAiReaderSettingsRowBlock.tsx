import { useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  FEED_AI_PROVIDER_LABELS_BLOCK,
  feedAiReadAvailableOrch,
  feedAiReaderProviderOrch,
  readFeedAiReaderOrch,
  readLastFeedAiReadOrch,
  subscribeFeedAiReadOrch,
  writeFeedAiReaderOrch,
} from '@/services/orchestrators/rssAiReadOrch'

/**
 * Settings → Webull: whether the AI reads the Feed. The model is Settings →
 * AI's; how far it has got shows on the Feed's Overview.
 */
export function FeedAiReaderSettingsRowBlock() {
  // Settings changes notify the reader's subscribers; re-read on each
  useSyncExternalStore(subscribeFeedAiReadOrch, () => readFeedAiReaderOrch().on)
  const on = readFeedAiReaderOrch().on
  const last = readLastFeedAiReadOrch()
  const model = `${FEED_AI_PROVIDER_LABELS_BLOCK[feedAiReaderProviderOrch()]}${last?.model ? ` · ${last.model}` : ''}`
  return (
    <SettingsRowBlock
      label="AI reader"
      description={feedAiReadAvailableOrch()
        ? <>Distils every new article and writes story cards, while the Feed is open. Uses the AI settings: {model} (<Link to="/settings?tab=ai" className="underline">change</Link>).</>
        : 'The AI reads from the desktop app; its summaries reach this device through the vault.'}
      control={feedAiReadAvailableOrch() ? (
        <Switch checked={on} onCheckedChange={(next) => writeFeedAiReaderOrch({ on: next })} aria-label="AI reader" />
      ) : undefined}
    />
  )
}
