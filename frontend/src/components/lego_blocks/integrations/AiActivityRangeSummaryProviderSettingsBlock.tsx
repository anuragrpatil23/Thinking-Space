import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { cn } from '@/lib/utils'
import {
  getAiActivityRangeSummaryProvider,
  setAiActivityRangeSummaryProvider,
  type AiActivityRangeSummaryProvider,
} from '@/services/lego_blocks/units/storageKeyBlock'

interface Option {
  id: AiActivityRangeSummaryProvider
  label: string
  description: string
}

const OPTIONS: Option[] = [
  {
    id: 'off',
    label: 'Off · rules-based',
    description:
      'No model calls. Range summaries list chain titles ranked by time; if titles are missing the summary falls back to a chain / message / duration count. Badged as "rules" in the UI.',
  },
  {
    id: 'local',
    label: 'Local · two-stage pipeline',
    description:
      'Runs a label + narrate pipeline on the configured local intelligence provider. Free and private, but quality drops on ranges wider than ~7 chains — falls through to the deterministic fallback on failure.',
  },
  {
    id: 'claude-cli',
    label: 'Claude CLI · one-shot',
    description:
      'Routes through `claude -p` in one shot. Handles any range size reliably, uses your Pro-plan subscription (no separate API key). Falls through to the deterministic fallback if the CLI is unavailable.',
  },
]

export default function AiActivityRangeSummaryProviderSettingsBlock() {
  const [selected, setSelected] = useState<AiActivityRangeSummaryProvider>(() =>
    getAiActivityRangeSummaryProvider(),
  )

  const pick = (id: AiActivityRangeSummaryProvider) => {
    setAiActivityRangeSummaryProvider(id)
    setSelected(id)
  }

  return (
    <SettingsGroupBlock
      heading="Range summary provider"
      description={'Which path generates the "This Week" and multi-day range summaries. Independent of the per-chain digest toggle — range summaries need more reasoning across sessions and the tradeoffs differ.'}
    >
      {OPTIONS.map(opt => {
        const active = selected === opt.id
        return (
          <SettingsRowBlock
            key={opt.id}
            as="label"
            className={cn('cursor-pointer transition-colors', active && 'bg-primary/5')}
            label={opt.label}
            description={opt.description}
            control={(
              <input
                type="radio"
                name="ai-activity-range-summary-provider"
                checked={active}
                onChange={() => pick(opt.id)}
              />
            )}
          />
        )
      })}
    </SettingsGroupBlock>
  )
}
