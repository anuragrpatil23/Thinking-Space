import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
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
    <Card>
      <CardHeader>
        <CardTitle>Set-based rhythm (experimental)</CardTitle>
        <CardDescription>
          Replaces the week rhythm on AI-Activity views with fixed 3-day "sets"
          anchored to the start of each month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-start justify-between gap-4 rounded-md border border-border/60 px-3 py-2.5">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">Group by 3-day sets instead of weeks</div>
            <p className="text-xs text-muted-foreground">
              The heatmap switches to a month/set layout — three rows (day 1, 2, 3
              of each set), day-of-month numbers shown inside cells, no weekday
              labels. The aggregate bar chart's <em>week</em> option is replaced
              by <em>set</em>. Sets are anchored to the 1st of each month; the
              last set can be a 1–2 day stub when the month length isn't
              divisible by 3. Off by default.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Group AI-Activity views by 3-day sets instead of weeks"
          />
        </label>
      </CardContent>
    </Card>
  )
}
