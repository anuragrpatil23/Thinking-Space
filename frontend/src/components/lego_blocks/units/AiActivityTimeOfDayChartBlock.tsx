import { useMemo } from 'react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { timeOfDaySegmentsBlock } from '@/services/lego_blocks/units/aiActivityTimeOfDayBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import {
  PROJECT_KINDS_BLOCK,
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
// Overlapping sessions are drawn translucent rather than in lanes, so two at
// once read darker instead of splitting a 14px row into slivers.

const DAY_MIN = 24 * 60
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

function fmtDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${MONTH_SHORT[m - 1]} ${d}`
}

function fmtHourTick(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${h % 24 < 12 ? 'a' : 'p'}`
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

  // Long ranges compress: a 90-day view is a texture, not 90 readable rows.
  const rowH = sortedDays.length <= 14 ? 14 : sortedDays.length <= 31 ? 9 : 5
  const showEveryLabel = sortedDays.length <= 31

  const colorFor = (project: string) =>
    colorBy === 'kind'
      ? projectKindStrokeBlock(kindByProject[project] || 'other', isDark)
      : getProjectColor(project, isDark).stroke

  const kindsPresent = useMemo(() => {
    if (colorBy !== 'kind') return []
    const seen = new Set<string>()
    for (const segments of segmentsByDay.values()) {
      for (const seg of segments) seen.add(kindByProject[seg.project] || 'other')
    }
    return PROJECT_KINDS_BLOCK.filter(k => seen.has(k))
  }, [colorBy, segmentsByDay, kindByProject])

  return (
    <div ref={hostRef} className="select-none">
      <div className="space-y-[3px]">
        {sortedDays.map((day, i) => {
          const segments = segmentsByDay.get(day) ?? []
          const selected = selectedDate === day
          const isMonday = new Date(`${day}T12:00:00`).getDay() === 1
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDate?.(selected ? null : day)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-sm text-left',
                selected && 'bg-foreground/[0.04]',
              )}
            >
              <span
                className={cn(
                  'w-12 shrink-0 text-right text-[10px] tabular-nums',
                  selected ? 'font-medium text-foreground' : 'text-muted-foreground/70 group-hover:text-foreground/80',
                )}
              >
                {showEveryLabel || isMonday || i === 0 ? fmtDay(day) : ''}
              </span>
              <span className="relative flex-1 rounded-[2px] bg-foreground/[0.025]" style={{ height: rowH }}>
                {HOUR_TICKS.slice(1, -1).map(h => (
                  <span
                    key={h}
                    aria-hidden
                    className={cn('absolute inset-y-0 w-px', h % 12 === 0 ? 'bg-foreground/[0.08]' : 'bg-foreground/[0.04]')}
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}
                {segments.map((seg, j) => {
                  const tick = seg.endMin - seg.startMin < 1
                  return (
                    <span
                      key={`${seg.startIso}-${j}`}
                      title={`${fmtClock(seg.startIso)}${tick ? '' : `–${fmtClock(seg.endIso)}`} · ${projectLabelBlock(seg.project)} — ${seg.topic}`}
                      className="absolute inset-y-0 rounded-[2px]"
                      style={{
                        left: `${(seg.startMin / DAY_MIN) * 100}%`,
                        width: tick ? 2 : `max(2px, ${((seg.endMin - seg.startMin) / DAY_MIN) * 100}%)`,
                        background: colorFor(seg.project),
                        opacity: tick ? 0.5 : 0.7,
                      }}
                    />
                  )
                })}
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
              className="absolute -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground/60"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {fmtHourTick(h)}
            </span>
          ))}
        </span>
      </div>

      {kindsPresent.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-[3.75rem] text-[10px] text-muted-foreground">
          {kindsPresent.map(kind => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: projectKindStrokeBlock(kind, isDark) }} />
              {projectKindLabelBlock(kind)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
