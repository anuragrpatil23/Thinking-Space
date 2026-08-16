// Work-mix mode + the daily pool it measures against.
//
// The pool is user-set rather than fixed because the ceiling on focused work is
// personal, and because it is the shared denominator that makes the fill and
// the ring comparable at all: "building took a slot's worth" only means
// something if a slot means one thing on both sides of the cell.

import { useEffect, useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  AI_ACTIVITY_POOL_HOURS_MAX,
  AI_ACTIVITY_POOL_HOURS_MIN,
  getAiActivityThinkingPoolHours,
  getAiActivityWorkMixMode,
  setAiActivityThinkingPoolHours,
  setAiActivityWorkMixMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

export default function AiActivityWorkMixSettingsBlock() {
  const [enabled, setEnabled] = useState<boolean>(() => getAiActivityWorkMixMode())
  const [hours, setHours] = useState<number>(() => getAiActivityThinkingPoolHours())
  // Kept as text while editing so a half-typed "1" does not immediately clamp
  // to the minimum and fight the user's next keystroke.
  const [draft, setDraft] = useState<string>(() => String(getAiActivityThinkingPoolHours()))
  useEffect(() => setDraft(String(hours)), [hours])

  const toggle = (checked: boolean) => {
    setAiActivityWorkMixMode(checked)
    setEnabled(checked)
  }

  const commitHours = () => {
    const parsed = Number.parseFloat(draft)
    const next = Number.isFinite(parsed) ? parsed : hours
    setAiActivityThinkingPoolHours(next)
    setHours(getAiActivityThinkingPoolHours())
  }

  return (
    <SettingsGroupBlock heading="Work mix">
      <SettingsRowBlock
        as="label"
        label="Color days by kind of work"
        description={
          <>
            The heatmap becomes activity rings and answers a different question: did
            thinking happen, and if not, what took the day. The centre is thinking, the
            outer ring building, the innermost ring maintenance — each in its project's
            own color. Set each project's kind under <em>Settings ▸ Projects</em>; time on
            projects you haven't classified draws a green track between the two, so it is
            visible without being counted as measured work.
          </>
        }
        control={
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Color AI-Activity days by kind of work"
          />
        }
      />
      <SettingsRowBlock
        as="label"
        label="Hours of focused work in a day"
        description={
          <>
            What a full cell means. Both the fill and the ring are measured against this,
            so a full ring reads as “this took a whole slot”. Most people top out around
            four hours of genuinely effortful work.
          </>
        }
        control={
          <input
            type="number"
            inputMode="decimal"
            step={0.25}
            min={AI_ACTIVITY_POOL_HOURS_MIN}
            max={AI_ACTIVITY_POOL_HOURS_MAX}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitHours}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label="Hours of focused work in a day"
            className="h-8 w-20 rounded-md border border-border/60 bg-background px-2 text-right text-sm tabular-nums"
          />
        }
      />
    </SettingsGroupBlock>
  )
}
