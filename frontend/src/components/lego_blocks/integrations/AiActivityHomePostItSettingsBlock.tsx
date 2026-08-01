import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  getAiActivityHomePostItEnabled,
  setAiActivityHomePostItEnabled,
} from '@/services/lego_blocks/units/storageKeyBlock'

export default function AiActivityHomePostItSettingsBlock() {
  const [enabled, setEnabled] = useState<boolean>(() => getAiActivityHomePostItEnabled())

  const toggle = (checked: boolean) => {
    setAiActivityHomePostItEnabled(checked)
    setEnabled(checked)
  }

  return (
    <SettingsGroupBlock
      heading="Home canvas"
      description="AI-activity surfaces drawn onto the home canvas."
    >
      <SettingsRowBlock
        as="label"
        label="Auto-draft daily activity post-it"
        description={'Pins a "what I did with AI today" post-it to the home canvas and appends new sessions to it through the day. The This Week digest card covers the same ground, so this is off by default; existing post-its are left alone when off.'}
        control={(
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Auto-draft daily AI activity post-it on the home canvas"
          />
        )}
      />
    </SettingsGroupBlock>
  )
}
