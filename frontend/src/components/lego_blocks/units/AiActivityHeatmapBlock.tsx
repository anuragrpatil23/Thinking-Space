import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityDay } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useWheelScrollCaptureBlock } from '@/components/lego_blocks/hooks/shared/useWheelScrollCaptureBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import {
  AI_ACTIVITY_CALENDAR_MODE_EVENT,
  AI_ACTIVITY_POOL_HOURS_EVENT,
  AI_ACTIVITY_REST_DAYS_EVENT,
  AI_ACTIVITY_SET_MODE_EVENT,
  AI_ACTIVITY_WORK_MIX_MODE_EVENT,
  getAiActivityCalendarMode,
  getAiActivityRestDays,
  getAiActivitySetMode,
  getAiActivityThinkingPoolHours,
  getAiActivityWorkMixMode,
} from '@/services/lego_blocks/units/storageKeyBlock'
import {
  foldWorkMixDayBlock,
  WORK_MIX_MAX_LAPS_BLOCK,
  type WorkMixCellBlock,
} from '@/services/lego_blocks/units/aiActivityWorkMixBlock'
import {
  projectKindLabelBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'

interface AiActivityHeatmapBlockProps {
  days: ActivityDay[]
  loading?: boolean
  startIso: string
  endIso: string
  /** When set, the heatmap tints cells by that project's color and intensity. */
  filterProject?: string | null
  /** Currently selected day (chord-clicked). */
  selectedDate?: string | null
  onSelectDate?: (date: string | null) => void
  /** Range selection — used for multi-day comparison. */
  selectedRange?: { startIso: string; endIso: string } | null
  onSelectRange?: (range: { startIso: string; endIso: string } | null) => void
  /**
   * Canonical-project-name → kind, from `buildProjectKindMapBlock`. Only read
   * in work-mix mode. Passed in rather than loaded here so this stays a
   * prop-driven primitive; a caller that omits it leaves every project
   * unclassified, which renders as empty cells rather than a wrong answer.
   */
  kindByProject?: Record<string, ProjectKindBlock>
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

/** Widest window the grid renders at once — longer ranges page via chevrons. */
const MAX_VISIBLE_WEEKS = 53
// Set-mode cell geometry — larger than default so day-of-month numbers fit
// legibly inside each cell.
const SET_CELL_PX = 18
const SET_CELL_GAP = 3
// Activity-ring geometry. Two concentric rings plus a centre disc need more
// room than the 18px set-mode cell: at 26px the outer ring is comfortably
// hittable, the inner ring still reads, and the centre disc stays the largest
// single mark — which is right, since the centre is the thing that matters.
const WORK_MIX_CELL_PX = 26
/** Hairline rings. Position, not weight, is what separates the two tracks, so
 *  the stroke only has to be thick enough to survive a non-retina pixel grid. */
const WORK_MIX_STROKE_PX = 1.5
/** Rings sit flush against each other, and the centre disc sits flush against
 *  the inner ring: the cell reads as one solid mark banded at its rim, not as a
 *  stack of separate tracks with air between them. */
const WORK_MIX_RING_GAP_PX = 0
/** Outermost first. Fixed, because position is what carries the kind once color
 *  has been handed over to project identity. */
const RING_KIND_ORDER = ['building', 'maintenance', 'other'] as const
/** How much of a lap is spent easing into the tone underneath, at each end.
 *  ~1/8 of the circle: long enough to read as a gradient, short enough that the
 *  lap still has a stretch at full tone in the middle. */
const WORK_MIX_LAP_FADE = 0.13
/** Arc segments a lap is cut into to fake that gradient. SVG has no conic
 *  gradient, so the ramp is stepped; 10 steps is where the banding stops being
 *  visible on a 26px circle, and only rings that actually lapped pay for it. */
const WORK_MIX_LAP_FADE_STEPS = 10
/** The unclassified track's tone, worn by the innermost ring. Fixed and neutral
 *  — never a project color — because it is a statement about missing metadata,
 *  not about work. */
const WORK_MIX_OTHER_CHANNELS = { light: '16,185,129', dark: '52,211,153' }

/** Keep only the selected project's hours, so a chip click narrows the rings
 *  instead of leaving them unchanged. Null filter = the whole day. */
function narrowDurationsBlock(
  durations: Record<string, number> | undefined,
  project: string | null,
): Record<string, number> | undefined {
  if (!project || !durations) return durations
  const hours = durations[project]
  return hours == null ? {} : { [project]: hours }
}

function fmtHoursBlock(hours: number): string {
  if (hours <= 0) return '0h'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + delta)
  d.setHours(0, 0, 0, 0)
  return d
}

function isoDayLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface CellModel {
  date: string
  msgs: number
  intensity: number
  /** Top project on that day (used for default tint when no project filter is set). */
  topProject: string | null
  /** Kind breakdown for work-mix mode; null when the mode is off. */
  workMix: WorkMixCellBlock | null
}

export default function AiActivityHeatmapBlock({
  days,
  loading = false,
  startIso,
  endIso,
  filterProject = null,
  selectedDate = null,
  onSelectDate,
  selectedRange = null,
  onSelectRange,
  kindByProject,
}: AiActivityHeatmapBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [setMode, setSetMode] = useState<boolean>(() => getAiActivitySetMode())
  const [calendarMode, setCalendarMode] = useState<boolean>(() => getAiActivityCalendarMode())
  const [restDays, setRestDays] = useState<number[]>(() => getAiActivityRestDays())
  const [workMixMode, setWorkMixMode] = useState<boolean>(() => getAiActivityWorkMixMode())
  const [poolHours, setPoolHours] = useState<number>(() => getAiActivityThinkingPoolHours())
  useEffect(() => {
    const onSetMode = () => setSetMode(getAiActivitySetMode())
    const onCalMode = () => setCalendarMode(getAiActivityCalendarMode())
    const onRestDays = () => setRestDays(getAiActivityRestDays())
    const onWorkMix = () => setWorkMixMode(getAiActivityWorkMixMode())
    const onPool = () => setPoolHours(getAiActivityThinkingPoolHours())
    window.addEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
    window.addEventListener(AI_ACTIVITY_CALENDAR_MODE_EVENT, onCalMode)
    window.addEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
    window.addEventListener(AI_ACTIVITY_WORK_MIX_MODE_EVENT, onWorkMix)
    window.addEventListener(AI_ACTIVITY_POOL_HOURS_EVENT, onPool)
    window.addEventListener('storage', onSetMode)
    window.addEventListener('storage', onCalMode)
    window.addEventListener('storage', onRestDays)
    window.addEventListener('storage', onWorkMix)
    window.addEventListener('storage', onPool)
    return () => {
      window.removeEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
      window.removeEventListener(AI_ACTIVITY_CALENDAR_MODE_EVENT, onCalMode)
      window.removeEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
      window.removeEventListener(AI_ACTIVITY_WORK_MIX_MODE_EVENT, onWorkMix)
      window.removeEventListener(AI_ACTIVITY_POOL_HOURS_EVENT, onPool)
      window.removeEventListener('storage', onSetMode)
      window.removeEventListener('storage', onCalMode)
      window.removeEventListener('storage', onRestDays)
      window.removeEventListener('storage', onWorkMix)
      window.removeEventListener('storage', onPool)
    }
  }, [])
  // "Calendar look" = same big-cell / day-of-month layout that set-mode uses,
  // but without the 3-day dividers or the current-set ring. Either toggle
  // activates the layout; set-specific decorations still gate on setMode.
  const showDayNumbers = setMode || calendarMode
  // Work-mix needs the big geometry unconditionally: at 12px a 2px ring leaves
  // an 8px core, so the fill — the mark that matters most — would get the least
  // area. Day numbers stay opt-in, but when they are on they show here too —
  // dates are how you find a day, and the rings do not replace that.
  const bigCells = showDayNumbers || workMixMode

  // Rest-day predicate: true when this date falls in the *current calendar
  // month* AND its weekday is one the user marked as rest. Bucket the check
  // by month first so historical months are cheap no-ops.
  const restDaySet = useMemo(() => new Set(restDays), [restDays])
  const currentMonthKey = useMemo(() => {
    const n = new Date()
    return `${n.getFullYear()}-${n.getMonth()}`
  }, [])
  const isRestDay = useMemo(
    () => (iso: string): boolean => {
      if (restDaySet.size === 0) return false
      const d = new Date(iso + 'T00:00:00')
      if (`${d.getFullYear()}-${d.getMonth()}` !== currentMonthKey) return false
      return restDaySet.has(d.getDay())
    },
    [restDaySet, currentMonthKey],
  )

  const [hoverDate, setHoverDate] = useState<string | null>(null)
  const [dragAnchor, setDragAnchor] = useState<string | null>(null)
  // Weeks paged back from the most recent window (0 = latest). Reset when the
  // range itself changes so a new range always opens on its newest data.
  const [weeksBack, setWeeksBack] = useState(0)
  useEffect(() => setWeeksBack(0), [startIso, endIso])

  const dayMap = useMemo(() => {
    const m = new Map<string, ActivityDay>()
    for (const d of days) m.set(d.date, d)
    return m
  }, [days])

  // End-of-current-month, used to always show the rest of this month even
  // when endIso lands on "today". Lets the user see where rest-day markers
  // will fall and pace against upcoming sets.
  const endOfCurrentMonthIso = useMemo(() => {
    const n = new Date()
    return isoDayLocal(new Date(n.getFullYear(), n.getMonth() + 1, 0))
  }, [])

  const allWeeks = useMemo(() => {
    const start = new Date(startIso + 'T00:00:00')
    // Extend past endIso when the current month falls in the range, so
    // future dates in this month still get rendered (muted, not tinted).
    const rawEnd = new Date(endIso + 'T00:00:00')
    const monthEnd = new Date(endOfCurrentMonthIso + 'T00:00:00')
    const end = monthEnd > rawEnd ? monthEnd : rawEnd
    const firstMonday = mondayOf(start)

    const cells: CellModel[] = []
    const cursor = new Date(firstMonday)
    while (cursor <= end || cursor.getDay() !== 1) {
      const date = isoDayLocal(cursor)
      const d = dayMap.get(date)
      let msgs = 0
      let topProject: string | null = null
      if (d) {
        const projectCounts = d.byChainProject ?? d.byProject
        if (filterProject) {
          msgs = projectCounts[filterProject] ?? 0
          topProject = filterProject
        } else {
          msgs = d.totalMsgs
          // Tint by the project with the most *time* on the day (wall-clock
          // duration), so "most worked on" reads as time spent, not raw message
          // count — a long 4h session outranks a chattier but shorter one. Fall
          // back to msg counts when duration is unavailable. Noise buckets are
          // ignored for tint only; chips still surface them elsewhere.
          const durations = d.byChainProjectDurationMs
          const hasDuration = Object.keys(durations).length > 0
          const ranking: Record<string, number> = hasDuration ? durations : projectCounts
          let topScore = 0
          for (const [name, score] of Object.entries(ranking)) {
            const isNoise = name.startsWith('[') && name.endsWith(']')
            if (isNoise) continue
            if (score > topScore) {
              topScore = score
              topProject = name
            }
          }
        }
      }
      cells.push({
        date,
        msgs,
        intensity: msgs,
        topProject,
        // Folded per cell rather than per visible page so a day's marks do not
        // change when you page the grid — unlike `intensity`, these are
        // absolute against the user's pool, not relative to the range.
        workMix: workMixMode
          ? foldWorkMixDayBlock(
              // A selected project chip narrows the rings to that project's own
              // hours, so the question becomes "how much of my pool did this one
              // thing take, day by day" instead of going inert in this mode.
              narrowDurationsBlock(d?.byChainProjectDurationMs, filterProject),
              kindByProject ?? {},
              poolHours,
            )
          : null,
      })
      cursor.setDate(cursor.getDate() + 1)
      if (cells.length > 530 * 7) break // ~10y hard stop against degenerate ranges
    }

    // Normalize against the WHOLE range, not the visible page, so a cell's
    // shade means the same thing on every page.
    const max = cells.reduce((m, c) => (c.intensity > m ? c.intensity : m), 0)
    for (const c of cells) c.intensity = max > 0 ? Math.min(1, c.intensity / max) : 0

    const w: CellModel[][] = []
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7))
    return w
  }, [
    dayMap,
    startIso,
    endIso,
    endOfCurrentMonthIso,
    filterProject,
    workMixMode,
    kindByProject,
    poolHours,
  ])

  // Measure the outer scroll container so paging kicks in whenever the grid
  // would actually overflow — not just past the 53-week fallback. This
  // matters most in home-canvas embeds where the card is narrower than the
  // AI-Activity panel, and in set-mode where cells are ~1.75× wider so a
  // whole year no longer fits in the previously "always fits" 53-week band.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Trackpad scroll over the grid scrolls it in place instead of panning the
  // canvas underneath. Gated on !loading because the scroll container is only
  // rendered once loaded — the hook must (re)attach when it appears.
  useWheelScrollCaptureBlock(scrollContainerRef, 'x', !loading)
  const [containerWidth, setContainerWidth] = useState(0)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const update = () => setContainerWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cellStepPx = workMixMode
    ? WORK_MIX_CELL_PX + SET_CELL_GAP
    : bigCells
      ? SET_CELL_PX + SET_CELL_GAP
      : 15
  const leftLabelPad = showDayNumbers ? 8 : 36 // weekday labels + margin, or just padding
  const fitVisibleWeeks =
    containerWidth > 0
      ? Math.max(4, Math.floor((containerWidth - leftLabelPad) / cellStepPx))
      : MAX_VISIBLE_WEEKS
  const visibleWeeksCap = Math.min(MAX_VISIBLE_WEEKS, fitVisibleWeeks)
  const pageStep = Math.max(1, Math.floor(visibleWeeksCap / 2))

  const maxWeeksBack = Math.max(0, allWeeks.length - visibleWeeksCap)
  const clampedWeeksBack = Math.min(weeksBack, maxWeeksBack)
  const weeks = useMemo(() => {
    if (allWeeks.length <= visibleWeeksCap) return allWeeks
    const start = maxWeeksBack - clampedWeeksBack
    return allWeeks.slice(start, start + visibleWeeksCap)
  }, [allWeeks, maxWeeksBack, clampedWeeksBack, visibleWeeksCap])
  const canPageBack = clampedWeeksBack < maxWeeksBack
  const canPageForward = clampedWeeksBack > 0

  function pageBy(dir: 'back' | 'forward') {
    setWeeksBack(prev =>
      dir === 'back'
        ? Math.min(maxWeeksBack, prev + pageStep)
        : Math.max(0, prev - pageStep),
    )
  }

  // Month labels are wider than one 12px column, so a naive per-column slot
  // makes adjacent months collide ("JanFeb"). Build an absolutely-positioned
  // header row instead: each label parks at the first-week-of-its-month column,
  // and we skip any label that would sit closer than ~24px to the previous one.
  // Both labels and dividers anchor to the FIRST column that contains any cell
  // of the new month — not the first column whose Monday is in the new month.
  // In mixed-week columns (e.g. Mon=Mar 30, Wed=Apr 1) anchoring to Monday
  // strands the early days of the new month on the wrong side of the divider.
  // Anchoring to the column that contains the 1st of the new month puts the
  // mixed week on the new-month side, which strands fewer days and matches
  // user intuition ("April starts in this column").
  const monthTransitions = useMemo(() => {
    const transitions: Array<{ col: number; month: number; year: number }> = []
    let lastMonth = -1
    weeks.forEach((week, idx) => {
      let newestMonth = -1
      let newestYear = -1
      for (const cell of week) {
        if (!cell.date) continue
        const d = new Date(cell.date + 'T00:00:00')
        const m = d.getMonth()
        if (m !== lastMonth) {
          newestMonth = m
          newestYear = d.getFullYear()
          break
        }
      }
      if (newestMonth !== -1) {
        transitions.push({ col: idx, month: newestMonth, year: newestYear })
        lastMonth = newestMonth
      }
    })
    return transitions
  }, [weeks])

  const monthHeaders = useMemo(() => {
    const headers: Array<{ col: number; label: string; month: number; year: number }> = []
    let lastCol = -Infinity
    for (const t of monthTransitions) {
      if (t.col - lastCol >= 2) {
        // Year on January so multi-year paging stays unambiguous.
        const label =
          t.month === 0 ? `${MONTH_LABELS[0]} ’${String(t.year).slice(2)}` : MONTH_LABELS[t.month]
        headers.push({ col: t.col, label, month: t.month, year: t.year })
        lastCol = t.col
      }
    }
    return headers
  }, [monthTransitions])

  // Click a month label → select that whole month (clamped to the visible
  // range so a partial first/last month doesn't select invisible days).
  function selectMonth(year: number, month: number) {
    const monthStart = isoDayLocal(new Date(year, month, 1))
    const monthEnd = isoDayLocal(new Date(year, month + 1, 0))
    const a = monthStart < startIso ? startIso : monthStart
    const b = monthEnd > endIso ? endIso : monthEnd
    if (a > b) return
    onSelectDate?.(null)
    onSelectRange?.({ startIso: a, endIso: b })
  }

  // Vertical separator on the heatmap so the eye can tell where one month ends
  // and the next begins. Skip idx 0 — leftmost column needs no left-divider.
  const monthDividerCols = useMemo(
    () => monthTransitions.filter(t => t.col > 0).map(t => t.col),
    [monthTransitions],
  )

  const hovered = hoverDate ? dayMap.get(hoverDate) : null
  // The footer reports every kind with hours on it, including conditioning and
  // `other`, which deliberately draw no mark. The cell is allowed to be
  // selective; the readout is not.
  const hoveredMix = useMemo(
    () =>
      workMixMode && hovered
        ? foldWorkMixDayBlock(hovered.byChainProjectDurationMs, kindByProject ?? {}, poolHours)
        : null,
    [workMixMode, hovered, kindByProject, poolHours],
  )

  /** Project color as `r,g,b` channels, so callers can splice their own alpha.
   *  Falls back to the neutral slate the empty cell already uses. */
  function projectChannels(project: string | null): string {
    const { stroke } = getProjectColor(project ?? 'LTM', isDark)
    const m = stroke.match(/rgb\((\d+),(\d+),(\d+)\)/)
    return m ? `${m[1]},${m[2]},${m[3]}` : '148,163,184'
  }

  /** Warning hue for laps past a closed ring. Orange because it is the one thing
   *  on this grid that no project palette entry lands on, so a trace of it reads
   *  as a *state* rather than as a different project. */
  const WORK_MIX_LAP_HUE = isDark ? [251, 146, 60] : [234, 100, 18]

  /** Tint a color toward the warning hue by `amount` (0–1). Kept small on
   *  purpose: enough to see that the ring came round again, not enough to lose
   *  which project it belongs to. */
  function warmBy(channels: number[], amount: number): number[] {
    if (amount <= 0) return channels
    return channels.map((c, i) =>
      Math.round(Math.max(0, Math.min(255, c + (WORK_MIX_LAP_HUE[i] - c) * amount))),
    )
  }

  /** Centre disc: thinking against the pool, wearing the color of the project
   *  that did the thinking. Building and maintenance contribute nothing here —
   *  they have their own rings — so a day of pure building leaves the centre
   *  empty, which is the honest answer and the state worth spotting. */
  function workMixFill(mix: WorkMixCellBlock): string {
    if (mix.fill <= 0) return 'transparent'
    // Floor stays low: the disc now fills most of the cell, and the high floor a
    // small mark needed would make a thin day read as a heavy one.
    const alpha = isDark ? 0.28 + mix.fill * 0.6 : 0.2 + mix.fill * 0.65
    // Past one pool the alpha ramp is spent, so extra pools drive the disc more
    // vivid the way extra laps do a ring — otherwise 5h and 12h of thinking are
    // the same wash.
    const extra = Math.min(WORK_MIX_MAX_LAPS_BLOCK - 1, Math.max(0, mix.fillRawRatio - 1))
    const channels = projectChannels(mix.thinkingProject).split(',').map(Number)
    const warmed = warmBy(channels, (extra / (WORK_MIX_MAX_LAPS_BLOCK - 1)) * 0.28)
    return `rgba(${warmed.join(',')},${alpha.toFixed(3)})`
  }

  function ringChannels(
    kind: (typeof RING_KIND_ORDER)[number],
    project: string | null,
  ): string {
    // The unclassified track opts out of project identity by design; see
    // WORK_MIX_OTHER_CHANNELS.
    if (kind !== 'other') return projectChannels(project)
    return isDark ? WORK_MIX_OTHER_CHANNELS.dark : WORK_MIX_OTHER_CHANNELS.light
  }

  /** Tone for one lap of a ring. The first pool is the project's own color; once
   *  the ring closes, each further pool comes round at full opacity with a trace
   *  of orange worked into it.
   *
   *  An earlier cut deepened toward near-black instead. It did separate 5h from
   *  12h, by destroying the project color that is the ring's whole identity and
   *  turning a busy month into a grid of black circles. A small hue shift is the
   *  cheaper signal: the project stays recognisable, and the warmth only ever
   *  appears on a ring that already went past a full day. */
  function workMixLapTone(
    kind: (typeof RING_KIND_ORDER)[number],
    project: string | null,
    lap: number,
  ): { rgb: number[]; alpha: number } {
    const channels = ringChannels(kind, project).split(',').map(Number)
    return {
      rgb: warmBy(channels, lap <= 0 ? 0 : lap === 1 ? 0.22 : 0.45),
      alpha: lap <= 0 ? 0.6 : lap === 1 ? 0.9 : 1,
    }
  }

  type WorkMixTone = { rgb: number[]; alpha: number }

  function toneCss(tone: WorkMixTone): string {
    return `rgba(${tone.rgb.map(Math.round).join(',')},${tone.alpha.toFixed(3)})`
  }

  function blendTones(from: WorkMixTone, to: WorkMixTone, t: number): WorkMixTone {
    return {
      rgb: from.rgb.map((c, i) => c + (to.rgb[i] - c) * t),
      alpha: from.alpha + (to.alpha - from.alpha) * t,
    }
  }

  /**
   * Activity rings for one day: a centre disc for thinking, then one concentric
   * ring per competing kind, outermost first.
   *
   * Only marks that carry information are drawn. An earlier cut gave every ring
   * a permanent grey track so an empty ring would read as "none of this
   * happened" — which works on a watch face showing one stack, and fails badly
   * across 371 cells, where 700-odd tracks become the loudest thing on screen
   * while saying nothing. Emptiness is legible here because its neighbours are
   * not empty; the grid supplies the baseline that a single stack would need a
   * track for.
   */
  function renderWorkMixRings(mix: WorkMixCellBlock) {
    const c = cellPx / 2
    const rings = RING_KIND_ORDER.map((kind, index) => {
      const radius =
        c - WORK_MIX_STROKE_PX / 2 - index * (WORK_MIX_STROKE_PX + WORK_MIX_RING_GAP_PX)
      return { kind, radius, segment: mix.segments.find(s => s.kind === kind) ?? null }
    }).filter(ring => ring.radius > WORK_MIX_STROKE_PX && ring.segment)

    const innerRadius =
      c -
      WORK_MIX_STROKE_PX / 2 -
      (RING_KIND_ORDER.length - 1) * (WORK_MIX_STROKE_PX + WORK_MIX_RING_GAP_PX) -
      WORK_MIX_STROKE_PX / 2 -
      WORK_MIX_RING_GAP_PX
    return (
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0"
        width={cellPx}
        height={cellPx}
        viewBox={`0 0 ${cellPx} ${cellPx}`}
      >
        {/* Quiet baseline: one small dot marks a day with no thinking, so an
            empty cell still reads as a day rather than as a hole in the grid. */}
        {mix.fill <= 0 ? (
          <circle cx={c} cy={c} r={1.5} fill="rgba(148,163,184,0.35)" />
        ) : (
          <circle cx={c} cy={c} r={Math.max(2, innerRadius)} fill={workMixFill(mix)} />
        )}
        {rings.flatMap(({ kind, radius, segment }) => {
          const circumference = 2 * Math.PI * radius
          // Laps. A closed ring is where a single-tone arc runs out of things to
          // say — 5h and 12h of building both fill it — so each further pool
          // repaints the ring from 12 o'clock in a warmer tone. The lap beneath
          // stays visible, which is what makes "one and a bit pools" read
          // differently from "three".
          //
          // Each lap is laid down as a run of short arcs rather than one, so its
          // two ends can fade into the tone underneath instead of stopping at a
          // hard seam. A butted lap edge reads as a rendering fault at this size;
          // a gradient reads as the ring coming round again.
          const arcs: Array<{
            key: string
            start: number
            len: number
            css: string
            cap: 'round' | 'butt'
          }> = []
          for (let lap = 0; lap < WORK_MIX_MAX_LAPS_BLOCK; lap++) {
            const portion = segment!.raw - lap
            if (portion <= 0) break
            const len = lap === 0 ? segment!.sweep : Math.min(1, portion)
            const tone = workMixLapTone(kind, segment!.topProject, lap)
            if (lap === 0) {
              arcs.push({ key: `${kind}-0`, start: 0, len, css: toneCss(tone), cap: 'round' })
              continue
            }
            // The lap is painted *over* the one below, so its ends have to fade
            // to transparent, not to the under tone's color — blending toward
            // that color would paint it a second time and leave the very seam the
            // taper exists to remove.
            const under = { rgb: workMixLapTone(kind, segment!.topProject, lap - 1).rgb, alpha: 0 }
            // Taper length, capped so a short lap fades over its own length
            // rather than never reaching full tone.
            const fade = Math.min(WORK_MIX_LAP_FADE, len / 2)
            const steps = WORK_MIX_LAP_FADE_STEPS
            const stepLen = len / steps
            for (let i = 0; i < steps; i++) {
              const start = i * stepLen
              const mid = start + stepLen / 2
              // Full lap tone in the middle, easing to the tone below at both
              // ends. Distance to the nearer end, normalised by the taper.
              const edge = Math.min(mid, len - mid)
              const t = fade <= 0 ? 1 : Math.min(1, edge / fade)
              arcs.push({
                key: `${kind}-${lap}-${i}`,
                start,
                // Overlap by a hair so adjacent steps leave no seam of their own.
                len: stepLen + 0.004,
                css: toneCss(blendTones(under, tone, t)),
                cap: 'butt',
              })
            }
          }
          return arcs.map(({ key, start, len, css, cap }) => (
            <circle
              key={key}
              cx={c}
              cy={c}
              r={radius}
              fill="none"
              stroke={css}
              strokeWidth={WORK_MIX_STROKE_PX}
              // Round on the base arc only; the taper steps butt together, where
              // a round cap would bulge the stroke at every join.
              strokeLinecap={cap}
              strokeDasharray={`${circumference * len} ${circumference}`}
              strokeDashoffset={-circumference * start}
              // Start at 12 o'clock and sweep clockwise, like every progress
              // ring people already know how to read.
              transform={`rotate(-90 ${c} ${c})`}
            />
          ))
        })}
      </svg>
    )
  }

  /** Spoken form of a work-mix cell. Reports every kind with hours on it,
   *  including the two that draw no mark, so the screen-reader label is not a
   *  narrower truth than the tooltip. */
  function workMixSummary(mix: WorkMixCellBlock): string {
    if (!mix.hasActivity) return 'no tracked work'
    const parts = (Object.entries(mix.hoursByKind) as [string, number][])
      .filter(([, hours]) => hours > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, hours]) => `${kind} ${fmtHoursBlock(hours)}`)
    return parts.join(', ')
  }

  function cellBackground(cell: CellModel): string {
    if (cell.workMix) return workMixFill(cell.workMix)
    if (cell.intensity <= 0) return 'rgba(148,163,184,0.08)'
    const colorName = filterProject ?? cell.topProject ?? 'LTM'
    const { stroke } = getProjectColor(colorName, isDark)
    // Reuse the rgb(r,g,b) channels with a computed alpha. The dark ramp
    // starts higher — low-alpha color over the night bg blends toward black
    // and quiet days would otherwise vanish into the empty-cell grey.
    const m = stroke.match(/rgb\((\d+),(\d+),(\d+)\)/)
    if (!m) return stroke
    const alpha = isDark ? 0.32 + cell.intensity * 0.6 : 0.18 + cell.intensity * 0.65
    return `rgba(${m[1]},${m[2]},${m[3]},${alpha.toFixed(3)})`
  }

  function isInActiveRange(date: string): boolean {
    if (!selectedRange) return false
    return date >= selectedRange.startIso && date <= selectedRange.endIso
  }

  function handleCellDown(date: string, e: React.MouseEvent) {
    if (e.shiftKey && selectedDate) {
      const a = selectedDate < date ? selectedDate : date
      const b = selectedDate < date ? date : selectedDate
      onSelectRange?.({ startIso: a, endIso: b })
      onSelectDate?.(null)
      return
    }
    setDragAnchor(date)
  }

  function handleCellUp(date: string) {
    if (dragAnchor && dragAnchor !== date) {
      const a = dragAnchor < date ? dragAnchor : date
      const b = dragAnchor < date ? date : dragAnchor
      onSelectRange?.({ startIso: a, endIso: b })
      onSelectDate?.(null)
    } else {
      // Single click toggles: clicking the selected day clears it.
      onSelectRange?.(null)
      onSelectDate?.(selectedDate === date ? null : date)
    }
    setDragAnchor(null)
  }

  // ── Set-mode helpers ─────────────────────────────────────────────────────
  // The "current set" is the 3-day window anchored to the 1st of the month
  // that contains today. Shown as a soft ring on whichever cells fall in it.
  const currentSetDates = useMemo(() => {
    const now = new Date()
    const day = now.getDate()
    const setNum = Math.floor((day - 1) / 3) + 1
    const startDay = 3 * (setNum - 1) + 1
    const monthLen = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const endDay = Math.min(3 * setNum, monthLen)
    const dates: string[] = []
    for (let d = startDay; d <= endDay; d++) {
      dates.push(isoDayLocal(new Date(now.getFullYear(), now.getMonth(), d)))
    }
    return { dates, setNum }
  }, [])

  // True when this date is the last day of its set — used to draw a thin
  // boundary line on the trailing edge of the cell so sets read as visual
  // chunks even inside the standard 7-row grid.
  function isLastDayOfSet(iso: string): boolean {
    const d = new Date(iso + 'T00:00:00')
    const day = d.getDate()
    const monthLen = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return day % 3 === 0 || day === monthLen
  }

  // Set-mode geometry: cells grow so day-of-month numbers stay legible.
  const cellPx = workMixMode ? WORK_MIX_CELL_PX : bigCells ? SET_CELL_PX : 12
  const cellGap = bigCells ? SET_CELL_GAP : 3
  const step = cellPx + cellGap
  const gridHeight = 7 * cellPx + 6 * cellGap
  const gridWidth = weeks.length * step - cellGap

  // Position map for every visible cell, keyed by ISO date. Used to overlay
  // the "current set" ring across whichever cells the set falls on.
  const cellPositions = useMemo(() => {
    const m = new Map<string, { col: number; row: number }>()
    weeks.forEach((week, wIdx) => {
      week.forEach((cell, rIdx) => {
        m.set(cell.date, { col: wIdx, row: rIdx })
      })
    })
    return m
  }, [weeks])

  // Current-set overlay rects: group the set's visible dates by column into
  // contiguous row runs so 3 dates in the same week render as one vertical
  // rectangle (and a set that straddles Sun→Mon splits into two rects).
  const currentSetRects = useMemo(() => {
    if (!setMode) return []
    interface Rect { col: number; topRow: number; bottomRow: number }
    const byCol = new Map<number, number[]>()
    for (const d of currentSetDates.dates) {
      const pos = cellPositions.get(d)
      if (!pos) continue
      const rows = byCol.get(pos.col) ?? []
      rows.push(pos.row)
      byCol.set(pos.col, rows)
    }
    const rects: Rect[] = []
    for (const [col, rows] of byCol) {
      rows.sort((a, b) => a - b)
      rects.push({ col, topRow: rows[0], bottomRow: rows[rows.length - 1] })
    }
    return rects
  }, [setMode, currentSetDates, cellPositions])

  return (
    <div ref={hostRef} className="space-y-2">
      {loading ? (
        <div className="h-32 w-full animate-pulse rounded-lg bg-muted/20" />
      ) : (
        <div className="relative">
        <div ref={scrollContainerRef} className="overflow-x-auto pt-1.5 pb-1.5">
          <div className="inline-block min-w-full">
            <div
              className={cn('relative mb-1', !showDayNumbers && 'ml-7')}
              style={{ height: 14, width: gridWidth }}
            >
              {monthHeaders.map(h => (
                <button
                  key={`${h.col}-${h.label}`}
                  type="button"
                  onClick={() => selectMonth(h.year, h.month)}
                  className="absolute top-0 whitespace-nowrap rounded-sm text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  style={{ left: h.col * step }}
                  title={`Select all of ${h.label}`}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <div className="flex">
              {!showDayNumbers && (
                <div className="mr-1 flex flex-col" style={{ gap: cellGap }}>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <div
                      key={i}
                      className="flex items-center text-[10px] text-muted-foreground"
                      style={{ height: cellPx, width: 24 }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              )}
              <div
                className="relative flex"
                style={{ gap: cellGap }}
                onMouseLeave={() => setDragAnchor(null)}
              >
                {/* Vertical month-boundary lines sit centered in the gap
                    before a month-start column. 1px wide, full grid height,
                    very low contrast so they read as quiet structure. */}
                {monthDividerCols.map(col => (
                  <div
                    key={`mdiv-${col}`}
                    aria-hidden
                    className="pointer-events-none absolute bg-foreground/15"
                    style={{
                      left: col * step - 2,
                      top: 0,
                      width: 1,
                      height: gridHeight,
                    }}
                  />
                ))}
                {/* Current-set ring: soft outlined box wrapping whichever
                    cells the set falls on. Splits across columns when the
                    set straddles a Sun→Mon boundary.
                    In work-mix mode any outline here is a fourth concentric
                    circle around cells that are already three rings deep, and it
                    wins the read every time. So there the set is a soft filled
                    halo *behind* the cells instead — same information, no new
                    line competing with the rings. */}
                {currentSetRects.map(rect => (
                  <div
                    key={`curset-${rect.col}-${rect.topRow}`}
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute',
                      workMixMode
                        ? 'bg-foreground/[0.07]'
                        : 'rounded-[5px] bg-foreground/[0.04] ring-1 ring-foreground/40',
                    )}
                    style={{
                      left: rect.col * step - (workMixMode ? 3 : 2),
                      top: rect.topRow * step - (workMixMode ? 3 : 2),
                      width: cellPx + (workMixMode ? 6 : 4),
                      height:
                        (rect.bottomRow - rect.topRow + 1) * step -
                        cellGap +
                        (workMixMode ? 6 : 4),
                      borderRadius: workMixMode ? (cellPx + 6) / 2 : undefined,
                    }}
                  />
                ))}
                {weeks.map((week, wIdx) => (
                  <div key={wIdx} className="flex flex-col" style={{ gap: cellGap }}>
                    {week.map((cell, rIdx) => {
                      const isHover = hoverDate === cell.date
                      const inRange = cell.date >= startIso && cell.date <= endIso
                      const isSelected = selectedDate === cell.date
                      const inActiveRange = isInActiveRange(cell.date)
                      const cellDate = new Date(cell.date + 'T00:00:00')
                      const dayNum = cellDate.getDate()
                      // What sits behind the day number: the intensity tint
                      // normally, but in work-mix mode the thinking disc, which
                      // now fills the cell and carries its own alpha ramp.
                      const strongTint = workMixMode
                        ? (cell.workMix?.fill ?? 0) > 0.5
                        : cell.intensity > 0.55
                      // 3-day set markers are a *forward-looking* pacing aid.
                      // In past months they read as noise, so gate the divider
                      // + day-number tint to the current calendar month only.
                      const cellMonthKey = `${cellDate.getFullYear()}-${cellDate.getMonth()}`
                      const isCurrentMonthCell = cellMonthKey === currentMonthKey
                      // Set-boundary dividers on trailing edges: bottom edge
                      // when next date is below in the same column, right edge
                      // when this cell is Sun (row 6) and the set boundary
                      // falls on the week-column seam.
                      // Work-mix mode draws no dividers at all: the set halo
                      // already says where the set is, and straight rules butted
                      // against circles read as debris no matter how short they
                      // are cut.
                      const isSetBoundary =
                        setMode &&
                        !workMixMode &&
                        isCurrentMonthCell &&
                        isLastDayOfSet(cell.date)
                      const drawBottomDivider =
                        isSetBoundary && rIdx < 6
                      const drawRightDivider = isSetBoundary && rIdx === 6
                      const isRest = isRestDay(cell.date)
                      return (
                        <button
                          key={cell.date}
                          type="button"
                          onMouseDown={e => handleCellDown(cell.date, e)}
                          onMouseUp={() => handleCellUp(cell.date)}
                          onMouseEnter={() => setHoverDate(cell.date)}
                          onMouseLeave={() => setHoverDate(d => (d === cell.date ? null : d))}
                          className={cn(
                            'relative flex items-center justify-center transition-all',
                            // Work-mix cells are activity rings, so the cell is a
                            // circle and the centre disc is drawn inside the SVG
                            // rather than as the button's own background.
                            workMixMode ? 'rounded-full' : 'rounded-[3px]',
                            showDayNumbers && 'font-medium tabular-nums text-[10px]',
                            showDayNumbers &&
                              (strongTint ? 'text-background/95' : 'text-foreground/75'),
                            isHover && 'ring-1 ring-foreground/60',
                            (isSelected || inActiveRange) && 'ring-1 ring-foreground',
                            !inRange && 'opacity-30',
                          )}
                          style={{
                            height: cellPx,
                            width: cellPx,
                            backgroundColor: workMixMode ? undefined : cellBackground(cell),
                            // Rest-day tell: soft diagonal stripes overlaid on
                            // the intensity color. Reads as "different rhythm"
                            // without changing what the color means.
                            backgroundImage: isRest
                              ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(148,163,184,0.35) 3px 4px)'
                              : undefined,
                          }}
                          aria-label={
                            cell.workMix
                              ? `${cell.date}: ${workMixSummary(cell.workMix)}${isRest ? ' (rest day)' : ''}`
                              : `${cell.date}: ${cell.msgs} messages${isRest ? ' (Claude Code reset day)' : ''}`
                          }
                        >
                          {cell.workMix && renderWorkMixRings(cell.workMix)}
                          {/* Day number rides above the rings — the disc is a
                              flat wash, so a digit on top of it costs the mark
                              nothing and keeps the grid navigable by date. */}
                          {showDayNumbers && (
                            <span className="relative">{dayNum}</span>
                          )}
                          {drawBottomDivider && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute left-0 bg-foreground/30"
                              style={{
                                bottom: -Math.ceil(cellGap / 2) - 0.5,
                                width: cellPx,
                                height: 1,
                              }}
                            />
                          )}
                          {drawRightDivider && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute top-0 bg-foreground/30"
                              style={{
                                right: -Math.ceil(cellGap / 2) - 0.5,
                                height: cellPx,
                                width: 1,
                              }}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* Page chevrons — same quiet style as the day timeline's. Only shown
            when the range is wider than one grid window. */}
        {canPageBack && (
          <button
            type="button"
            onClick={() => pageBy('back')}
            className="absolute bottom-1.5 left-0 z-20 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground shadow-sm transition-colors hover:border-border/60 hover:text-foreground"
            aria-label="Show earlier weeks"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
        )}
        {canPageForward && (
          <button
            type="button"
            onClick={() => pageBy('forward')}
            className="absolute bottom-1.5 right-0 z-20 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground shadow-sm transition-colors hover:border-border/60 hover:text-foreground"
            aria-label="Show later weeks"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
        </div>
      )}
      <div className="min-h-[1.5rem] text-xs">
        {hovered ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
            <span className="font-medium text-foreground/80">{fmtDateLong(hovered.date)}</span>
            <span>
              <strong className="tabular-nums text-foreground/80">{hovered.totalMsgs}</strong> msgs
            </span>
            <span>
              <strong className="tabular-nums text-foreground/80">{hovered.totalChains}</strong> chains
            </span>
            {hoveredMix?.hasActivity &&
              (Object.entries(hoveredMix.hoursByKind) as [string, number][])
                .filter(([, hours]) => hours > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, hours]) => (
                  <span key={kind}>
                    <strong className="tabular-nums text-foreground/80">
                      {fmtHoursBlock(hours)}
                    </strong>{' '}
                    {projectKindLabelBlock(kind as ProjectKindBlock).toLowerCase()}
                  </span>
                ))}
          </div>
        ) : (
          <span className="text-muted-foreground/60">
            {workMixMode
              ? 'Centre is thinking · outer ring building · inner ring maintenance · each against your daily pool, in its project’s color · the green innermost track is time on projects you haven’t classified · Claude-tracked work only'
              : setMode
              ? 'Numbers are day-of-month · thin lines mark 3-day set boundaries · ringed cells are today’s set'
              : calendarMode
                ? 'Numbers are day-of-month · click a day · drag or shift-click for range · click a month label for the whole month'
                : 'Hover for details · click a day · drag or shift-click for range · click a month label for the whole month'}
          </span>
        )}
      </div>
    </div>
  )
}
