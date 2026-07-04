import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useAiActivityBlock,
  AI_ACTIVITY_PRESETS,
  type AiActivityPreset,
  type AiSourceFilter,
  type CustomRange,
  type ReadingCounts,
  type ReadingSourceFilter,
} from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import AiActivityHeatmapBlock from '@/components/lego_blocks/units/AiActivityHeatmapBlock'
import AiActivityRangeSummaryBlock from '@/components/lego_blocks/integrations/AiActivityRangeSummaryBlock'
import AiActivityProjectChipsBlock from '@/components/lego_blocks/units/AiActivityProjectChipsBlock'
// Code-split boundaries: these two pull recharts; keep it out of the startup bundle.
const AiActivityTrendChartBlock = lazy(() => import('@/components/lego_blocks/units/AiActivityTrendChartBlock'))
import AiActivityDayTableBlock from '@/components/lego_blocks/units/AiActivityDayTableBlock'
import AiActivityDayTimelineBlock from '@/components/lego_blocks/units/AiActivityDayTimelineBlock'
const AiActivityAggregateBlock = lazy(() => import('@/components/lego_blocks/units/AiActivityAggregateBlock'))
import MonthCalendar from '@/components/lego_blocks/integrations/MonthCalendarBlock'
import {
  fmtDurationMsBlock,
  mergedDurationMsBlock,
} from '@/services/lego_blocks/units/aiActivityStatsBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'

type ViewMode = 'heatmap' | 'trend' | 'totals'

/** Rolling presets tucked into the chevron menu instead of the pill row.
 *  Empty: every rolling preset (incl. 6m) lives on the pill strip; the menu is
 *  only calendar-relative ranges (this week, last week, this month) + custom. */
const MENU_PRESET_IDS = new Set<AiActivityPreset>([])

