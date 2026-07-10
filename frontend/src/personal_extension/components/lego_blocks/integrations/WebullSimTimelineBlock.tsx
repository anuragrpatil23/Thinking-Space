import { useMemo, useState, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import ChipBadgeBlock from '@/components/lego_blocks/units/ChipBadgeBlock'
import type { ChipColorBlock } from '@/services/lego_blocks/units/chipColorBlock'
import {
  SIM_STATUS_CHIP_COLOR_BLOCK,
  SIM_STATUS_LABEL_BLOCK,
  type WebullSimLaneMarkBlock,
  type WebullSimTimelineModelBlock,
} from '@/personal_extension/services/lego_blocks/units/webullSimRecordBlock'

// The Sim view's master axis is time, not tickers: one horizontal timeline with
// an era band on top and one company lane per business below. Marks sit at their
// moment; color = status; a segment shape = quarter-walk; hollow = bench.

const PX_PER_YEAR = 15
const MIN_PLOT_WIDTH = 900
const LANE_HEIGHT = 40
const ERA_BAND_HEIGHT = 46
const AXIS_HEIGHT = 22
const TRACK_PADDING_X = 16
const TOTAL_COL_WIDTH = 92 // right-hand "Total cases" column

// The company-name column sizes itself to the widest name (no truncation) now
// that the canvas grows to fit. Estimated from character count since we can't
// measure DOM here; clamped so a stray very-long name can't blow the layout out.
const LABEL_GUTTER_MIN = 160
const LABEL_GUTTER_MAX = 460
const LABEL_CHAR_PX = 8 // ~text-sm medium
const LABEL_GUTTER_PADDING = 44 // px-3 both sides + a little slack

export function computeSimLabelGutterBlock(model: WebullSimTimelineModelBlock): number {
  const longest = model.lanes.reduce((max, lane) => Math.max(max, lane.company.length), 'Eras'.length)
  return Math.round(Math.min(LABEL_GUTTER_MAX, Math.max(LABEL_GUTTER_MIN, longest * LABEL_CHAR_PX + LABEL_GUTTER_PADDING)))
}

export function computeSimTimelinePlotWidthBlock(model: WebullSimTimelineModelBlock): number {
  const span = Math.max(1, model.maxYear - model.minYear)
  return Math.max(MIN_PLOT_WIDTH, Math.round(span * PX_PER_YEAR))
}

/** Full intrinsic width of the timeline (label gutter + plot + side padding + total column). */
export function computeSimTimelineWidthBlock(model: WebullSimTimelineModelBlock): number {
  return computeSimLabelGutterBlock(model) + computeSimTimelinePlotWidthBlock(model) + TRACK_PADDING_X * 2 + TOTAL_COL_WIDTH
}

function laneCaseCountBlock(marks: { kind: 'case' | 'quarter-walk' | 'bench' }[]): number {
  return marks.filter((mark) => mark.kind !== 'bench').length
}

// Compact "how long the era lasted" label, e.g. "8 yrs" or "6 yrs+" for an
// era still running to the present.
function formatEraDurationBlock(start: number, end: number | null, currentYear: number): string {
  const years = Math.max(1, (end ?? currentYear) - start)
  return end === null ? `${years} yrs+` : `${years} yrs`
}

interface WebullSimTimelineBlockProps {
  model: WebullSimTimelineModelBlock
  onOpenCase: (filePath: string) => void
  /**
   * When true, the timeline renders at its full intrinsic width with no inner
   * horizontal scroll — the host (canvas card) grows to fit instead. When false
   * (default), it stays in a fixed card and scrolls horizontally.
   */
  fitWidth?: boolean
}

// Alternating neutral tints so adjacent era blocks read as distinct named spans.
const ERA_TINTS = [
  'bg-slate-500/[0.06] dark:bg-slate-300/[0.05]',
  'bg-slate-500/[0.12] dark:bg-slate-300/[0.10]',
]

// Faint dashed vertical section divider (an era boundary), full row height.
const DASHED_DIVIDER_CLASS = 'absolute top-0 bottom-0 border-l border-dashed border-border/40'
const TOP_SCALE_HEIGHT = 18

export default function WebullSimTimelineBlock({ model, onOpenCase, fitWidth = false }: WebullSimTimelineBlockProps) {
  const plotWidth = useMemo(() => computeSimTimelinePlotWidthBlock(model), [model])
  const span = Math.max(1, model.maxYear - model.minYear)
  const yearToX = (year: number) => ((year - model.minYear) / span) * plotWidth

  // Decade markers are the readable bottom scale.
  const decadeTicks = useMemo(() => {
    const ticks: number[] = []
    const start = Math.ceil(model.minYear / 10) * 10
    for (let year = start; year <= model.maxYear; year += 10) ticks.push(year)
    return ticks
  }, [model.minYear, model.maxYear])

  // Era boundaries drive the dashed section dividers + the small year labels near
  // the era band: one per era start, plus the present edge.
  const eraBoundaries = useMemo(() => {
    if (model.eras.length === 0) return decadeTicks
    const set = new Set<number>()
    for (const era of model.eras) set.add(era.start)
    set.add(model.maxYear)
    return [...set].filter((year) => year >= model.minYear && year <= model.maxYear).sort((a, b) => a - b)
  }, [model.eras, model.minYear, model.maxYear, decadeTicks])

  const summaryTiles: Array<{ label: string; value: number; color: ChipColorBlock }> = [
    { label: SIM_STATUS_LABEL_BLOCK['case-staged'], value: model.counts.staged, color: SIM_STATUS_CHIP_COLOR_BLOCK['case-staged'] },
    { label: SIM_STATUS_LABEL_BLOCK['response-written'], value: model.counts.responseWritten, color: SIM_STATUS_CHIP_COLOR_BLOCK['response-written'] },
    { label: SIM_STATUS_LABEL_BLOCK.revealed, value: model.counts.revealed, color: SIM_STATUS_CHIP_COLOR_BLOCK.revealed },
    { label: SIM_STATUS_LABEL_BLOCK['post-mortem-done'], value: model.counts.postMortemDone, color: SIM_STATUS_CHIP_COLOR_BLOCK['post-mortem-done'] },
  ]

  const labelGutter = useMemo(() => computeSimLabelGutterBlock(model), [model])
  const currentYear = new Date().getFullYear()
  const trackWidth = plotWidth
  const totalWidth = labelGutter + trackWidth + TRACK_PADDING_X * 2 + TOTAL_COL_WIDTH

  if (model.lanes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
        No sim reps or bench candidates found yet. Cases live under
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">cases/&lt;company&gt;/</code>
        in the f9-sim folder.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary strip: counts by status + totals. */}
      <div className="flex flex-wrap items-center gap-2">
        {summaryTiles.map((tile) => (
          <div
            key={tile.label}
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 py-1 pl-1.5 pr-3 text-xs"
          >
            <ChipBadgeBlock color={tile.color}>{tile.value}</ChipBadgeBlock>
            <span className="text-muted-foreground">{tile.label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground tabular-nums">{model.totalReps}</span> reps</span>
          <span><span className="font-semibold text-foreground tabular-nums">{model.benchSize}</span> bench</span>
        </div>
      </div>

      {/* Timeline: era band + company lanes, aligned to a shared year axis. */}
      <div className={cn('rounded-xl border border-border/60 bg-background/40', !fitWidth && 'overflow-x-auto')}>
        <div style={{ width: totalWidth, minWidth: fitWidth ? undefined : '100%' }}>
          {/* Era band */}
          <div className="flex items-stretch border-b border-border/50">
            <div className="flex shrink-0 items-center px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" style={{ width: labelGutter }}>
              Eras
            </div>
            <div className="relative shrink-0" style={{ width: trackWidth, height: ERA_BAND_HEIGHT, marginLeft: TRACK_PADDING_X, marginRight: TRACK_PADDING_X }}>
              {model.eras.map((era, index) => {
                const left = yearToX(era.start)
                const right = yearToX(era.end ?? model.maxYear)
                const width = Math.max(2, right - left)
                const duration = formatEraDurationBlock(era.start, era.end, currentYear)
                return (
                  <div
                    key={era.slug}
                    className={cn('absolute top-1 bottom-1 flex flex-col items-center justify-center overflow-hidden rounded-sm px-1', ERA_TINTS[index % ERA_TINTS.length])}
                    style={{ left, width }}
                    title={`${era.label} · ${era.start}–${era.end ?? 'present'} (${duration})`}
                  >
                    <span className="max-w-full truncate text-[10px] leading-tight text-muted-foreground">{era.label}</span>
                    <span className="text-[9px] leading-tight text-muted-foreground/55 tabular-nums">{duration}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex shrink-0 items-center justify-end px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" style={{ width: TOTAL_COL_WIDTH }}>
              Cases
            </div>
          </div>

          {/* Era-boundary years — small labels right under the era band, so the
              section starts are easy to read without crowding the bottom scale. */}
          <div className="flex items-stretch">
            <div className="shrink-0" style={{ width: labelGutter }} />
            <div className="relative shrink-0" style={{ width: trackWidth, height: TOP_SCALE_HEIGHT, marginLeft: TRACK_PADDING_X, marginRight: TRACK_PADDING_X }}>
              {eraBoundaries.map((year) => (
                <span
                  key={year}
                  className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground/60 tabular-nums"
                  style={{ left: yearToX(year) }}
                >
                  {year}
                </span>
              ))}
            </div>
            <div className="shrink-0" style={{ width: TOTAL_COL_WIDTH }} />
          </div>

          {/* Company lanes */}
          <div>
            {model.lanes.map((lane, laneIndex) => (
              <div
                key={lane.companySlug}
                className={cn('flex items-stretch', laneIndex > 0 && 'border-t border-border/40')}
              >
                <div
                  className="flex shrink-0 items-center px-3 text-sm"
                  style={{ width: labelGutter, height: LANE_HEIGHT }}
                >
                  <span className="font-medium text-foreground">{lane.company}</span>
                </div>
                <div
                  className="relative shrink-0"
                  style={{ width: trackWidth, height: LANE_HEIGHT, marginLeft: TRACK_PADDING_X, marginRight: TRACK_PADDING_X }}
                >
                  {/* Faint dashed era-boundary dividers section the lane by era. */}
                  {eraBoundaries.map((year) => (
                    <div key={year} className={DASHED_DIVIDER_CLASS} style={{ left: yearToX(year) }} />
                  ))}
                  {lane.marks.map((mark) => (
                    <SimMark
                      key={mark.key}
                      mark={mark}
                      leftX={yearToX(mark.momentYear)}
                      rightX={mark.spanEndYear !== null ? yearToX(mark.spanEndYear) : null}
                      laneHeight={LANE_HEIGHT}
                      onOpenCase={onOpenCase}
                    />
                  ))}
                </div>
                <div
                  className="flex shrink-0 items-center justify-end px-3 text-sm tabular-nums text-foreground"
                  style={{ width: TOTAL_COL_WIDTH, height: LANE_HEIGHT }}
                >
                  {laneCaseCountBlock(lane.marks)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals row across companies */}
          <div className="flex items-stretch border-t border-border/60 bg-muted/20">
            <div className="flex shrink-0 items-center px-3 text-sm font-semibold text-foreground" style={{ width: labelGutter, height: LANE_HEIGHT }}>
              All companies
            </div>
            <div className="relative shrink-0" style={{ width: trackWidth, height: LANE_HEIGHT, marginLeft: TRACK_PADDING_X, marginRight: TRACK_PADDING_X }}>
              {eraBoundaries.map((year) => (
                <div key={year} className={DASHED_DIVIDER_CLASS} style={{ left: yearToX(year) }} />
              ))}
            </div>
            <div className="flex shrink-0 items-center justify-end px-3 text-sm font-semibold tabular-nums text-foreground" style={{ width: TOTAL_COL_WIDTH, height: LANE_HEIGHT }}>
              {model.totalReps}
            </div>
          </div>

          {/* Year axis — decade markers as the readable bottom scale. */}
          <div className="flex items-stretch border-t border-border/50">
            <div className="shrink-0" style={{ width: labelGutter }} />
            <div className="relative shrink-0" style={{ width: trackWidth, height: AXIS_HEIGHT, marginLeft: TRACK_PADDING_X, marginRight: TRACK_PADDING_X }}>
              {decadeTicks.map((year) => (
                <div key={year} className="absolute top-0 flex flex-col items-center" style={{ left: yearToX(year), transform: 'translateX(-50%)' }}>
                  <div className="h-1.5 w-px bg-border/40" />
                  <span className="mt-0.5 text-[10px] text-muted-foreground/70 tabular-nums">{year}</span>
                </div>
              ))}
            </div>
            <div className="shrink-0" style={{ width: TOTAL_COL_WIDTH }} />
          </div>
        </div>
      </div>
    </div>
  )
}

interface SimMarkProps {
  mark: WebullSimLaneMarkBlock
  leftX: number
  rightX: number | null
  laneHeight: number
  onOpenCase: (filePath: string) => void
}

function SimMark({ mark, leftX, rightX, laneHeight, onOpenCase }: SimMarkProps) {
  const [hovered, setHovered] = useState(false)
  const centerY = laneHeight / 2
  const clickable = mark.filePath !== null
  const chip = SIM_STATUS_CHIP_COLOR_BLOCK[mark.status]

  // Reuse the shared chip fill (bg-*) so marks track the status palette exactly.
  const fillClass = chipFillClassBlock(chip)

  const handleClick = () => {
    if (mark.filePath) onOpenCase(mark.filePath)
  }

  const commonProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: handleClick,
    role: clickable ? 'button' : undefined,
    tabIndex: clickable ? 0 : undefined,
  }

  let markEl: ReactElement
  if (mark.kind === 'quarter-walk' && rightX !== null) {
    const width = Math.max(10, rightX - leftX)
    markEl = (
      <div
        {...commonProps}
        className={cn('absolute -translate-y-1/2 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10', fillClass, clickable && 'cursor-pointer')}
        style={{ left: leftX, top: centerY, height: 12, width }}
      />
    )
  } else if (mark.kind === 'bench') {
    // Hollow mark — candidate not yet staged.
    markEl = (
      <div
        {...commonProps}
        className={cn('absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground/60 bg-background', clickable && 'cursor-pointer')}
        style={{ left: leftX, top: centerY }}
      />
    )
  } else {
    // Point-in-time case: filled dot.
    markEl = (
      <div
        {...commonProps}
        className={cn('absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10', fillClass, clickable && 'cursor-pointer')}
        style={{ left: leftX, top: centerY }}
      />
    )
  }

  return (
    <>
      {markEl}
      {hovered && (
        // Anchored directly above the mark (absolute within the lane track) so it
        // stays attached even when the canvas is panned/zoomed via CSS transform.
        <div
          className="pointer-events-none absolute z-50 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-md border border-border/70 bg-white px-3 py-2 text-xs shadow-lg dark:bg-neutral-900"
          style={{ left: leftX, top: centerY - 10 }}
        >
          <div className="font-semibold text-foreground">{mark.company}</div>
          <div className="text-muted-foreground">{mark.momentLabel}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <ChipBadgeBlock color={SIM_STATUS_CHIP_COLOR_BLOCK[mark.status]}>
              {SIM_STATUS_LABEL_BLOCK[mark.status]}
            </ChipBadgeBlock>
            {mark.era && <span className="text-muted-foreground/80">{mark.era}</span>}
          </div>
          {mark.kind === 'bench' && mark.detail && (
            <div className="mt-1 text-muted-foreground">{mark.detail}</div>
          )}
        </div>
      )}
    </>
  )
}

// Extract just the fill portion (bg-* / dark:bg-*) of the shared chip recipe so
// a solid mark reads in the same hue as its status chip in both themes.
function chipFillClassBlock(color: ChipColorBlock): string {
  const map: Record<string, string> = {
    slate: 'bg-slate-400 dark:bg-slate-500',
    zinc: 'bg-zinc-400 dark:bg-zinc-500',
    amber: 'bg-amber-500 dark:bg-amber-400',
    sky: 'bg-sky-500 dark:bg-sky-400',
    emerald: 'bg-emerald-500 dark:bg-emerald-400',
  }
  return map[color] ?? map.zinc
}
