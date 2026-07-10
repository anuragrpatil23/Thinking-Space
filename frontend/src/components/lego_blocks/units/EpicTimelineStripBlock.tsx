import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'

interface EpicTimelineStripBlockProps {
  epics: NodeRecord[]
  /** Program key → program title, used for tooltips and color-grouping labels. */
  programTitleByKey?: Record<string, string>
  /** Click an epic pill (e.g. to focus the epic in the detail panel). */
  onSelectEpic?: (epic: NodeRecord) => void
  /** Highlight pills for a given program key; dim everything else. */
  highlightProgramKey?: string | null
  /** Faint watermark label centered behind the strip (e.g. the program-group name). */
  watermarkLabel?: string
}

const PIXELS_PER_DAY = 4
const ROW_HEIGHT = 20
const ROW_GAP = 3
const MIN_PILL_PX = 8
const MIN_PILL_DAYS = 1
const ROW_PACK_SLACK_PX = 10
// Vertical breathing room inserted between each program's row cluster so
// the eye can read "all rows of this color belong to one program".
const PROGRAM_CLUSTER_GAP_PX = 8
const DAY_MS = 24 * 60 * 60 * 1000
const AXIS_HEIGHT = 12
const LEFT_LABEL_WIDTH = 140
const STRIP_MAX_HEIGHT_PX = 440

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const t = Date.parse(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`)
  return Number.isNaN(t) ? null : t
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMonthLabel(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short' })
}

function colorKeyForEpic(epic: NodeRecord): string {
  return epic.parent ?? epic.parentUuid ?? epic.projectRoot ?? epic.uuid
}

interface PreparedEpic {
  epic: NodeRecord
  startMs: number
  endMs: number
  colorKey: string
}

export default function EpicTimelineStripBlock({
  epics,
  programTitleByKey,
  onSelectEpic,
  highlightProgramKey = null,
  watermarkLabel,
}: EpicTimelineStripBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [hoverId, setHoverId] = useState<string | null>(null)

  const prepared = useMemo<PreparedEpic[]>(() => {
    const nowMs = Date.now()
    const out: PreparedEpic[] = []
    for (const epic of epics) {
      // Active epics extend to "now" so they read as ongoing work; completed
      // epics terminate at their completion date.
      const completedMs = parseTimestamp(epic.epicCompletedAt)
      const endMs = completedMs ?? (epic.status === 'completed'
        ? parseTimestamp(epic.updatedAt) ?? nowMs
        : nowMs)
      const startCandidate = parseTimestamp(epic.createdAt)
      const startMs = startCandidate != null && startCandidate < endMs
        ? startCandidate
        : endMs - MIN_PILL_DAYS * DAY_MS
      out.push({ epic, startMs, endMs, colorKey: colorKeyForEpic(epic) })
    }
    return out
  }, [epics])

  const { axisStartMs, axisEndMs, totalDays } = useMemo(() => {
    // Default axis: Jan 1 → Dec 31 of the current calendar year (in the
    // viewer's local timezone). If any pill extends outside that window,
    // expand to whole-year boundaries that cover it.
    const now = new Date()
    let startYear = now.getFullYear()
    let endYear = startYear
    for (const p of prepared) {
      const sy = new Date(p.startMs).getFullYear()
      const ey = new Date(p.endMs).getFullYear()
      if (sy < startYear) startYear = sy
      if (ey > endYear) endYear = ey
    }
    const start = new Date(startYear, 0, 1).getTime()
    const end = new Date(endYear + 1, 0, 1).getTime()
    return { axisStartMs: start, axisEndMs: end, totalDays: Math.max(1, Math.round((end - start) / DAY_MS)) }
  }, [prepared])

  const widthPx = Math.max(480, totalDays * PIXELS_PER_DAY)

  // Month gridlines + year separators. With a year-default axis, hour/day
  // labels are too dense to read, so we anchor on months and call out January
  // boundaries with the year.
  const ticks = useMemo(() => {
    const out: Array<{ ms: number; isYearStart: boolean; label: string }> = []
    const cursor = new Date(axisStartMs)
    cursor.setDate(1)
    cursor.setHours(0, 0, 0, 0)
    while (cursor.getTime() <= axisEndMs) {
      const ms = cursor.getTime()
      const isYearStart = cursor.getMonth() === 0
      const label = isYearStart
        ? `${fmtMonthLabel(ms)} ${cursor.getFullYear()}`
        : fmtMonthLabel(ms)
      out.push({ ms, isYearStart, label })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return out
  }, [axisStartMs, axisEndMs])

  const clusters = useMemo(() => {
    type ClusterPill = {
      key: string
      prep: PreparedEpic
      leftPx: number
      widthPx: number
      topPx: number
    }
    type Cluster = {
      colorKey: string
      heightPx: number
      pills: ClusterPill[]
    }
    // Bucket pills by program so each program owns its own row band; sort
    // programs by earliest pill so older work sits on top.
    const byProgram = new Map<string, PreparedEpic[]>()
    for (const p of prepared) {
      const arr = byProgram.get(p.colorKey) ?? []
      arr.push(p)
      byProgram.set(p.colorKey, arr)
    }
    const programOrder = Array.from(byProgram.entries()).map(([colorKey, items]) => ({
      colorKey,
      items,
      earliest: items.reduce((min, it) => Math.min(min, it.startMs), Infinity),
    }))
    programOrder.sort((a, b) => a.earliest - b.earliest)

    const out: Cluster[] = []
    for (const { colorKey, items } of programOrder) {
      const rowEnds: number[] = []
      const sorted = [...items].sort((a, b) => a.startMs - b.startMs)
      const pills: ClusterPill[] = []
      for (const p of sorted) {
        const startedDays = (p.startMs - axisStartMs) / DAY_MS
        let endedDays = (p.endMs - axisStartMs) / DAY_MS
        if (endedDays < startedDays + MIN_PILL_DAYS) endedDays = startedDays + MIN_PILL_DAYS
        const leftPx = startedDays * PIXELS_PER_DAY
        const pillWidth = Math.max(MIN_PILL_PX, (endedDays - startedDays) * PIXELS_PER_DAY)
        let rowIdx = rowEnds.findIndex(end => end <= leftPx + ROW_PACK_SLACK_PX)
        if (rowIdx === -1) {
          rowIdx = rowEnds.length
          rowEnds.push(0)
        }
        rowEnds[rowIdx] = leftPx + pillWidth
        pills.push({
          key: p.epic.uuid,
          prep: p,
          leftPx,
          widthPx: pillWidth,
          topPx: rowIdx * (ROW_HEIGHT + ROW_GAP),
        })
      }
      const heightPx = Math.max(rowEnds.length, 1) * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
      out.push({ colorKey, heightPx, pills })
    }
    return out
  }, [prepared, axisStartMs])

  const scrollWrapRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    const el = scrollWrapRef.current
    if (!el) return
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
      setCanScrollUp(el.scrollTop > 0)
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [widthPx, prepared.length])

  // Auto-scroll to the latest activity on mount so the user lands on "now".
  useEffect(() => {
    const el = scrollWrapRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [widthPx])

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollWrapRef.current
    if (!el) return
    const delta = el.clientWidth * 0.5 * (direction === 'left' ? -1 : 1)
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }
  const scrollByVertical = (direction: 'up' | 'down') => {
    const el = scrollWrapRef.current
    if (!el) return
    const delta = el.clientHeight * 0.5 * (direction === 'up' ? -1 : 1)
    el.scrollBy({ top: delta, behavior: 'smooth' })
  }

  if (prepared.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground/70">
        No completed epics yet.
      </div>
    )
  }

  const innerWidth = LEFT_LABEL_WIDTH + widthPx

  return (
    <div ref={hostRef} className="relative">
      <div
        ref={scrollWrapRef}
        className="overflow-auto"
        style={{ maxHeight: STRIP_MAX_HEIGHT_PX }}
      >
        <div style={{ width: innerWidth }}>
          {clusters.map((cluster, idx) => {
            const programTitle = programTitleByKey?.[cluster.colorKey] ?? 'Unassigned'
            const color = getProjectColor(cluster.colorKey, isDark)
            return (
              <div key={`cluster-${cluster.colorKey}`}>
                {idx > 0 && <div style={{ height: PROGRAM_CLUSTER_GAP_PX }} />}
                <div className="relative flex" style={{ height: cluster.heightPx }}>
                  {/* Sticky y-axis label: stays glued to the left edge as the
                      strip scrolls horizontally. Solid background so pills
                      behind it don't bleed through. */}
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 bg-card pl-1 pr-2 text-[10px] font-medium leading-tight"
                    style={{ width: LEFT_LABEL_WIDTH, color: color.stroke }}
                    title={programTitle}
                  >
                    <span
                      className="inline-block w-[3px] shrink-0 rounded-sm"
                      style={{ height: Math.max(8, cluster.heightPx - 4), background: color.stroke, opacity: 0.55 }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{programTitle}</span>
                  </div>
                  {/* Strip cell for this program — gridlines + pills */}
                  <div className="relative shrink-0" style={{ width: widthPx, height: cluster.heightPx }}>
                    {ticks.map(tick => {
                      const x = ((tick.ms - axisStartMs) / DAY_MS) * PIXELS_PER_DAY
                      return (
                        <div
                          key={tick.ms}
                          className="absolute top-0 bottom-0"
                          style={{
                            left: x,
                            width: 1,
                            background: tick.isYearStart
                              ? 'rgba(148,163,184,0.45)'
                              : 'rgba(148,163,184,0.18)',
                          }}
                        />
                      )
                    })}
                    {cluster.pills.map(({ key, prep, leftPx, widthPx: pillWidth, topPx }) => {
                      const isHover = hoverId === key
                      const isHighlighted = highlightProgramKey != null && prep.colorKey === highlightProgramKey
                      const isDimmed = highlightProgramKey != null && !isHighlighted
                      const ringStyle = (isHighlighted || isHover) ? color.stroke : undefined
                      const titleLine = prep.epic.ticket ? `${prep.epic.ticket} – ${prep.epic.title}` : prep.epic.title
                      const showInPillLabel = pillWidth >= 36
                      return (
                        <button
                          key={key}
                          type="button"
                          onMouseEnter={() => setHoverId(key)}
                          onMouseLeave={() => setHoverId(h => (h === key ? null : h))}
                          onClick={() => onSelectEpic?.(prep.epic)}
                          className={cn(
                            'absolute flex items-center overflow-hidden rounded-md px-1.5 text-left transition-all',
                            (isHover || isHighlighted) && 'z-10',
                            isDimmed && 'opacity-30',
                          )}
                          style={{
                            left: leftPx,
                            width: pillWidth,
                            top: topPx,
                            height: ROW_HEIGHT,
                            background: color.fill,
                            boxShadow: ringStyle ? `inset 0 0 0 1.5px ${ringStyle}` : undefined,
                          }}
                          title={`${titleLine}\n${programTitle} · ${fmtDate(prep.startMs)} → ${fmtDate(prep.endMs)}`}
                          aria-label={`${titleLine} completed ${fmtDate(prep.endMs)}`}
                        >
                          {showInPillLabel && (
                            <span
                              className="block w-full truncate text-[10px] font-medium leading-none"
                              style={{ color: color.fillText }}
                            >
                              {prep.epic.title}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Month axis row — sticky to the bottom of the scroll viewport so
              it stays visible while vertically scrolling, and to left:0 so the
              spacer under the labels column doesn't slide off horizontally. */}
          <div className="sticky bottom-0 z-30 mt-1 flex bg-card" style={{ height: AXIS_HEIGHT }}>
            <div
              className="sticky left-0 z-20 shrink-0 bg-card"
              style={{ width: LEFT_LABEL_WIDTH, height: AXIS_HEIGHT }}
              aria-hidden
            />
            <div className="relative shrink-0" style={{ width: widthPx, height: AXIS_HEIGHT }}>
              {ticks.map(tick => {
                const x = ((tick.ms - axisStartMs) / DAY_MS) * PIXELS_PER_DAY
                return (
                  <div
                    key={tick.ms}
                    className={cn(
                      'absolute text-[9px] tabular-nums',
                      tick.isYearStart ? 'font-semibold text-foreground/70' : 'text-muted-foreground/70',
                    )}
                    style={{ left: x + 2 }}
                  >
                    {tick.label}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {watermarkLabel && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <span className="select-none truncate px-4 text-xl font-semibold uppercase tracking-wider text-foreground/10">
            {watermarkLabel}
          </span>
        </div>
      )}

{canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy('left')}
          className="absolute bottom-0 z-30 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground transition-colors hover:border-border/60 hover:text-foreground"
          style={{ left: LEFT_LABEL_WIDTH + 4 }}
          aria-label="Scroll timeline earlier"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy('right')}
          className="absolute bottom-0 right-0 z-30 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground transition-colors hover:border-border/60 hover:text-foreground"
          aria-label="Scroll timeline later"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
      {canScrollUp && (
        <button
          type="button"
          onClick={() => scrollByVertical('up')}
          className="absolute right-0 top-0 z-30 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground transition-colors hover:border-border/60 hover:text-foreground"
          aria-label="Scroll timeline up"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      )}
      {canScrollDown && (
        <button
          type="button"
          onClick={() => scrollByVertical('down')}
          className="absolute bottom-6 right-0 z-30 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground transition-colors hover:border-border/60 hover:text-foreground"
          aria-label="Scroll timeline down"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
