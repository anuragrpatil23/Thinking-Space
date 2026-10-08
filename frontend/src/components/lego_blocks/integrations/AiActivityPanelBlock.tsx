import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
} from '@/services/lego_blocks/units/storageKeyBlock'
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
import {
  fmtDayMonthBlock,
  isStripRangeBlock,
} from '@/services/lego_blocks/units/aiActivityStripBlock'
import { ensureSessionDigestOrch } from '@/services/orchestrators/aiActivitySessionDigestOrch'
import type { ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { useProjectsBlock } from '@/components/lego_blocks/hooks/shared/useProjectsBlock'
import { buildProjectKindMapBlock } from '@/services/lego_blocks/units/projectKindBlock'
import AiActivityDrillProjectTotalsBlock from '@/components/lego_blocks/units/AiActivityDrillProjectTotalsBlock'
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
import { getVaultWriteAiActivityAnyEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'

/** Which view produced the current drill selection. The detail (table + summary,
 *  plus the day timeline for the heatmap) docks under the section that owns the
 *  selection, so "the detail appears where you clicked" instead of a fixed
 *  bottom slot. Only one selection is ever active, so only one section's detail
 *  is open at a time. */
type DrillSource = 'heatmap' | 'trend' | 'totals'

type SectionKey = 'heatmap' | 'trend' | 'totals'

const DEFAULT_SECTIONS_OPEN: Record<SectionKey, boolean> = {
  heatmap: true,
  trend: true,
  totals: true,
}

/** Local-calendar "today" as YYYY-MM-DD — the heatmap's default drill day. */
function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
/** Optional controller hooks that turn the panel into a driver for another
 *  view (the vault graph). Both are undefined on the home canvas, where the
 *  panel is fully self-contained. */
export interface AiActivityGraphControls {
  /** Fires whenever the day/range drill changes: the chains now in focus, plus
   *  a label and whether a drill is active. Drives the graph day-highlight. */
  onSelectionChange?: (chains: ActivityChain[], meta: { label: string; active: boolean }) => void
  /** Fires when a session row is clicked. Drives the graph session-zoom. */
  onSelectChain?: (chain: ActivityChain) => void
  /** Compact control mode (vault graph): render only what's needed to drive the
   *  graph — the heatmap + its day drill — and drop the Trend/Totals analysis
   *  sections so the card stays a small corner widget instead of a full panel. */
  compact?: boolean
  /** Whether to open with today's cell drilled (default true). The graph passes
   *  false so it starts as a plain graph with nothing selected — the user drives
   *  it by clicking a day/session rather than landing on an auto-selection. */
  initialDrillToday?: boolean
  /** Bumped by the graph when it deselects (e.g. a blank-canvas click), so the
   *  card drops its session-row highlight and stays in sync with the graph. */
  deselectNonce?: number
  /** Standalone card (home, not the graph page): let session rows peek into the
   *  graph via ⌘-click / right-click → "Show in graph". Off in graph-controller
   *  mode, where the graph is already on screen and driven inline. */
  enableGraphPeek?: boolean
  /** Standalone card: show the "+ Log session" affordance for hand-logged time
   *  blocks. Actual write ability is further gated by any AI-Activity vault-write
   *  opt-in (the button disables + nudges when both are off). */
  enableManualSessions?: boolean
  /** Where the panel is drawn. 'page' is a full-screen host that supplies its
   *  own title bar, so the panel drops its heading and the desktop-sized gaps
   *  under it; 'card' (default) is the panel inside a card on Home. */
  surface?: 'card' | 'page'
}

export default function AiActivityPanelBlock({
  onSelectionChange,
  onSelectChain,
  compact = false,
  initialDrillToday = true,
  deselectNonce,
  enableGraphPeek = false,
  enableManualSessions = false,
  surface = 'card',
}: AiActivityGraphControls = {}) {
  const onPage = surface === 'page'
  const activity = useAiActivityBlock('90d')
  // Work-mix classification. Loaded here rather than in the heatmap so that
  // primitive stays prop-driven; cheap enough to keep unconditional, since the
  // projects list is a handful of records read once.
  const { projects } = useProjectsBlock()
  const kindByProject = useMemo(() => buildProjectKindMapBlock(projects), [projects])
  // Whether hand-logged sessions can be written — gated by any AI-Activity
  // vault-write opt-in (manual sessions live in the vault ai-activity/ folder,
  // so they ride its general write permission, not the digests-mirror toggle
  // specifically). Re-checked after a change so enabling it in Settings
  // reflects without a reload.
  const [manualWriteEnabled, setManualWriteEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    void getVaultWriteAiActivityAnyEnabled().then(v => { if (!cancelled) setManualWriteEnabled(v) })
    return () => { cancelled = true }
  }, [activity.chains])
  // Real project labels for the manual-session combobox (noise/unknown excluded).
  const knownProjects = useMemo(
    () => activity.projects.filter(p => !p.isNoise && !p.isUnknown).map(p => p.name),
    [activity.projects],
  )
  // Default drill source is the heatmap (which defaults to today, below), so the
  // panel opens already showing today's timeline + table under the calendar.
  const [drillSource, setDrillSource] = useState<DrillSource>('heatmap')
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>(() =>
    getJsonStorageItem(STORAGE_KEYS.aiActivitySectionsOpen, DEFAULT_SECTIONS_OPEN),
  )
  const toggleSection = (key: SectionKey) => {
    setSectionsOpen(prev => {
      const next = { ...prev, [key]: !prev[key] }
      setJsonStorageItem(STORAGE_KEYS.aiActivitySectionsOpen, next)
      return next
    })
  }
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    // Default the heatmap drill-down to today so the panel opens already
    // showing "what I did with AI today" instead of an empty drill area. The
    // graph opts out (initialDrillToday=false) so it starts as a plain graph.
    initialDrillToday ? todayIso() : null,
  )
  const [selectedRange, setSelectedRange] = useState<{ startIso: string; endIso: string } | null>(
    null,
  )

  const drillChains = useMemo(() => {
    let base: ActivityChain[] = []
    if (selectedDate) {
      // Overnight-aware "day": chains starting between selectedDate 00:00 and
      // 06:00 the next morning still belong to the selected day, so a 2-3am
      // session at the end of a long night doesn't get orphaned onto tomorrow.
      const dayStart = Date.parse(selectedDate + 'T00:00:00')
      const nextMorningCutoff = dayStart + 30 * 3_600_000
      base = activity.chains.filter(c => {
        const t = Date.parse(c.startedIso)
        return t >= dayStart && t < nextMorningCutoff
      })
    } else if (selectedRange) {
      // Compare in local-calendar day, not UTC slice — matches how the heatmap
      // buckets chains into days (see useAiActivityBlock days memo).
      base = activity.chains.filter(c => {
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
  }, [activity.chains, selectedDate, selectedRange, activeProject])

  // Section heading for the heatmap. At a week or two the grid becomes a day
  // strip, which already reads as a calendar — "Heatmap" over seven cells is a
  // label for a view that is no longer there. The date of the day in focus is
  // the more useful heading anyway: everything docked under this section is
  // scoped to it.
  const stripRange = isStripRangeBlock(activity.startIso, activity.endIso)
  const headingDate = selectedDate ?? activity.endIso
  const heatmapSectionTitle = useMemo(() => {
    if (!stripRange) return 'Heatmap'
    const { day, ordinal, month } = fmtDayMonthBlock(headingDate)
    return (
      // One size, two weights: the day in full-strength semibold, the month
      // beside it lighter and quieter. Earlier cuts set the numeral at display
      // scale with a smaller month in spaced capitals — three sizes on three
      // different lines, which read as loose parts rather than as a date.
      <span className="flex items-baseline gap-3 text-[40px] leading-none tracking-[-0.03em]">
        {/* The suffix rides at the cap height of the numeral, not on its
            baseline — set as a superior, the way a date is written by hand. It
            stays: a cut without it read as a number next to a word. */}
        <span className="flex items-start text-foreground">
          <span className="font-semibold tabular-nums">{day}</span>
          <span className="ml-0.5 text-[17px] font-medium leading-none tracking-tight text-foreground/60">
            {ordinal}
          </span>
        </span>
        <span className="font-normal text-foreground/40">{month}</span>
      </span>
    )
  }, [stripRange, headingDate])

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

  // Bulk digest regeneration for whatever the heatmap has selected.
  //
  // `refresh: true` is the point: it bypasses both the cache and the settle
  // guard, which is right for a human asking for it and wrong for anything
  // automatic. Sequential rather than fanned out — the queue caps at two
  // anyway, and firing 200 promises at once only makes the queue view unreadable.
  const [regenState, setRegenState] = useState<{ done: number; total: number } | null>(null)
  async function regenerateDigestsForSelection() {
    const sessions = drillChains.flatMap(c => c.sessions)
    if (sessions.length === 0) return
    setRegenState({ done: 0, total: sessions.length })
    try {
      for (let i = 0; i < sessions.length; i++) {
        await ensureSessionDigestOrch(sessions[i], { refresh: true }).catch(() => null)
        setRegenState({ done: i + 1, total: sessions.length })
      }
      activity.refresh()
    } finally {
      setRegenState(null)
    }
  }

  function clearDrill() {
    setSelectedDate(null)
    setSelectedRange(null)
  }

  // Selection setters that also record which view produced the selection, so the
  // detail docks under that section. Passing null clears the drill entirely.
  function drillToDate(date: string | null, source: DrillSource) {
    if (!date) {
      clearDrill()
      return
    }
    setSelectedRange(null)
    setSelectedDate(date)
    setDrillSource(source)
  }
  function drillToRange(
    range: { startIso: string; endIso: string } | null,
    source: DrillSource,
  ) {
    if (!range) {
      clearDrill()
      return
    }
    setSelectedDate(null)
    setSelectedRange(range)
    setDrillSource(source)
  }

  // On any range/source change, re-anchor the drill to today's heatmap cell
  // instead of clearing it — the panel should always land on "what I did with
  // AI today," matching how it first opens. When today falls outside the new
  // range (e.g. "last week" or a past custom range), anchor on the latest
  // in-range day so the drill still points at something the heatmap shows.
  function resetDrillToToday(range?: { startIso: string; endIso: string } | null) {
    // When the panel opts out of an initial today-drill (the graph), a range
    // change clears the drill rather than re-anchoring to today, so the graph
    // stays plain until the user explicitly picks a day/session.
    if (!initialDrillToday) {
      drillToDate(null, 'heatmap')
      return
    }
    const t = todayIso()
    let day = t
    if (range && t > range.endIso) day = range.endIso
    if (range && t < range.startIso) day = range.startIso
    drillToDate(day, 'heatmap')
  }

  const drillActive = selectedDate != null || selectedRange != null

  // ── Graph-controller wiring (no-op on the home canvas) ─────────────────────
  // The session currently driving the graph lens; cleared whenever the drilled
  // day/range changes so a stale row doesn't stay lit under a new day.
  const [selectedChainKey, setSelectedChainKey] = useState<string | null>(null)
  useEffect(() => {
    setSelectedChainKey(null)
  }, [selectedDate, selectedRange])
  // Drop the row highlight when the graph deselects. Skip the mount run so we
  // don't clobber anything on first render (and so the standalone view, which
  // never bumps the nonce, is unaffected).
  const firstDeselectRef = useRef(true)
  useEffect(() => {
    if (firstDeselectRef.current) {
      firstDeselectRef.current = false
      return
    }
    setSelectedChainKey(null)
  }, [deselectNonce])
  // Push the current day/range drill up to the graph so it can highlight the
  // notes that day's sessions touched. drillChains is memoized, so this only
  // fires when the selection actually changes.
  useEffect(() => {
    onSelectionChange?.(drillChains, { label: drillTitle, active: drillActive })
  }, [drillChains, drillActive, drillTitle, onSelectionChange])
  const handleSelectChain = (chain: ActivityChain) => {
    setSelectedChainKey(chain.key)
    onSelectChain?.(chain)
  }

  // The drill detail — timeline (heatmap/day only), range summary, and table.
  // Returns JSX (not a component) so React keeps the table's scroll position
  // stable across re-renders instead of remounting it.
  function renderDrillDetail(withTimeline: boolean) {
    return (
      // The roomier rhythm belongs to the strip, where a display-scale date
      // heads the section and the tighter original spacing reads as cramped
      // under it. The grid keeps the spacing it always had.
      <div
        className={cn(
          // No rule in strip mode. At the tighter grid spacing the line is what
          // separates the drill from the view above it; with 40px of air on
          // either side it separates nothing and just floats there. Space or
          // rule — not both at this scale. (A tighter ~32px step was tried
          // 2026-10-08 and read as busy; the air is what lets each block be
          // looked at on its own.)
          //
          // The top margin is tuned so the readout line → timeline gap equals
          // the date heading → day row gap above it (both ~59px from the
          // bottom of the text to the top of the marks). They are built from
          // different pieces — section margin + strip padding up there, readout
          // slack + this margin down here — so change one and re-measure the
          // other.
          stripRange ? 'mt-10 space-y-12 pt-[11px]' : 'mt-4 space-y-5 border-t border-border/30 pt-3',
        )}
      >
        {/* Timeline and the per-project totals under it are one unit: the
            totals row names the colors in the bars above it, so it reads as
            that chart's legend and has to sit close to it. The wide gap belongs
            between this pair and the table, not inside it. */}
        <div className={stripRange ? 'space-y-3' : 'space-y-5'}>
          {withTimeline && selectedDate && drillChains.length > 0 && (
            <AiActivityDayTimelineBlock
              dateIso={selectedDate}
              chains={drillChains}
              highlightProject={activeProject}
            />
          )}
          {/* Per-project time totals for the drill — the compact, at-a-glance
              replacement for the AI range summary. The table below is the
              granular session breakdown; clicking a project filters to it. */}
          {drillChains.length > 0 && (
            // Pulled out by the 4px each legend entry pads itself with, so its
            // first dot sits under the timeline's first gridline and the total
            // ends under its last.
            <div className="-mx-1">
              <AiActivityDrillProjectTotalsBlock
                chains={drillChains}
                activeProject={activeProject}
                onSelectProject={setActiveProject}
              />
            </div>
          )}
        </div>
        {/* Table is the only scrolling region — keeps the section header/chart
            pinned so context stays visible while you scan a multi-day drill.
            Wheel-capture stops the canvas from panning underneath while the
            cursor is over an overflowing table. */}
        {/* The table steps back out of the day view's 12px inset to the card's
            own margin: it is a bordered box with its own cell padding, and
            inset twice its rows lost width they need for the topic column. */}
        <div className={stripRange && withTimeline ? '-mx-3' : undefined}>
        <DrillTableScroll>
          <AiActivityDayTableBlock
            title={drillTitle}
            // Under the strip the date heading already says "8th Oct", so the
            // table's own line adds the one thing that heading leaves out —
            // the weekday — instead of repeating the date. A range keeps its
            // full title; nothing above spells a range out.
            heading={
              withTimeline && stripRange && selectedDate
                ? new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                  })
                : undefined
            }
            chains={drillChains}
            summary={drillSummary}
            highlightProject={activeProject}
            onReadingEdited={activity.refresh}
            onSelectChain={onSelectChain ? handleSelectChain : undefined}
            selectedChainKey={selectedChainKey}
            enableGraphPeek={enableGraphPeek}
            manualSessionsEnabled={enableManualSessions ? manualWriteEnabled : undefined}
            knownProjects={knownProjects}
            onManualChanged={activity.refresh}
          />
        </DrillTableScroll>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header — title, range pills, totals. Content below flows naturally
          and the surrounding container (canvas tile / page section) grows to
          fit; no internal scroll. */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* A page host names the panel in its own title bar. */}
        {!onPage && (
        <div>
          <h3 className="text-base font-semibold text-foreground">AI activity</h3>
          <p className="text-xs text-muted-foreground">
            AI sessions, msgs, projects over time
          </p>
        </div>
        )}
        {/* Two words in the corner say what is in effect — source, then range
            — and each opens its own short list. */}
        <div className="-ml-2 flex items-center sm:-mr-2 sm:ml-0">
          <SourceMenu
            value={activity.sourceFilter}
            onChange={next => {
              activity.setSourceFilter(next)
              resetDrillToToday(activity.customRange)
            }}
            counts={activity.sourceCounts}
            readingValue={activity.readingSource}
            onReadingChange={next => {
              activity.setReadingSource(next)
              resetDrillToToday(activity.customRange)
            }}
            readingCounts={activity.readingCounts}
          />
          <QuickRangeMenu
            label={
              activity.customRange?.label ??
              AI_ACTIVITY_PRESETS.find(p => p.id === activity.preset)?.label ??
              activity.preset
            }
            activeId={activity.customRange?.id ?? null}
            onSelect={range => {
              activity.setCustomRange(range)
              resetDrillToToday(range)
            }}
            presetOptions={AI_ACTIVITY_PRESETS}
            activePresetId={activity.customRange ? null : activity.preset}
            onSelectPreset={p => {
              activity.setPreset(p)
              // Presets are all rolling ranges ending today, so today is always
              // in range — no clamp needed.
              resetDrillToToday()
            }}
          />
        </div>
      </div>

      {/* One vertical step down the top of the card: title → project list →
          date heading → day row are each ~52px apart, measured from the bottom
          of one block's ink to the top of the next. The three margins differ
          (52 here, 54 on the sections wrapper, 44 on the strip section's body)
          only because each block carries different padding of its own. */}
      <div className={onPage ? 'mt-5' : 'mt-[52px]'}>
      {/* 5px, not the day view's 12: each chip carries 7px of its own padding
          and border before its dot, so this is what puts the dots on the line
          the date numeral and day row start on, and the durations on the line
          the timeline ends on. */}
      <div className="px-[5px]">
        <AiActivityProjectChipsBlock
          projects={activity.projects}
          activeProject={activeProject}
          onSelect={setActiveProject}
        />
      </div>

      {/* Project filter is global (applies to every view), so its clear-chip
          lives with the chips rather than inside any one section. */}
      {activeProject && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setActiveProject(null)}
            className="rounded-full border border-border/40 bg-card/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-border/70 hover:text-foreground"
            title={`Total active time for ${activeProject} across the visible range`}
          >
            clear filter · {activeProject}
            {activeProjectRangeDuration && activeProjectRangeDuration !== '—' && (
              <span className="ml-1 tabular-nums text-foreground/70">
                · {activeProjectRangeDuration}
              </span>
            )}
          </button>
        </div>
      )}

      {activity.error && (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {activity.error}
        </div>
      )}

      {/* All three views stacked as collapsible sections (no more toggle). Each
          section's drill detail docks under it — the detail appears where you
          clicked. Only the heatmap carries the day timeline; trend + totals
          only surface the range summary + table. */}
      <div
        className={
          compact
            ? 'mt-4'
            : cn(onPage ? 'mt-8' : stripRange ? 'mt-[54px]' : 'mt-10', onPage ? 'space-y-10' : 'space-y-14')
        }
      >
        <PanelSection
          title={heatmapSectionTitle}
          // px-3: the day view's body takes the same 12px inset as its date
          // heading, both sides. Only this section — Trend and Totals run to
          // the card's own margin.
          bodyClassName={stripRange ? 'mt-11 px-3' : undefined}
          open={sectionsOpen.heatmap}
          onToggle={() => toggleSection('heatmap')}
        >
          <AiActivityHeatmapBlock
            days={activity.days}
            loading={activity.loading}
            startIso={activity.startIso}
            endIso={activity.endIso}
            filterProject={activeProject}
            selectedDate={selectedDate}
            onSelectDate={d => drillToDate(d, 'heatmap')}
            selectedRange={selectedRange}
            onSelectRange={r => drillToRange(r, 'heatmap')}
            kindByProject={kindByProject}
            menuEntries={
              /* Select-all-days is a heatmap interaction, so it lives in the
                 heatmap's own right-click menu rather than as a chip in the
                 section header. Toggles: drills every day in the visible range,
                 then clears back to today. */
              (() => {
                const rangeStart = activity.customRange?.startIso ?? activity.startIso
                const rangeEnd = activity.customRange?.endIso ?? activity.endIso
                const wholeRangeSelected =
                  drillSource === 'heatmap' &&
                  selectedRange?.startIso === rangeStart &&
                  selectedRange?.endIso === rangeEnd
                const label = activity.customRange?.label ?? activity.preset
                const sessionCount = drillChains.reduce((n, c) => n + c.sessions.length, 0)
                return [
                  sessionCount > 0 && {
                    key: 'regenerate-digests',
                    label: regenState
                      ? `Regenerating ${regenState.done}/${regenState.total}…`
                      : `Regenerate ${sessionCount} session digest${sessionCount === 1 ? '' : 's'} for ${drillTitle}`,
                    disabled: Boolean(regenState),
                    onClick: () => { void regenerateDigestsForSelection() },
                  },
                  {
                    key: 'select-all-days',
                    label: wholeRangeSelected
                      ? 'Clear the range drill'
                      : `Select every day in ${label}`,
                    onClick: () => {
                      if (wholeRangeSelected) {
                        clearDrill()
                      } else {
                        drillToRange({ startIso: rangeStart, endIso: rangeEnd }, 'heatmap')
                      }
                    },
                  },
                ].filter(Boolean) as ContextMenuEntryBlock[]
              })()
            }
          />
          {drillSource === 'heatmap' && drillActive && renderDrillDetail(true)}
        </PanelSection>

        <PanelSection
          title="Trend"
          open={sectionsOpen.trend}
          onToggle={() => toggleSection('trend')}
        >
          <Suspense fallback={null}>
            <AiActivityTrendChartBlock
              days={activity.days}
              chains={activity.chains}
              projects={activity.projects}
              filterProject={activeProject}
              selectedDate={drillSource === 'trend' ? selectedDate : null}
              onSelectDate={d => drillToDate(d, 'trend')}
            />
          </Suspense>
          {drillSource === 'trend' && drillActive && renderDrillDetail(false)}
        </PanelSection>

        <PanelSection
          title="Totals"
          open={sectionsOpen.totals}
          onToggle={() => toggleSection('totals')}
        >
          <Suspense fallback={null}>
            <AiActivityAggregateBlock
              chains={aggregateChains}
              filterProject={activeProject}
              onSelectRange={range => drillToRange(range, 'totals')}
            />
          </Suspense>
          {drillSource === 'totals' && drillActive && renderDrillDetail(false)}
        </PanelSection>
      </div>
      </div>
    </div>
  )
}

