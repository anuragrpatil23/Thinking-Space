import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import type { OpenAskEntry } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One open ask — a question/idea from the old organizer that no undertaking has
// discharged. Same shared shell as an undertaking (so the two read as one
// language), with the differences that make an ask an ask: its `F9-IDE-E-…` ID
// chip earns its place (the head is a long sentence; the handle is worth
// showing), and the gutter carries how long it has sat — warming the older it
// gets — instead of a sparkline, because an ask has no sessions.

interface Props {
  entry: OpenAskEntry
  /** Position within the section, for the shared border palette. */
  colorIndex: number
}

// Age past which an open ask starts to read as neglected (warm tint deepens).
const STALE_DAYS = 90

function ageLabel(days: number): string {
  if (days < 45) return `${days}d`
  const months = days / 30.4
  return `${months.toFixed(months < 10 ? 1 : 0)} mo`
}

export default function OpenAskRowBlock({ entry, colorIndex }: Props) {
  const { ask, ageDays } = entry
  const warmth = Math.max(0, Math.min(0.85, (ageDays - STALE_DAYS) / (365 - STALE_DAYS)))
  const accent = warmth > 0 ? `rgba(217, 119, 6, ${0.4 + warmth * 0.5})` : undefined

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      idBadge={ask.key.toUpperCase()}
      title={ask.title}
      rightSlot={
        <span
          className="text-xs tabular-nums"
          style={{ color: accent }}
          title={`Open ${ageDays} day${ageDays === 1 ? '' : 's'}`}
        >
          {ageLabel(ageDays)}
        </span>
      }
    />
  )
}
