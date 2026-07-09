import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityDay } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useWheelScrollCaptureBlock } from '@/components/lego_blocks/hooks/shared/useWheelScrollCaptureBlock'
import {
  AI_ACTIVITY_CALENDAR_MODE_EVENT,
  AI_ACTIVITY_REST_DAYS_EVENT,
  AI_ACTIVITY_SET_MODE_EVENT,
  getAiActivityCalendarMode,
  getAiActivityRestDays,
  getAiActivitySetMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

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
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

/** Widest window the grid renders at once — longer ranges page via chevrons. */
const MAX_VISIBLE_WEEKS = 53
// Set-mode cell geometry — larger than default so day-of-month numbers fit
// legibly inside each cell.
const SET_CELL_PX = 18
const SET_CELL_GAP = 3

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
}: AiActivityHeatmapBlockProps) {
  const [setMode, setSetMode] = useState<boolean>(() => getAiActivitySetMode())
  const [calendarMode, setCalendarMode] = useState<boolean>(() => getAiActivityCalendarMode())
  const [restDays, setRestDays] = useState<number[]>(() => getAiActivityRestDays())
  useEffect(() => {
    const onSetMode = () => setSetMode(getAiActivitySetMode())
    const onCalMode = () => setCalendarMode(getAiActivityCalendarMode())
    const onRestDays = () => setRestDays(getAiActivityRestDays())
    window.addEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
    window.addEventListener(AI_ACTIVITY_CALENDAR_MODE_EVENT, onCalMode)
    window.addEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
    window.addEventListener('storage', onSetMode)
    window.addEventListener('storage', onCalMode)
    window.addEventListener('storage', onRestDays)
    return () => {
      window.removeEventListener(AI_ACTIVITY_SET_MODE_EVENT, onSetMode)
      window.removeEventListener(AI_ACTIVITY_CALENDAR_MODE_EVENT, onCalMode)
      window.removeEventListener(AI_ACTIVITY_REST_DAYS_EVENT, onRestDays)
      window.removeEventListener('storage', onSetMode)
      window.removeEventListener('storage', onCalMode)
      window.removeEventListener('storage', onRestDays)
    }
  }, [])
  // "Calendar look" = same big-cell / day-of-month layout that set-mode uses,
  // but without the 3-day dividers or the current-set ring. Either toggle
  // activates the layout; set-specific decorations still gate on setMode.
  const showDayNumbers = setMode || calendarMode

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
          // Top project by chain msg count so the cell tint matches the
          // chain-based drilldown table. Ignore noise buckets for tint only;
          // chips still surface them elsewhere when they are useful.
          let topMsgs = 0
          for (const [name, n] of Object.entries(projectCounts)) {
            const isNoise = name.startsWith('[') && name.endsWith(']')
            if (isNoise) continue
            if (n > topMsgs) {
              topMsgs = n
              topProject = name
            }
          }
        }
      }
      cells.push({ date, msgs, intensity: msgs, topProject })
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
  }, [dayMap, startIso, endIso, endOfCurrentMonthIso, filterProject])

  // Measure the outer scroll container so paging kicks in whenever the grid
  // would actually overflow — not just past the 53-week fallback. This
  // matters most in home-canvas embeds where the card is narrower than the
  // AI-Activity panel, and in set-mode where cells are ~1.75× wider so a
  // whole year no longer fits in the previously "always fits" 53-week band.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Trackpad horizontal swipe over the grid scrolls it in place instead of
  // panning the canvas underneath (vertical swipes still pan the board).
  useWheelScrollCaptureBlock(scrollContainerRef, 'x')
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
  const cellStepPx = showDayNumbers ? SET_CELL_PX + SET_CELL_GAP : 15
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

  function cellBackground(cell: CellModel): string {
    if (cell.intensity <= 0) return 'rgba(148,163,184,0.08)'
    const colorName = filterProject ?? cell.topProject ?? 'LTM'
    const { stroke } = getProjectColor(colorName)
    // Reuse the rgb(r,g,b) channels with a computed alpha.
    const m = stroke.match(/rgb\((\d+),(\d+),(\d+)\)/)
    if (!m) return stroke
    const alpha = 0.18 + cell.intensity * 0.65
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
  const cellPx = showDayNumbers ? SET_CELL_PX : 12
  const cellGap = showDayNumbers ? SET_CELL_GAP : 3
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
    <div className="space-y-2">
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
                    set straddles a Sun→Mon boundary. */}
                {currentSetRects.map(rect => (
                  <div
                    key={`curset-${rect.col}-${rect.topRow}`}
                    aria-hidden
                    className="pointer-events-none absolute rounded-[5px] bg-foreground/[0.04] ring-1 ring-foreground/40"
                    style={{
                      left: rect.col * step - 2,
                      top: rect.topRow * step - 2,
                      width: cellPx + 4,
                      height:
                        (rect.bottomRow - rect.topRow + 1) * step - cellGap + 4,
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
                      const strongTint = cell.intensity > 0.55
                      // 3-day set markers are a *forward-looking* pacing aid.
                      // In past months they read as noise, so gate the divider
                      // + day-number tint to the current calendar month only.
                      const cellMonthKey = `${cellDate.getFullYear()}-${cellDate.getMonth()}`
                      const isCurrentMonthCell = cellMonthKey === currentMonthKey
                      // Set-boundary dividers on trailing edges: bottom edge
                      // when next date is below in the same column, right edge
                      // when this cell is Sun (row 6) and the set boundary
                      // falls on the week-column seam.
                      const isSetBoundary =
                        setMode && isCurrentMonthCell && isLastDayOfSet(cell.date)
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
                            'relative flex items-center justify-center rounded-[3px] transition-all',
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
                            backgroundColor: cellBackground(cell),
                            // Rest-day tell: soft diagonal stripes overlaid on
                            // the intensity color. Reads as "different rhythm"
                            // without changing what the color means.
                            backgroundImage: isRest
                              ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(148,163,184,0.35) 3px 4px)'
                              : undefined,
                          }}
                          aria-label={`${cell.date}: ${cell.msgs} messages${isRest ? ' (Claude Code reset day)' : ''}`}
                        >
                          {showDayNumbers && dayNum}
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
          </div>
        ) : (
          <span className="text-muted-foreground/60">
            {setMode
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
