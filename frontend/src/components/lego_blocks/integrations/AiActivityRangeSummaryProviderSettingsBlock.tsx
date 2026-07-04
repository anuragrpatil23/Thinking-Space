import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
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
    <Card>
      <CardHeader>
        <CardTitle>Range summary provider</CardTitle>
        <CardDescription>
          Which path generates the "This Week" and multi-day range summaries.
          Independent of the per-chain digest toggle above — range summaries
          require more reasoning across sessions and the tradeoffs are different.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="space-y-2">
          {OPTIONS.map(opt => {
            const active = selected === opt.id
            return (
              <label
                key={opt.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border/60 hover:border-border',
                )}
              >
                <input
                  type="radio"
                  name="ai-activity-range-summary-provider"
                  className="mt-0.5"
                  checked={active}
                  onChange={() => pick(opt.id)}
                />
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">{opt.label}</div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </label>
            )
          })}
        </fieldset>
      </CardContent>
    </Card>
  )
}