const SOURCE_LABELS: Record<AiSourceFilter, string> = {
  all: 'All',
  'claude-code': 'Claude',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  reading: 'Reading',
}

// The header's two filters are two words — "All" and "7d" — each its own
// trigger for a plain list menu, the same surface the range menu always had.
// They are set once and left, so they get a word each and nothing more. What
// was tried first, in order: two bordered capsules of black pills (the two
// heaviest marks on the card, with selections of different sizes); the same
// rows as bare text (still two lines of options open in the corner); one
// summary line opening a captioned grid card (a panel over the project list,
// for two choices).
const FILTER_FOCUS_CLASS = 'outline-none focus-visible:ring-1 focus-visible:ring-foreground/40'
const FILTER_TRIGGER_CLASS = `inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-medium leading-none transition-colors ${FILTER_FOCUS_CLASS}`
const FILTER_MENU_CLASS =
  'absolute left-0 top-full z-50 mt-1 rounded-lg border border-border/60 bg-card/95 p-1 text-xs shadow-xl backdrop-blur-xl sm:left-auto sm:right-0'
const FILTER_ITEM_CLASS = 'block w-full rounded-md px-2 py-1 text-left transition-colors'
const FILTER_ITEM_ACTIVE_CLASS = 'bg-foreground/10 font-medium text-foreground'
const FILTER_ITEM_IDLE_CLASS = 'text-foreground/85 hover:bg-muted/50'

