// Fold a day's per-project durations into the three marks a work-mix cell wears.
//
// The question this view answers is not "how did the day divide up". Time-share
// is the wrong measure here: building is cheap per unit and thinking is
// expensive, so proportional encoding makes the loudest band the one that
// matters least, and a stacked bar of five kinds is unreadable at 18px anyway.
//
// So the channels are asymmetric and independent:
//
//   fill  = thinking hours, against the user's own daily pool
//   ring  = what took the rest, as arcs on the perimeter (zero interior cost)
//   (hatch stays what it already was — rest days.)
//
// That yields the four states the view exists to make scannable, of which the
// third is the whole point:
//
//   solid, bare ring     — thinking day
//   solid, full ring     — big day; building did not come out of thinking
//   EMPTY, full ring     — busy all day, nothing landed
//   empty, bare ring     — quiet
//
// Both marks share one denominator (the pool) deliberately. "Building took a
// slot's worth" is only a statement about cost if a slot means the same thing
// on both sides.
//
// Conditioning and `other` get no mark. Conditioning has no derivable input yet
// (a book in a chair leaves no session), and rendering an always-empty band for
// it would read as a measurement of zero rather than an absence of data. Both
// are still summed here so the tooltip and day table can report them honestly.

import {
  normalizeProjectKindBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'

/** Fraction of the circle below which an arc is a rendering artifact rather
 *  than a mark. ~12% is about 6px of perimeter on an 18px cell. */
export const WORK_MIX_MIN_ARC_BLOCK = 0.12

/** Ring tone steps. One pool consumed is level 0; each further pool deepens the
 *  ring instead of drawing a second lap, which is sub-perceptual at cell size.
 *  The detail view is where a true lapping ring belongs. */
export type WorkMixOvershootBlock = 0 | 1 | 2

export interface WorkMixSegmentBlock {
  kind: Exclude<ProjectKindBlock, ''>
  /** Fraction of the circle this arc sweeps, after the minimum-arc floor. */
  sweep: number
  /** Unfloored hours, for the tooltip — the arc lies a little, this does not. */
  hours: number
}

export interface WorkMixCellBlock {
  /** Thinking hours ÷ pool, clamped to 1. Drives fill alpha. */
  fill: number
  /** True when thinking hours exceeded the pool — the fill is at its ceiling
   *  and the excess would otherwise be invisible. */
  fillOvershoot: boolean
  /** Ring arcs in fixed order (building, then maintenance), starting at 12
   *  o'clock. Fixed order because a color must mean the same thing in the same
   *  place on every cell or scanning a month stops working. */
  segments: WorkMixSegmentBlock[]
  /** How far past one pool the non-thinking hours went. */
  overshoot: WorkMixOvershootBlock
  /** Raw hours per kind, unrounded and unfloored — the honest numbers. */
  hoursByKind: Record<Exclude<ProjectKindBlock, ''>, number>
  /** Any hours at all, of any kind. Distinguishes "quiet" from "no data". */
  hasActivity: boolean
}

const MS_PER_HOUR = 3_600_000

/** Kinds that draw an arc, in the order they are drawn. */
const RING_KINDS_BLOCK: Exclude<ProjectKindBlock, ''>[] = ['building', 'maintenance']

function emptyHoursBlock(): Record<Exclude<ProjectKindBlock, ''>, number> {
  return { thinking: 0, building: 0, maintenance: 0, conditioning: 0, other: 0 }
}

/**
 * @param durationMsByProject `ActivityDay.byChainProjectDurationMs` — per-project
 *   wall-clock ms for one day, keyed by the canonical project name the parser
 *   emitted.
 * @param kindByProject built by `buildProjectKindMapBlock`. A project missing
 *   from it is unclassified and counts as `other`, which draws nothing — an
 *   unclassified vault therefore renders as empty cells rather than as a
 *   confident wrong answer.
 * @param poolHours the user's daily focused-work ceiling.
 */
export function foldWorkMixDayBlock(
  durationMsByProject: Record<string, number> | undefined,
  kindByProject: Record<string, ProjectKindBlock>,
  poolHours: number,
): WorkMixCellBlock {
  const hoursByKind = emptyHoursBlock()
  let total = 0

  for (const [project, ms] of Object.entries(durationMsByProject ?? {})) {
    if (!Number.isFinite(ms) || ms <= 0) continue
    const hours = ms / MS_PER_HOUR
    const kind = normalizeProjectKindBlock(kindByProject[project]) || 'other'
    hoursByKind[kind] += hours
    total += hours
  }

  const pool = Number.isFinite(poolHours) && poolHours > 0 ? poolHours : 4
  const fillRaw = hoursByKind.thinking / pool

  // The ring measures everything that competed with thinking against the same
  // pool. `other` is excluded on purpose: it is the residual bucket, so letting
  // it swell the ring would turn "I have not classified this yet" into "the day
  // was consumed", which is exactly the false accusation to avoid.
  const ringHours = RING_KINDS_BLOCK.reduce((sum, kind) => sum + hoursByKind[kind], 0)
  const ringRaw = ringHours / pool

  const segments: WorkMixSegmentBlock[] = []
  if (ringHours > 0) {
    // Arcs are proportional within one lap. Past a full pool the ring is full
    // and the surplus is carried by `overshoot`, not by more sweep.
    const scale = ringRaw > 1 ? 1 / ringHours : 1 / pool
    for (const kind of RING_KINDS_BLOCK) {
      const hours = hoursByKind[kind]
      if (hours <= 0) continue
      segments.push({ kind, sweep: hours * scale, hours })
    }
    applyMinimumArcBlock(segments, Math.min(1, ringRaw))
  }

  return {
    fill: Math.min(1, fillRaw),
    fillOvershoot: fillRaw > 1,
    segments,
    overshoot: ringRaw > 2 ? 2 : ringRaw > 1 ? 1 : 0,
    hoursByKind,
    hasActivity: total > 0,
  }
}

/**
 * Raise any present-but-invisible arc to the minimum, taking the difference
 * from the largest segment so the ring's total sweep is preserved.
 *
 * Trading a little magnitude accuracy for presence is the right way round: the
 * arc was only ever ~4 steps of precision, and "maintenance happened at all" is
 * the signal, while the exact hours live in the tooltip.
 */
function applyMinimumArcBlock(segments: WorkMixSegmentBlock[], totalSweep: number): void {
  let debt = 0
  for (const segment of segments) {
    if (segment.sweep < WORK_MIX_MIN_ARC_BLOCK) {
      debt += WORK_MIX_MIN_ARC_BLOCK - segment.sweep
      segment.sweep = WORK_MIX_MIN_ARC_BLOCK
    }
  }
  if (debt <= 0) return

  // A lone arc keeps its floor outright: there is no sibling to rebalance
  // against, and the ring's total is the segment itself, so preserving it would
  // just undo the floor. Half an hour of building on an otherwise thinking day
  // should show as a visible nick, not as nothing.
  if (segments.length < 2) return

  // With siblings, the ring's overall sweep is meaningful ("about a slot's
  // worth"), so the floor is paid for out of the largest arc rather than added
  // on top — unless the total is too small to seat every floor, in which case
  // every present kind keeps its minimum and the ring reads as "a little of
  // each", which is true.
  if (totalSweep < WORK_MIX_MIN_ARC_BLOCK * segments.length) return

  const donor = segments.reduce((a, b) => (a.sweep >= b.sweep ? a : b))
  donor.sweep = Math.max(WORK_MIX_MIN_ARC_BLOCK, donor.sweep - debt)
}

/**
 * CSS `conic-gradient` stops for the ring, or '' when nothing should be drawn.
 *
 * Hard stops only — this is a segmented ring, not a blend, and an interpolated
 * edge at 2px reads as a smudge.
 */
export function workMixRingGradientBlock(
  cell: WorkMixCellBlock,
  colorFor: (kind: Exclude<ProjectKindBlock, ''>) => string,
): string {
  if (cell.segments.length === 0) return ''
  const stops: string[] = []
  let cursor = 0
  for (const segment of cell.segments) {
    const start = cursor
    cursor = Math.min(1, cursor + segment.sweep)
    stops.push(`${colorFor(segment.kind)} ${pct(start)} ${pct(cursor)}`)
  }
  if (cursor < 1) stops.push(`transparent ${pct(cursor)} 100%`)
  return `conic-gradient(${stops.join(', ')})`
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`
}
