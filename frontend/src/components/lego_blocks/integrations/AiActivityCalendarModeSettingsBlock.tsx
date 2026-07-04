import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
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
    <Card>
      <CardHeader>
        <CardTitle>Calendar view for heatmap</CardTitle>
        <CardDescription>
          Show day-of-month numbers inside heatmap cells — the same larger,
          number-labeled layout set-mode already uses, but without the 3-day
          markers or today’s-set ring.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2.5">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">Show day numbers in the heatmap</div>
            <p className="text-xs text-muted-foreground">
              Makes "what did I do on the 14th?" readable at a glance. Off by default.
              Ignored while <em>Group by 3-day sets</em> is on — set mode already
              uses this layout with its own decorations.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Show day-of-month numbers in the AI-Activity heatmap"
          />
        </label>
      </CardContent>
    </Card>
  )
}