/** Collapsible section wrapper for the three AI-activity views. Header is a
 *  full-width toggle; an optional right-slot holds a section-scoped control
 *  (e.g. the heatmap's "select all days"). Collapsed hides the whole body,
 *  including any drill detail docked inside it. */
function PanelSection({
  title,
  open,
  onToggle,
  headerRight,
  bodyClassName,
  children,
}: {
  title: React.ReactNode
  open: boolean
  onToggle: () => void
  headerRight?: React.ReactNode
  /** Overrides the body's top margin — a display-scale title needs more air
   *  under it than a 14px one does. */
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          // Section headings are set in a little from the card's edge; hard
          // against it, the date numeral looked cramped by the border. All
          // three share the inset so the headings line up with each other.
          className="flex flex-1 items-center gap-1.5 pl-3 text-foreground/70 hover:text-foreground"
          aria-expanded={open}
        >
          {typeof title === 'string' ? (
            <span className="text-sm font-semibold tracking-tight">{title}</span>
          ) : (
            title
          )}
          {/* After the title, not before it: leading, the chevron took the
              card's left edge and pushed the heading a chevron's width in from
              the line every block below it starts on. */}
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 opacity-60 transition-transform',
              // A display-size title needs the chevron held further off than a
              // 14px one does, or it reads as the last glyph of the date.
              typeof title !== 'string' && 'ml-3.5',
              !open && '-rotate-90',
            )}
          />
        </button>
        {headerRight}
      </div>
      {open && <div className={bodyClassName ?? 'mt-3'}>{children}</div>}
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

