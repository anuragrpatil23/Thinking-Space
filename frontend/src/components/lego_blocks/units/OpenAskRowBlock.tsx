import type { OpenAskEntry } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One open ask — a question/idea from the old organizer that no undertaking has
// discharged. Same row skeleton as an undertaking (so the two read as one
// language), with the differences that make an ask an ask:
//
//   ◇ hollow glyph      — open, forward, not yet a doing.
//   [F9-IDE-E-534] chip — the ID earns its place here (an ask's head is a long
//                          sentence; its handle is worth showing), where it
//                          would only echo the title on an undertaking.
//   age, not sparkline  — an ask has no sessions. What matters is how long it
//                          has sat; the gutter carries the age, tinted warmer
//                          the longer it's gone unanswered, so the most-
//                          neglected asks surface by scanning down the column.
//
// No status, same as the undertaking row — the whole point of the redesign.

interface Props {
  entry: OpenAskEntry
}

// Age past which an open ask starts to read as neglected (warm tint deepens).
const STALE_DAYS = 90

function ageLabel(days: number): string {
  if (days < 45) return `${days}d`
  const months = days / 30.4
  return `${months.toFixed(months < 10 ? 1 : 0)} mo`
}

export default function OpenAskRowBlock({ entry }: Props) {
  const { ask, ageDays } = entry
  // Warmth ramps from the stale threshold to ~1 year; capped so nothing screams.
  const warmth = Math.max(0, Math.min(0.85, (ageDays - STALE_DAYS) / (365 - STALE_DAYS)))
  const accent = warmth > 0 ? `rgba(217, 119, 6, ${0.25 + warmth * 0.55})` : undefined

  return (
    <div
      className="flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-2 py-1"
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      {/* Hollow glyph — open ask. */}
      <span className="shrink-0 text-[9px] leading-none text-muted-foreground/50" aria-hidden>◇</span>

      {/* ID chip — the stable handle. */}
      <span className="shrink-0 rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground/70">
        {ask.key.toUpperCase()}
      </span>

      {/* Head. */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/85" title={ask.title}>
        {ask.title}
      </span>

      {/* Gutter: age, warm-tinted with neglect. Matches the undertaking gutter
          width so the two row kinds line up. */}
      <span className="flex w-32 shrink-0 items-center justify-end">
        <span
          className="text-xs tabular-nums"
          style={{ color: accent ?? undefined }}
          title={`Open ${ageDays} day${ageDays === 1 ? '' : 's'}`}
        >
          {ageLabel(ageDays)}
        </span>
      </span>
    </div>
  )
}
