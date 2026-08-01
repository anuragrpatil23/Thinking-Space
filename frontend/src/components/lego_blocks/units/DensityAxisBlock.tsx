import { cn } from '@/lib/utils'

// The ruler for the index's density strips.
//
// The strips share one window, so a mark's *position* is the row's real signal —
// most undertakings are a single session on a single day, which makes amplitude
// dead information and "when" the only thing the strip can say. But a mark 60%
// along a bare track means nothing unless the track is named.
//
// Naming it per row is impossible (96px of column) and would be waste anyway —
// the axis is identical for every row. So it is stated once, here, above the
// list, and every track repeats only its *gridlines*. The ruler names the lines;
// the lines let each mark land against something.

/** Boundary positions inside the shared window, as fractions in [0, 1], with the
 *  label for each. Computed once and handed to both the ruler and the tracks. */
export interface DensityAxisTick {
  /** Position across the window, 0 = start, 1 = end. */
  at: number
  /** Short label — `'26` for a year boundary, `Apr` for a month. */
  label: string
}

const MS_PER_DAY = 86_400_000

function epochDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / MS_PER_DAY)
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Calendar boundaries inside [from, to], at whichever granularity gives a
 * readable number of them: years for a long window, quarters for a medium one,
 * months for a short one. Boundaries land where the calendar puts them, never at
 * even fractions of the window — a tick at "one third of the way through" is a
 * decoration, a tick at "January" is a fact you can reason from.
 */
export function densityAxisTicksBlock(from: string, to: string): DensityAxisTick[] {
  const fromDay = epochDay(from)
  const toDay = epochDay(to)
  if (fromDay === null || toDay === null || toDay <= fromDay) return []
  const span = toDay - fromDay + 1

  const start = new Date(fromDay * MS_PER_DAY)
  const end = new Date(toDay * MS_PER_DAY)

  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  // Aim for roughly 3–8 gridlines: more than that in 96px is hatching, fewer
  // leaves the marks floating again.
  const step = months > 36 ? 12 : months > 14 ? 6 : months > 6 ? 3 : 1

  const ticks: DensityAxisTick[] = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12))
  // Advance to the first boundary at or after the window start that lands on the
  // step grid, so the ticks are calendar-aligned rather than window-aligned.
  while (cursor.getUTCMonth() % step !== 0) cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  if (Math.floor(cursor.getTime() / MS_PER_DAY) < fromDay) {
    cursor.setUTCMonth(cursor.getUTCMonth() + step)
  }

  while (Math.floor(cursor.getTime() / MS_PER_DAY) <= toDay) {
    const day = Math.floor(cursor.getTime() / MS_PER_DAY)
    const month = cursor.getUTCMonth()
    ticks.push({
      at: (day - fromDay) / span,
      // A January boundary is labelled by its year — that is the fact it
      // carries; any other boundary is labelled by its month.
      label: month === 0 ? `'${String(cursor.getUTCFullYear()).slice(2)}` : MONTH_LABELS[month],
    })
    cursor.setUTCMonth(month + step)
  }

  return ticks
}

interface Props {
  ticks: DensityAxisTick[]
  /** Must match the strips' rendered width so the gridlines line up. */
  width: number
  className?: string
}

/** The labelled ruler. Labels are centred on their tick and clipped to the
 *  ruler's width, so a boundary near either end still reads. */
export default function DensityAxisBlock({ ticks, width, className }: Props) {
  if (ticks.length === 0) return null
  return (
    <div className={cn('relative shrink-0 select-none', className)} style={{ width }} aria-hidden>
      <div className="relative h-[9px]">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute top-0 h-[3px] w-px bg-foreground/20"
            style={{ left: `${t.at * 100}%` }}
          />
        ))}
        {ticks.map((t, i) => (
          <span
            key={`l-${i}`}
            className="absolute top-[3px] -translate-x-1/2 text-[8px] font-medium leading-none tracking-tight text-muted-foreground/50"
            style={{ left: `${t.at * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}
