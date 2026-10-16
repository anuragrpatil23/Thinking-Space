import { useMemo, useState } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  type TimeOfDaySegmentBlock,
  packTimeOfDayRowBlock,
  timeOfDaySegmentsBlock,
  timeOfDayTotalsBlock,
} from '@/services/lego_blocks/units/aiActivityTimeOfDayBlock'
import { fmtDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { CHART_GUTTER_PX, LEGEND_TOP_PROJECTS, getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import {
  projectKindLabelBlock,
  projectKindStrokeBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { cn } from '@/lib/utils'

// The Trend section's default view: one row per day, sessions placed on the
// clock (12a → 12a). The same language as the day card's single-day timeline
// strip above, stacked for the range — the top shows today in detail, this
// shows the week's pattern. Click a row to drill into that day.
//
// Overlapping sessions split the row into two lanes, each solid: drawn
// translucent on top of each other, two project colours mixed into a third that
// belonged to nobody. Same-project blocks a few minutes apart are fused first.

const DAY_MIN = 24 * 60
/** Plan usage's axis-tick grey, so both charts' labels read as one set. */
const AXIS_TEXT = 'rgba(148,163,184,0.7)'
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]
/** Faint guides at the user's day markers (hours, fractional for :15 etc.).
 *  Fixed for now; the natural home is the thinking-window setting. */
const GUIDE_HOURS = [8.5, 12, 14.25, 18, 21, 23]

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Row label: just the ordinal (`10th`). The month only appears on the 1st of a
 *  month when the range crosses one, so a 30-day view still says where it turned. */
function fmtRowDay(day: string, crossesMonth: boolean): string {
  const [, m, d] = day.split('-').map(Number)
  return crossesMonth && d === 1 ? `${MONTH_SHORT[m - 1]} ${ordinal(d)}` : ordinal(d)
}

function fmtHourTick(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${h % 24 < 12 ? 'a' : 'p'}`
}

/** Row-end totals, rounded so the column reads at a glance: half hours from an
 *  hour up (`8.5h`), five minutes below (`45m`). Exact value is on hover. */
function fmtApproxMin(min: number): string {
  if (min < 60) return `${Math.max(5, Math.round(min / 5) * 5)}m`
  const half = Math.round(min / 30) / 2
  return `${Number.isInteger(half) ? half : half.toFixed(1)}h`
}

function fmtWeekday(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

interface Props {
  /** Local dates in range (`YYYY-MM-DD`), any order. */
  days: string[]
  chains: ActivityChain[]
  filterProject?: string | null
  colorBy: 'project' | 'kind'
  kindByProject: Record<string, ProjectKindBlock>
  selectedDate?: string | null
  onSelectDate?: (date: string | null) => void
}

export default function AiActivityTimeOfDayChartBlock({
  days,
  chains,
  filterProject,
  colorBy,
  kindByProject,
  selectedDate,
  onSelectDate,
}: Props) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const sortedDays = useMemo(() => [...days].sort(), [days])
  const segmentsByDay = useMemo(
    () => timeOfDaySegmentsBlock(sortedDays, chains.flatMap(c => c.sessions), filterProject),
    [sortedDays, chains, filterProject],
  )

  // One row per day, one bar thickness. Lanes were tried (2026-10-16): halved
  // they read as hairlines, stacked they broke the one-row-per-day rhythm.
  // Overlaps are drawn solid instead, longest first so a short session inside a
  // long one stays on top and visible.
  // Long ranges compress: a 90-day view is a texture, not 90 readable rows.
  const rowH = sortedDays.length <= 14 ? 14 : sortedDays.length <= 31 ? 9 : 5
  const showEveryLabel = sortedDays.length <= 31
  const crossesMonth =
    sortedDays.length > 0 && sortedDays[0].slice(0, 7) !== sortedDays[sortedDays.length - 1].slice(0, 7)

  const keyOf = (project: string) => (colorBy === 'kind' ? kindByProject[project] || 'other' : project)
  const colorForKey = (key: string) =>
    colorBy === 'kind' ? projectKindStrokeBlock(key as ProjectKindBlock, isDark) : getProjectColor(key, isDark).stroke
  // Blocks use the pastel fill Plan usage and the day strip use; the saturated
  // stroke stays for legend dots and hover text, where it has to read as type.
  const fillFor = (project: string) => {
    if (colorBy === 'kind') {
      const stroke = projectKindStrokeBlock(kindByProject[project] || 'other', isDark)
      return stroke.replace(/^rgb\((.*)\)$/, 'rgba($1,0.4)')
    }
    return getProjectColor(project, isDark).fill
  }

  const totals = useMemo(
    () => timeOfDayTotalsBlock(segmentsByDay, keyOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf is derived from these
    [segmentsByDay, colorBy, kindByProject],
  )
  // Legend = what each colour took across the visible days, biggest first.
  // Every kind (there are few); by project only the top few, then "+N more" —
  // the full list was a wall of names repeating the card's project list.
  const legendAll = useMemo(
    () =>
      [...totals.byKey.entries()]
        .filter(([, min]) => min >= 1)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [totals],
  )
  const legend = colorBy === 'kind' ? legendAll : legendAll.slice(0, LEGEND_TOP_PROJECTS)
  const legendMore = legendAll.length - legend.length
  const labelForKey = (key: string) =>
    colorBy === 'kind' ? projectKindLabelBlock(key as ProjectKindBlock) : projectLabelBlock(key)
  const fmtMin = (min: number) => fmtDurationMsBlock(min * 60_000)

  // Hover card — the same card Plan usage shows (date + total, then a row per
  // project or kind in its colour). Hovering a block adds that session on top.
  // Replaces native `title` tooltips: slow, unstyled, one line.
  const [hover, setHover] = useState<{
    x: number
    y: number
    width: number
    day: string
    seg: TimeOfDaySegmentBlock | null
  } | null>(null)
  const hoverAt = (e: React.MouseEvent) => {
    const rect = hostRef.current?.getBoundingClientRect()
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width } : null
  }
  const dayBreakdown = (day: string) =>
    [...timeOfDayTotalsBlock(new Map([[day, segmentsByDay.get(day) ?? []]]), keyOf).byKey.entries()]
      .filter(([, min]) => min >= 1)
      .sort((a, b) => b[1] - a[1])

  return (
    <div
      ref={hostRef}
      className="relative select-none"
      onMouseLeave={() => setHover(null)}
    >
      <div className="space-y-1.5">
        {sortedDays.map((day, i) => {
          const drawn = [...packTimeOfDayRowBlock(segmentsByDay.get(day) ?? []).items].sort(
            (a, b) => b.endMin - b.startMin - (a.endMin - a.startMin),
          )
          const selected = selectedDate === day
          const isMonday = new Date(`${day}T12:00:00`).getDay() === 1
          const dayMin = totals.byDay.get(day) ?? 0
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDate?.(selected ? null : day)}
              onMouseMove={e => {
                const at = hoverAt(e)
                if (at && dayMin >= 1) setHover({ ...at, day, seg: null })
                else setHover(null)
              }}
              className={cn(
                'group flex w-full items-center gap-3 rounded-sm text-left',
                selected && 'bg-foreground/[0.04]',
              )}
            >
              <span
                className={cn(
                  'w-12 shrink-0 text-right text-[10px] tabular-nums',
                  selected && 'font-medium text-foreground',
                )}
                style={selected ? undefined : { color: AXIS_TEXT }}
              >
                {showEveryLabel || isMonday || i === 0 ? fmtRowDay(day, crossesMonth) : ''}
              </span>
              <span className="relative flex-1" style={{ height: rowH }}>
                {GUIDE_HOURS.map(h => (
                  <span
                    key={h}
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-foreground/[0.05]"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}
                {drawn.map((seg, j) => {
                  const tick = seg.endMin - seg.startMin < 1
                  return (
                    <span
                      key={`${seg.startIso}-${j}`}
                      onMouseMove={e => {
                        e.stopPropagation()
                        const at = hoverAt(e)
                        if (at) setHover({ ...at, day, seg })
                      }}
                      className="absolute inset-y-0 rounded-[2px]"
                      style={{
                        left: `${(seg.startMin / DAY_MIN) * 100}%`,
                        width: tick ? 2 : `max(3px, ${((seg.endMin - seg.startMin) / DAY_MIN) * 100}%)`,
                        background: fillFor(seg.project),
                        opacity: tick ? 0.7 : 1,
                      }}
                    />
                  )
                })}
              </span>
              {/* Left-aligned: the total reads as the end of its row, next to the plot,
                  not as a column pinned to the card edge. */}
              <span className="ml-2 w-14 shrink-0 text-left text-[10px] tabular-nums" style={{ color: AXIS_TEXT }}>
                {dayMin >= 1 ? fmtApproxMin(dayMin) : ''}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <span className="w-12 shrink-0" />
        <span className="relative h-3 flex-1">
          {HOUR_TICKS.map(h => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[10px] tabular-nums"
              style={{ left: `${(h / 24) * 100}%`, color: AXIS_TEXT }}
            >
              {fmtHourTick(h)}
            </span>
          ))}
        </span>
        {/* Matches the row ends: same gap and width as the totals column. */}
        <span className="ml-2 w-14 shrink-0" />
      </div>

      {legend.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]"
          style={{ paddingLeft: CHART_GUTTER_PX }}>
          {legend.map(([key, min]) => (
            <span key={key} className="inline-flex items-baseline gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full" style={{ background: colorForKey(key) }} />
              <span className="text-muted-foreground">{labelForKey(key)}</span>
              <span className="tabular-nums text-foreground/80">{fmtMin(min)}</span>
            </span>
          ))}
          {legendMore > 0 && <span className="text-muted-foreground/60">+{legendMore} more</span>}
        </div>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 w-64 rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          style={{
            top: hover.y + 14,
            // Flip to the left of the cursor in the right third, so it never runs off the card.
            left: hover.x > hover.width * 0.66 ? hover.x - 256 - 8 : hover.x + 8,
          }}
        >
          <div className="flex items-baseline gap-3 text-foreground/70">
            <span>{fmtWeekday(hover.day)}</span>
            <span className="ml-auto tabular-nums text-foreground/85">
              {fmtMin(totals.byDay.get(hover.day) ?? 0)}
            </span>
          </div>
          {hover.seg && (
            <div className="mt-1.5 border-b border-border/50 pb-1.5">
              <div className="leading-snug text-foreground">{hover.seg.topic}</div>
              <div className="mt-0.5 tabular-nums text-muted-foreground">
                {fmtClock(hover.seg.startIso)}
                {hover.seg.endMin - hover.seg.startMin >= 1
                  ? `–${fmtClock(hover.seg.endIso)} · ${fmtMin(hover.seg.endMin - hover.seg.startMin)}`
                  : ' · no end time recorded'}
              </div>
            </div>
          )}
          <div className="mt-1 space-y-0.5">
            {dayBreakdown(hover.day).map(([key, min]) => {
              const stroke = colorForKey(key)
              const active = hover.seg && keyOf(hover.seg.project) === key
              return (
                <div key={key} className="flex items-baseline gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: stroke }} />
                  <span className={active ? 'font-medium text-foreground' : 'text-foreground/80'}>{labelForKey(key)}</span>
                  <span className="ml-auto tabular-nums" style={{ color: stroke }}>
                    {fmtMin(min)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