function fmtDateShort(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Pick the project with the most wall-clock time in the drill so the
 *  range-summary card has a sensible focus when no chip is selected.
 *  Ignores noise buckets ([auto-commit], [telegram], etc). */
function topProjectByTime(chains: ActivityChain[]): string | null {
  const totals = new Map<string, number>()
  for (const c of chains) {
    if (c.project.startsWith('[') && c.project.endsWith(']')) continue
    const dur = Date.parse(c.endedIso) - Date.parse(c.startedIso)
    if (!Number.isFinite(dur)) continue
    totals.set(c.project, (totals.get(c.project) ?? 0) + dur)
  }
  let best: string | null = null
  let bestMs = -1
  for (const [proj, ms] of totals) {
    if (ms > bestMs) { best = proj; bestMs = ms }
  }
  return best
}

export default function AiActivityPanelBlock() {
  const activity = useAiActivityBlock('90d')
  const [view, setView] = useState<ViewMode>('heatmap')
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    // Default the heatmap drill-down to today so the panel opens already
    // showing "what I did with AI today" instead of an empty drill area.
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  })
  const [selectedRange, setSelectedRange] = useState<{ startIso: string; endIso: string } | null>(
    null,
  )
  // Totals match what the chips show: signal projects only, noise buckets
  // ([auto-commit], [telegram]) excluded. This keeps "278 msgs" in the strip
  // equal to the sum of msgs across visible chips for the current range.
  const totals = useMemo(() => {
    let msgs = 0
    let chains = 0
    let sessions = 0
    for (const p of activity.projects) {
      if (p.isNoise) continue
      msgs += p.totalMsgs
      chains += p.totalChains
      sessions += p.totalSessions
    }
    return { msgs, chains, sessions }
  }, [activity.projects])

  // Drive-by chains — a single user message in under 2 minutes — are real
  // sessions but read as background noise in the day's drill view. Filter them
  // out of the timeline + table so the day reads as actual work. They stay
  // counted in totals, heatmap, chips, and project ranking so aggregates
  // remain honest.
  const isMinorChain = (c: ActivityChain): boolean => {
    if (c.msgCount > 1) return false
    const dur = Date.parse(c.endedIso) - Date.parse(c.startedIso)
    return Number.isFinite(dur) && dur < 120_000
  }

  const drillChains = useMemo(() => {
    let base: ActivityChain[] = []
    if (selectedDate) {
      // Overnight-aware "day": chains starting between selectedDate 00:00 and
      // 06:00 the next morning still belong to the selected day, so a 2-3am
      // session at the end of a long night doesn't get orphaned onto tomorrow.
      const dayStart = Date.parse(selectedDate + 'T00:00:00')
      const nextMorningCutoff = dayStart + 30 * 3_600_000
      base = activity.chains.filter(c => {
        if (isMinorChain(c)) return false
        const t = Date.parse(c.startedIso)
        return t >= dayStart && t < nextMorningCutoff
      })
    } else if (selectedRange) {
      // Compare in local-calendar day, not UTC slice — matches how the heatmap
      // buckets chains into days (see useAiActivityBlock days memo).
      base = activity.chains.filter(c => {
        if (isMinorChain(c)) return false
        const d = new Date(c.startedIso)
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const localDay = `${y}-${m}-${day}`
        return localDay >= selectedRange.startIso && localDay <= selectedRange.endIso
      })
    } else {
      return []
    }
    // Project chip acts as a hard filter on the drill (timeline + table +
    // summary), not just a row highlight — the "project active time" chip
    // already reports the range total, so the drill should match.
    if (activeProject) base = base.filter(c => c.project === activeProject)
    return base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.chains, selectedDate, selectedRange, activeProject])

  const drillTitle = selectedDate
    ? fmtDateShort(selectedDate)
    : selectedRange
      ? `${fmtDateShort(selectedRange.startIso)} → ${fmtDateShort(selectedRange.endIso)}`
      : ''

  const drillSummary = useMemo(() => {
    if (drillChains.length === 0) return undefined
    const msgs = drillChains.reduce((n, c) => n + c.msgCount, 0)
    const sessions = drillChains.reduce((n, c) => n + c.sessions.length, 0)
    const durLabel = fmtDurationMsBlock(mergedDurationMsBlock(drillChains))
    const base = `${drillChains.length} chains · ${sessions} sessions · ${msgs} msgs · ${durLabel}`
    // With a project filter active, append how much of the selection's
    // wall-clock time belongs to that project.
    if (activeProject) {
      const projChains = drillChains.filter(c => c.project === activeProject)
      const projDur = fmtDurationMsBlock(mergedDurationMsBlock(projChains))
      return `${base} — ${activeProject}: ${projDur}`
    }
    return base
  }, [drillChains, activeProject])

  // Project-filter stats across the whole visible range (independent of the
  // drill selection) — surfaced next to the "clear filter" chip.
  const activeProjectRangeDuration = useMemo(() => {
    if (!activeProject) return null
    const projChains = activity.chains.filter(c => c.project === activeProject)
    return fmtDurationMsBlock(mergedDurationMsBlock(projChains))
  }, [activity.chains, activeProject])

  // Chains feeding the totals view: project filter wins; otherwise everything
  // except noise buckets so totals agree with the totals strip + chips.
  const aggregateChains = useMemo(() => {
    if (activeProject) return activity.chains.filter(c => c.project === activeProject)
    return activity.chains.filter(
      c => !(c.project.startsWith('[') && c.project.endsWith(']')),
    )
  }, [activity.chains, activeProject])

  const rangeDurationLabel = useMemo(() => {
    const nonNoise = activity.chains.filter(
      c => !(c.project.startsWith('[') && c.project.endsWith(']')),
    )
    return fmtDurationMsBlock(mergedDurationMsBlock(nonNoise))
  }, [activity.chains])

  function clearDrill() {
    setSelectedDate(null)
    setSelectedRange(null)
  }

  return (
    <div className="flex flex-col">
      {/* Header — title, range pills, totals. Content below flows naturally
          and the surrounding container (canvas tile / page section) grows to
          fit; no internal scroll. */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">AI activity</h3>
          <p className="text-xs text-muted-foreground">
            AI sessions, msgs, projects over time
          </p>
        </div>
        {/* Pills tuck into the card's top-right corner: sources on top, range
            + refresh below, right edges flush. */}
        <div className="flex flex-col items-stretch gap-1.5">
          <SourcePills
            value={activity.sourceFilter}
            onChange={next => {
              activity.setSourceFilter(next)
              clearDrill()
            }}
            counts={activity.sourceCounts}
          />
          {activity.sourceFilter === 'reading' && (
            <ReadingSubPills
              value={activity.readingSource}
              onChange={next => {
                activity.setReadingSource(next)
                clearDrill()
              }}
              counts={activity.readingCounts}
            />
          )}
          <RangePills
            preset={activity.preset}
            customRange={activity.customRange}
            onChange={p => {
              activity.setPreset(p)
              clearDrill()
            }}
            onQuickRange={range => {
              activity.setCustomRange(range)
              clearDrill()
            }}
          />
        </div>
      </div>

      {/* Totals strip */}
      <div className="mt-2 flex items-baseline gap-4 text-xs text-muted-foreground">
        <span>
          <strong className="tabular-nums text-foreground/85">{totals.msgs.toLocaleString()}</strong> msgs
        </span>
        <span>
          <strong className="tabular-nums text-foreground/85">{totals.chains.toLocaleString()}</strong> chains
        </span>
        <span>
          <strong className="tabular-nums text-foreground/85">{totals.sessions.toLocaleString()}</strong> sessions
        </span>
        <span title="Merged wall-clock time across all non-noise chains in range">
          <strong className="tabular-nums text-foreground/85">{rangeDurationLabel}</strong>
        </span>
      </div>

      <div className="mt-3">
      <div>
        <AiActivityProjectChipsBlock
          projects={activity.projects}
          activeProject={activeProject}
          onSelect={setActiveProject}
        />
      </div>

      {activity.error && (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {activity.error}
        </div>
      )}

      {/* Chart stays on top — heatmap or trend. Drill table appears below it
          when a day or range is selected, never replacing the chart. */}
      <div className="mt-3 space-y-3">
        <div className="flex items-center gap-1">
          <ViewToggle view={view} onChange={setView} />
          {activeProject && (
            <button
              type="button"
              onClick={() => setActiveProject(null)}
              className="ml-2 rounded-full border border-border/40 bg-card/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-border/70 hover:text-foreground"
              title={`Total active time for ${activeProject} across the visible range`}
            >
              clear filter · {activeProject}
              {activeProjectRangeDuration && activeProjectRangeDuration !== '—' && (
                <span className="ml-1 tabular-nums text-foreground/70">
                  · {activeProjectRangeDuration}
                </span>
              )}
            </button>
          )}
          {/* Select-all-days lives on the same row as the view toggle, right-
              aligned. Toggles: first click drills every day in the visible
              range; second click clears back to whatever was drilled before
              (today by default). */}
          {(() => {
            const rangeStart = activity.customRange?.startIso ?? activity.startIso
            const rangeEnd = activity.customRange?.endIso ?? activity.endIso
            const wholeRangeSelected =
              selectedRange?.startIso === rangeStart &&
              selectedRange?.endIso === rangeEnd
            const label = activity.customRange?.label ?? activity.preset
            return (
              <button
                type="button"
                onClick={() => {
                  if (wholeRangeSelected) {
                    clearDrill()
                  } else {
                    setSelectedDate(null)
                    setSelectedRange({ startIso: rangeStart, endIso: rangeEnd })
                  }
                }}
                className={cn(
                  'ml-auto rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  wholeRangeSelected
                    ? 'border-foreground/70 bg-foreground/10 text-foreground'
                    : 'border-border/40 bg-card/40 text-muted-foreground hover:border-border/70 hover:text-foreground',
                )}
                title={wholeRangeSelected ? 'Clear the range drill' : `Drill on every day in ${label}`}
              >
                {wholeRangeSelected ? 'clear range' : 'select all days'}
              </button>
            )
          })()}
        </div>
        {view === 'heatmap' ? (
          <AiActivityHeatmapBlock
            days={activity.days}
            loading={activity.loading}
            startIso={activity.startIso}
            endIso={activity.endIso}
            filterProject={activeProject}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            selectedRange={selectedRange}
            onSelectRange={setSelectedRange}
          />
        ) : view === 'totals' ? (
          <Suspense fallback={null}>
            <AiActivityAggregateBlock
              chains={aggregateChains}
              filterProject={activeProject}
              onSelectRange={range => {
                setSelectedDate(null)
                setSelectedRange(range)
              }}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <AiActivityTrendChartBlock
              days={activity.days}
              chains={activity.chains}
              projects={activity.projects}
              filterProject={activeProject}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          </Suspense>
        )}
      </div>

      {(selectedDate || selectedRange) && (
        <div className="mt-4 space-y-3 border-t border-border/30 pt-3">
          {selectedDate && drillChains.length > 0 && (
            <AiActivityDayTimelineBlock
              dateIso={selectedDate}
              chains={drillChains}
              highlightProject={activeProject}
            />
          )}
          {/* Range summary appears above the table on every drill (single
              day or multi-day). Uses the active project chip when the user
              has one selected; otherwise focuses on the dominant project in
              the drill by wall-clock time so a summary always renders — the
              deterministic fallback (Settings → Off) still shows a ranked
              titles list, so the card is useful without any provider setup. */}
          {drillChains.length > 0 && (() => {
            const focusProject = activeProject ?? topProjectByTime(drillChains)
            if (!focusProject) return null
            const scopedChains = activeProject
              ? drillChains
              : drillChains.filter(c => c.project === focusProject)
            return (
              <AiActivityRangeSummaryBlock
                projectId={focusProject}
                projectLabel={focusProject}
                rangeStartDate={selectedDate ?? selectedRange?.startIso ?? ''}
                rangeEndDate={selectedDate ?? selectedRange?.endIso ?? ''}
                chains={scopedChains}
              />
            )
          })()}
          {/* Table is the only scrolling region — keeps header/heatmap/timeline
              pinned so context stays visible while you scan a "select all"
              multi-day drill. Wheel-capture stops the canvas from panning
              underneath while the cursor is over an overflowing table. */}
          <DrillTableScroll>
            <AiActivityDayTableBlock
              title={drillTitle}
              chains={drillChains}
              summary={drillSummary}
              highlightProject={activeProject}
              onReadingEdited={activity.refresh}
            />
          </DrillTableScroll>
        </div>
      )}
      </div>
    </div>
  )
}

