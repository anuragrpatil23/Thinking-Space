import { useState, useSyncExternalStore } from 'react'
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
import { resolveContractThinkingBlock, setSelectedAiThinkingForScopeBlock } from '@/services/lego_blocks/integrations/aiSettingsBlock'

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

/**
 * Settings → Webull: whether the local model thinks before it writes the
 * Feed's points, story cards and company names. The same Feed-area setting as
 * Settings → AI's per-area list. Off is about 45 minutes for 400 articles on
 * Qwen 27B; on is slower, perhaps sharper on rich articles.
 */
export function FeedAiThinkingSettingsRowBlock() {
  const [on, setOn] = useState(() => resolveContractThinkingBlock('feed', 'opensource-ai'))
  if (!feedAiReadAvailableOrch()) return null
  const local = feedAiReaderProviderOrch() === 'openai-compat'
  return (
    <SettingsRowBlock
      label="Thinking"
      description={local
        ? 'The local model thinks before it writes each article\'s points. Off is fastest (about 45 minutes for 400 articles); on is several times slower and may be sharper on rich articles.'
        : 'Applies to the local model; the AI reader is using another provider now.'}
      control={(
        <Switch
          checked={on}
          onCheckedChange={(next) => { setSelectedAiThinkingForScopeBlock('feed', 'opensource-ai', next); setOn(next) }}
          aria-label="Thinking for the AI reader"
        />
      )}
    />
  )
}
