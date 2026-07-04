import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { cn } from '@/lib/utils'
import {
  getAiActivityRestDays,
  setAiActivityRestDays,
} from '@/services/lego_blocks/units/storageKeyBlock'

// Mon-first order matches the AI-Activity heatmap's row order — makes it
// easier to picture which cells will get the highlight when picking a day.
const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; short: string; long: string }> = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 0, short: 'Sun', long: 'Sunday' },
]

export default function AiActivityRestDaysSettingsBlock() {
  const [selected, setSelected] = useState<number[]>(() => getAiActivityRestDays())

  const toggle = (value: number) => {
    const next = selected.includes(value)
      ? selected.filter(v => v !== value)
      : [...selected, value]
    setAiActivityRestDays(next)
    setSelected(getAiActivityRestDays())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude Code reset day</CardTitle>
        <CardDescription>
          Pick the weekday your Claude Code weekly quota resets on. All instances
          of that weekday in the <em>current month</em> get a soft marker on
          AI-Activity views so you can pace against the next reset. Past months
          stay unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_OPTIONS.map(opt => {
            const active = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                aria-pressed={active}
                aria-label={opt.long}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-foreground/60 bg-foreground/10 text-foreground'
                    : 'border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {opt.short}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