// Very high cap — practically "grow with the content" for normal usage. The
// card is intended to expand and push the canvas world; internal scroll is
// only the safety valve for pathological "select all + full year" drills.
const DRILL_TABLE_MAX_HEIGHT = 3200

function DrillTableScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setOverflowing(el.scrollHeight - el.clientHeight > 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!overflowing) return
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation()
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      // Let the canvas keep receiving wheel at the natural end of scroll so
      // you can pan past the card once you've scrolled to the boundary.
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return
      e.preventDefault()
      el.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [overflowing])
  return (
    <div
      ref={ref}
      style={{
        maxHeight: DRILL_TABLE_MAX_HEIGHT,
        overflowY: 'auto',
      }}
    >
      {children}
    </div>
  )
}

function RangePills({
  preset,
  customRange,
  onChange,
  onQuickRange,
}: {
  preset: AiActivityPreset
  /** Active calendar-relative override; when set it owns the highlight and the
   *  preset pills go inactive (the range they describe is no longer in effect). */
  customRange?: CustomRange | null
  onChange: (p: AiActivityPreset) => void
  /** Quick "this week / last week / this month" calendar filters, folded into
   *  the same pill via a trailing chevron menu. Filters all data, not a drill.
   *  Null clears the active range back to the preset. */
  onQuickRange?: (range: CustomRange | null) => void
}) {
  const customActive = customRange != null
  // Less-used rolling presets live in the chevron menu (alongside the calendar
  // ranges) rather than as pills, to keep the pill row tight.
  const pillPresets = AI_ACTIVITY_PRESETS.filter(opt => !MENU_PRESET_IDS.has(opt.id))
  const menuPresets = AI_ACTIVITY_PRESETS.filter(opt => MENU_PRESET_IDS.has(opt.id))
  const activeMenuPreset = !customActive && MENU_PRESET_IDS.has(preset) ? preset : null
  return (
    <div
      role="tablist"
      aria-label="Range"
      className="flex h-7 w-full items-center gap-0.5 rounded-full border border-border/40 bg-muted/30 p-1"
    >
      {pillPresets.map(opt => {
        const active = !customActive && opt.id === preset
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex-1 rounded-full px-2 py-0.5 text-center text-[11px] font-medium tabular-nums transition-all',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
      {onQuickRange && (
        <>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border/50" aria-hidden />
          <QuickRangeMenu
            activeId={customRange?.id ?? null}
            onSelect={onQuickRange}
            presetOptions={menuPresets}
            activePresetId={activeMenuPreset}
            onSelectPreset={onChange}
          />
        </>
      )}
    </div>
  )
}

function SourcePills({
  value,
  onChange,
  counts,
}: {
  value: AiSourceFilter
  onChange: (next: AiSourceFilter) => void
  counts: { claudeCode: number; codex: number; chatgpt: number; grok: number; reading: number }
}) {
  const opts: Array<{ id: AiSourceFilter; label: string; count: number | null }> = [
    {
      id: 'all',
      label: 'All',
      count: counts.claudeCode + counts.codex + counts.chatgpt + counts.grok + counts.reading,
    },
    { id: 'claude-code', label: 'Claude', count: counts.claudeCode },
    { id: 'codex', label: 'Codex', count: counts.codex },
    { id: 'chatgpt', label: 'ChatGPT', count: counts.chatgpt },
    { id: 'grok', label: 'Grok', count: counts.grok },
    { id: 'reading', label: 'Reading', count: counts.reading },
  ]
  return (
    <div
      role="tablist"
      aria-label="AI source"
      className="flex h-7 w-full items-center gap-0.5 rounded-full border border-border/40 bg-muted/30 p-1"
    >
      {opts.map(opt => {
        const active = opt.id === value
        // Disable empty single-source pills so a click can't navigate into an
        // empty view (but 'All' is always clickable even when there's no data).
        const disabled = opt.id !== 'all' && opt.count === 0
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex-1 rounded-full px-2 py-0.5 text-center text-[11px] font-medium transition-all',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
            )}
            title={opt.count != null ? `${opt.count} sessions in range` : undefined}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function ReadingSubPills({
  value,
  onChange,
  counts,
}: {
  value: ReadingSourceFilter
  onChange: (next: ReadingSourceFilter) => void
  counts: ReadingCounts
}) {
  // Second filter dimension within "Reading" — same role the project chips play
  // for AI sessions. Only rendered while the Reading source pill is active.
  const opts: Array<{ id: ReadingSourceFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'goodnotes', label: 'GoodNotes', count: counts.goodnotes },
    { id: 'memorized', label: 'Memorize', count: counts.memorized },
    { id: 'reading-md', label: 'Markdown', count: counts.readingMd },
    { id: 'reading-draw', label: 'Drawing', count: counts.readingDraw },
  ]
  return (
    <div
      role="tablist"
      aria-label="Reading source"
      className="flex h-7 w-full items-center gap-0.5 rounded-full border border-border/30 bg-muted/20 p-1"
    >
      {opts.map(opt => {
        const active = opt.id === value
        const disabled = opt.id !== 'all' && opt.count === 0
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex-1 rounded-full px-2 py-0.5 text-center text-[10px] font-medium transition-all',
              active
                ? 'bg-foreground/90 text-background shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
            )}
            title={`${opt.count} sessions in range`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function QuickRangeMenu({
  activeId,
  onSelect,
  presetOptions = [],
  activePresetId = null,
  onSelectPreset,
}: {
  /** Id of the active custom range, or null when a preset is in effect. */
  activeId: string | null
  /** Receives the picked range, or null when the active range is toggled off. */
  onSelect: (range: CustomRange | null) => void
  /** Rolling presets (e.g. 6m) tucked in here instead of the pill row. */
  presetOptions?: ReadonlyArray<{ id: AiActivityPreset; label: string }>
  /** The menu-housed preset that's currently the active range, if any. */
  activePresetId?: AiActivityPreset | null
  onSelectPreset?: (id: AiActivityPreset) => void
}) {
  // Calendar-relative whole-panel filters plus the overflow rolling presets.
  // Rendered as the trailing item inside the range pill so it reads as one
  // control; reachable from any view without crowding the toggle row.
  const [open, setOpen] = useState(false)
  // Custom date-range picker (two-click: first sets the start, second the end).
  const now0 = new Date()
  const [showCal, setShowCal] = useState(false)
  const [calY, setCalY] = useState(now0.getFullYear())
  const [calM, setCalM] = useState(now0.getMonth() + 1)
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const iso = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const fmtRangeLabel = (startIso: string, endIso: string) => {
    const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const part = (s: string) => {
      const [, m, d] = s.split('-')
      return `${MONTH[Number(m) - 1]} ${Number(d)}`
    }
    return startIso === endIso ? part(startIso) : `${part(startIso)} – ${part(endIso)}`
  }
  const onCalSelect = (date: string) => {
    if (!pendingStart) {
      setPendingStart(date)
      return
    }
    const startIso = date < pendingStart ? date : pendingStart
    const endIso = date < pendingStart ? pendingStart : date
    onSelect({ id: 'custom', label: fmtRangeLabel(startIso, endIso), startIso, endIso })
    setPendingStart(null)
    setShowCal(false)
    setOpen(false)
  }
  const closeMenu = () => {
    setOpen(false)
    setShowCal(false)
    setPendingStart(null)
  }
  const mondayOf = (date: Date) => {
    const d = new Date(date)
    const dow = d.getDay()
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
    return d
  }
  const opts: Array<{ id: string; label: string }> = [
    { id: 'week', label: 'This week' },
    { id: 'lastweek', label: 'Last week' },
    { id: 'month', label: 'This month' },
  ]
  const rangeFor = (id: string, label: string): CustomRange => {
    const now = new Date()
    if (id === 'lastweek') {
      const start = mondayOf(now)
      start.setDate(start.getDate() - 7)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return { id, label, startIso: iso(start), endIso: iso(end) }
    }
    if (id === 'month') {
      return {
        id,
        label,
        startIso: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        endIso: iso(now),
      }
    }
    return { id, label, startIso: iso(mondayOf(now)), endIso: iso(now) }
  }
  const menuActive = activeId != null || activePresetId != null
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 transition-colors',
          menuActive
            ? 'bg-foreground text-background shadow-sm'
            : open
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
        title="More ranges — this week, last week, this month, custom"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden />
          <div
            role="menu"
            className={cn(
              'absolute right-0 top-full z-50 mt-1 rounded-lg border border-border/60 bg-card/95 p-1 text-xs shadow-xl backdrop-blur-xl',
              showCal ? 'w-[248px]' : 'min-w-[136px]',
            )}
          >
            {presetOptions.map(o => {
              const active = activePresetId === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onSelectPreset?.(o.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'block w-full rounded-md px-2 py-1 text-left tabular-nums transition-colors',
                    active
                      ? 'bg-foreground/10 font-medium text-foreground'
                      : 'text-foreground/85 hover:bg-muted/50',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
            {presetOptions.length > 0 && (
              <div className="my-1 h-px bg-border/40" aria-hidden />
            )}
            {opts.map(o => {
              const active = activeId === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    // Re-picking the active range clears it (back to the preset).
                    onSelect(active ? null : rangeFor(o.id, o.label))
                    setOpen(false)
                  }}
                  className={cn(
                    'block w-full rounded-md px-2 py-1 text-left transition-colors',
                    active
                      ? 'bg-foreground/10 font-medium text-foreground'
                      : 'text-foreground/85 hover:bg-muted/50',
                  )}
                >
                  {o.label}
                </button>
              )
            })}

            <div className="my-1 h-px bg-border/40" aria-hidden />
            <button
              type="button"
              role="menuitemradio"
              aria-checked={activeId === 'custom'}
              onClick={() => setShowCal(s => !s)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition-colors',
                activeId === 'custom'
                  ? 'bg-foreground/10 font-medium text-foreground'
                  : 'text-foreground/85 hover:bg-muted/50',
              )}
            >
              <span>Custom range…</span>
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showCal && 'rotate-180')}
              />
            </button>

            {showCal && (
              <div className="mt-1 rounded-lg border border-border/50 bg-muted/30 p-2.5">
                <MonthCalendar
                  compact
                  year={calY}
                  month={calM}
                  days={[]}
                  selectedDate={pendingStart}
                  onSelectDate={onCalSelect}
                  onMonthChange={(y, m) => {
                    setCalY(y)
                    setCalM(m)
                  }}
                />
                <p className="mt-2 border-t border-border/40 px-0.5 pt-2 text-[10px] text-muted-foreground">
                  {pendingStart
                    ? `Start ${fmtRangeLabel(pendingStart, pendingStart)} — pick an end date`
                    : 'Pick a start date'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode
  onChange: (v: ViewMode) => void
}) {
  const opts: Array<{ id: ViewMode; label: string }> = [
    { id: 'heatmap', label: 'heatmap' },
    { id: 'trend', label: 'trend' },
    { id: 'totals', label: 'totals' },
  ]
  return (
    <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 p-0.5">
      {opts.map(o => {
        const active = view === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-all',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
