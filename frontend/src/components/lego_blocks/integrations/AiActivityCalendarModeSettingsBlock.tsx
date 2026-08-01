import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  getAiActivityCalendarMode,
  setAiActivityCalendarMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

export default function AiActivityCalendarModeSettingsBlock() {
  const [enabled, setEnabled] = useState<boolean>(() => getAiActivityCalendarMode())

  const toggle = (checked: boolean) => {
    setAiActivityCalendarMode(checked)
    setEnabled(checked)
  }

  return (
    <SettingsGroupBlock heading="Calendar view for heatmap">
      <SettingsRowBlock
        as="label"
        label="Show day numbers in the heatmap"
        description={<>Makes "what did I do on the 14th?" readable at a glance. Off by default. Ignored while <em>Group by 3-day sets</em> is on — set mode already uses this layout with its own decorations.</>}
        control={(
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Show day-of-month numbers in the AI-Activity heatmap"
          />
        )}
      />
    </SettingsGroupBlock>
  )
}
