import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  getAiActivitySetMode,
  setAiActivitySetMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

export default function AiActivitySetModeSettingsBlock() {
  const [enabled, setEnabled] = useState<boolean>(() => getAiActivitySetMode())

  const toggle = (checked: boolean) => {
    setAiActivitySetMode(checked)
    setEnabled(checked)
  }

  return (
    <SettingsGroupBlock
      heading="Set-based rhythm (experimental)"
      description={'Replaces the week rhythm on AI-Activity views with fixed 3-day "sets" anchored to the start of each month.'}
      footnote={<>The heatmap switches to a month/set layout — three rows, day-of-month numbers inside cells, no weekday labels. The aggregate chart's <em>week</em> option becomes <em>set</em>. The last set can be a 1–2 day stub when the month length isn't divisible by 3.</>}
    >
      <SettingsRowBlock
        as="label"
        label="Group by 3-day sets instead of weeks"
        description="Off by default."
        control={(
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Group AI-Activity views by 3-day sets instead of weeks"
          />
        )}
      />
    </SettingsGroupBlock>
  )
}