function SourceMenu({
  value,
  onChange,
  counts,
  readingValue,
  onReadingChange,
  readingCounts,
}: {
  value: AiSourceFilter
  onChange: (next: AiSourceFilter) => void
  counts: { claudeCode: number; codex: number; chatgpt: number; grok: number; reading: number }
  readingValue: ReadingSourceFilter
  onReadingChange: (next: ReadingSourceFilter) => void
  readingCounts: ReadingCounts
}) {
  const [open, setOpen] = useState(false)
  const opts: Array<{ id: AiSourceFilter; count: number }> = [
    { id: 'all', count: counts.claudeCode + counts.codex + counts.chatgpt + counts.grok + counts.reading },
    { id: 'claude-code', count: counts.claudeCode },
    { id: 'codex', count: counts.codex },
    { id: 'chatgpt', count: counts.chatgpt },
    { id: 'grok', count: counts.grok },
    { id: 'reading', count: counts.reading },
  ]
  // Second filter dimension within "Reading" — same role the project chips play
  // for AI sessions. Only listed while Reading is the source.
  const readingOpts: Array<{ id: ReadingSourceFilter; label: string; count: number }> = [
    { id: 'all', label: 'All reading', count: readingCounts.all },
    { id: 'memorized', label: 'Memorize', count: readingCounts.memorized },
    { id: 'reading-md', label: 'Markdown', count: readingCounts.readingMd },
    { id: 'reading-draw', label: 'Drawing', count: readingCounts.readingDraw },
    { id: 'reading-pdf', label: 'PDF', count: readingCounts.readingPdf },
  ]
  const readingLabel =
    value === 'reading' && readingValue !== 'all'
      ? readingOpts.find(o => o.id === readingValue)?.label
      : null
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          FILTER_TRIGGER_CLASS,
          open ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        title="Which sessions to show"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {readingLabel ?? SOURCE_LABELS[value]}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className={cn(FILTER_MENU_CLASS, 'min-w-[136px]')}>
            {opts.map(o => {
              const active = o.id === value
              // Empty single sources are disabled so a click can't land on an
              // empty view ('All' always works, even with no data).
              const disabled = o.id !== 'all' && o.count === 0
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => {
                    onChange(o.id)
                    // Reading has a second choice to make; stay open for it.
                    if (o.id !== 'reading') setOpen(false)
                  }}
                  className={cn(
                    FILTER_ITEM_CLASS,
                    disabled
                      ? 'cursor-not-allowed text-foreground/30'
                      : active
                        ? FILTER_ITEM_ACTIVE_CLASS
                        : FILTER_ITEM_IDLE_CLASS,
                  )}
                  title={`${o.count} sessions in range`}
                >
                  {SOURCE_LABELS[o.id]}
                </button>
              )
            })}
            {value === 'reading' && (
              <>
                <div className="my-1 h-px bg-border/40" aria-hidden />
                {readingOpts.map(o => {
                  const active = o.id === readingValue
                  const disabled = o.id !== 'all' && o.count === 0
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      disabled={disabled}
                      onClick={() => {
                        onReadingChange(o.id)
                        setOpen(false)
                      }}
                      className={cn(
                        FILTER_ITEM_CLASS,
                        disabled
                          ? 'cursor-not-allowed text-foreground/30'
                          : active
                            ? FILTER_ITEM_ACTIVE_CLASS
                            : FILTER_ITEM_IDLE_CLASS,
                      )}
                      title={`${o.count} sessions in range`}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </>
      )}
    </span>
  )
}

function QuickRangeMenu({
  label,
  activeId,
  onSelect,
  presetOptions = [],
  activePresetId = null,
  onSelectPreset,
}: {
  /** The range in effect, shown as the trigger: "7d", "This week", "Oct 1 – Oct 8". */
  label: string
  /** Id of the active custom range, or null when a preset is in effect. */
  activeId: string | null
  /** Receives the picked range, or null when the active range is toggled off. */
  onSelect: (range: CustomRange | null) => void
  /** Rolling presets (7d … all), listed above the calendar ranges. */
  presetOptions?: ReadonlyArray<{ id: AiActivityPreset; label: string }>
  /** The menu-housed preset that's currently the active range, if any. */
  activePresetId?: AiActivityPreset | null
  onSelectPreset?: (id: AiActivityPreset) => void
}) {
  // Every way of setting the panel's range in one list: rolling presets, then
  // calendar-relative ranges, then a custom pick.
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
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          FILTER_TRIGGER_CLASS,
          'tabular-nums',
          open ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        title="Range — rolling, this week, last week, this month, custom"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden />
          <div
            role="menu"
            className={cn(
              FILTER_MENU_CLASS,
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
