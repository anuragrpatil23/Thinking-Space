// Fold a day's per-project durations into the three marks a work-mix cell wears.
//
// The question this view answers is not "how did the day divide up". Time-share
// is the wrong measure here: building is cheap per unit and thinking is
// expensive, so proportional encoding makes the loudest band the one that
// matters least, and a stacked bar of five kinds is unreadable at 18px anyway.
//
// So the channels are asymmetric and independent, arranged like activity rings:
//
//   centre disc = thinking hours, against the user's own daily pool
//   rings       = one concentric ring per competing kind, same pool
//   (hatch stays what it already was — rest days.)
//
// That yields the four states the view exists to make scannable, of which the
// third is the whole point:
//
//   solid centre, bare rings   — thinking day
//   solid centre, full rings   — big day; building did not come out of thinking
//   EMPTY centre, full rings   — busy all day, nothing landed
//   empty centre, bare rings   — quiet
//
// Every mark shares one denominator (the pool) deliberately. "Building took a
// slot's worth" is only a statement about cost if a slot means the same thing
// everywhere on the cell.
//
// Color is project identity, not kind: the panel already shows a project legend
// above the grid, and a second color language on the same screen would need a
// second legend to read. Kind is carried by *position* instead — the centre is
// always thinking, the outer ring always building, the innermost ring always
// maintenance — which is what keeps cells comparable down a column.
//
// `other` is the one exception to color-is-identity: its ring is a fixed neutral
// green, drawn between the two. It has to be readable as a different *kind* of
// statement — "there is time here nobody has classified" — and a project color
// would file it as measured work.
//
// Conditioning gets no mark. It has no derivable input yet (a book in a chair
// leaves no session), and rendering an always-empty band for it would read as a
// measurement of zero rather than an absence of data. It is still summed here so
// the tooltip and day table can report it honestly.

import {
  normalizeProjectKindBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'

/** Fraction of the circle below which an arc is a rendering artifact rather
 *  than a mark. ~12% is about 6px of perimeter on an 18px cell. */
export const WORK_MIX_MIN_ARC_BLOCK = 0.12

/** Ring tone steps: how many whole pools past the first this kind consumed. */
export type WorkMixOvershootBlock = 0 | 1 | 2

/** Laps drawn past the first. Three total (one pool, two pools, three) is where
 *  a 26px ring stops being able to say anything new; past that the arc is
 *  saturated and the tooltip carries the number. */
export const WORK_MIX_MAX_LAPS_BLOCK = 3

export interface WorkMixSegmentBlock {
  kind: Exclude<ProjectKindBlock, ''>
  /** Fraction of the circle this arc sweeps, after the minimum-arc floor. */
  sweep: number
  /** Unfloored hours, for the tooltip — the arc lies a little, this does not. */
  hours: number
  /** Hours ÷ pool, unclamped. The renderer needs the whole number, not the
   *  clamped `sweep`: 5h and 12h of building both close the ring, and without
   *  this they render identically. */
  raw: number
  /** How far past one pool this kind went, per ring. */
  overshoot: WorkMixOvershootBlock
  /**
   * The project that contributed most of this kind's hours that day, so the arc
   * can wear that project's own color and stay legible against the project
   * legend that is already on screen.
   *
   * Position carries the kind (building outermost, maintenance innermost,
   * always), so handing color over to project identity costs nothing that was
   * being read.
   */
  topProject: string | null
}

export interface WorkMixCellBlock {
  /** Thinking hours ÷ pool, clamped to 1. Drives fill alpha. */
  fill: number
  /** True when thinking hours exceeded the pool — the fill is at its ceiling
   *  and the excess would otherwise be invisible. */
  fillOvershoot: boolean
  /** Thinking hours ÷ pool, unclamped — the disc's equivalent of
   *  `WorkMixSegmentBlock.raw`, so a double pool of thinking can read as more
   *  than a single one. */
  fillRawRatio: number
  /** Ring arcs in fixed order (building, other, then maintenance), starting at 12
   *  o'clock. Fixed order because a color must mean the same thing in the same
   *  place on every cell or scanning a month stops working. */
  segments: WorkMixSegmentBlock[]
  /** How far past one pool the non-thinking hours went. */
  overshoot: WorkMixOvershootBlock
  /** Raw hours per kind, unrounded and unfloored — the honest numbers. */
  hoursByKind: Record<Exclude<ProjectKindBlock, ''>, number>
  /** Biggest thinking project of the day, so the fill wears its color. */
  thinkingProject: string | null
  /** Any hours at all, of any kind. Distinguishes "quiet" from "no data". */
  hasActivity: boolean
}

const MS_PER_HOUR = 3_600_000

/** Kinds that draw an arc, outermost first. `other` sits between the two: it is
 *  the residual bucket, and it draws in a neutral green rather than a project
 *  color so it reads as "not classified yet" instead of as a third kind of
 *  work. */
const RING_KINDS_BLOCK: Exclude<ProjectKindBlock, ''>[] = ['building', 'other', 'maintenance']

/** The kinds that count as *classified* non-thinking work. `other` is excluded:
 *  the day-level overshoot is a claim about how hard measured work took the day,
 *  and unclassified time cannot support that claim. */
const CLASSIFIED_RING_KINDS_BLOCK: Exclude<ProjectKindBlock, ''>[] = ['building', 'maintenance']

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
  // Biggest contributor per kind — the project whose color that kind's mark
  // wears. Ties break toward whichever came first, which is arbitrary but
  // stable for a given day.
  const topByKind: Partial<Record<Exclude<ProjectKindBlock, ''>, { name: string; hours: number }>> =
    {}
  let total = 0

  for (const [project, ms] of Object.entries(durationMsByProject ?? {})) {
    if (!Number.isFinite(ms) || ms <= 0) continue
    const hours = ms / MS_PER_HOUR
    const kind = normalizeProjectKindBlock(kindByProject[project]) || 'other'
    hoursByKind[kind] += hours
    const leader = topByKind[kind]
    if (!leader || hours > leader.hours) topByKind[kind] = { name: project, hours }
    total += hours
  }

  const pool = Number.isFinite(poolHours) && poolHours > 0 ? poolHours : 4
  const fillRaw = hoursByKind.thinking / pool

  // One ring per kind, each measured against the same pool — concentric, not
  // segments of a shared perimeter. This is the Apple-rings arrangement and it
  // is also the more honest one: two kinds are not competing for one circle,
  // they are each answering "how much of a slot did this take".
  //
  // `other` does get a ring, but a neutral green one drawn outside the project
  // colors. Without it an unclassified-heavy day looks exactly like an idle day,
  // and the only fix — go classify the project — is the one thing the cell never
  // mentions. The neutral tone is what keeps it from reading as "the day was
  // consumed": it says unmeasured, not spent.
  const segments: WorkMixSegmentBlock[] = []
  for (const kind of RING_KINDS_BLOCK) {
    const hours = hoursByKind[kind]
    if (hours <= 0) continue
    const raw = hours / pool
    segments.push({
      kind,
      // Floored so half an hour still reads as a visible nick rather than a
      // sub-pixel smudge, then clamped: past a full pool the ring is closed and
      // the surplus is carried by `overshoot`.
      sweep: Math.min(1, Math.max(WORK_MIX_MIN_ARC_BLOCK, raw)),
      hours,
      raw,
      overshoot: raw > 2 ? 2 : raw > 1 ? 1 : 0,
      topProject: topByKind[kind]?.name ?? null,
    })
  }

  // Kept for the cell as a whole: how hard the day was taken by everything that
  // was not thinking. Drives nothing on its own now that rings carry their own
  // overshoot, but the day table reports it.
  const ringRaw =
    CLASSIFIED_RING_KINDS_BLOCK.reduce((sum, kind) => sum + hoursByKind[kind], 0) / pool

  return {
    fill: Math.min(1, fillRaw),
    fillOvershoot: fillRaw > 1,
    fillRawRatio: fillRaw,
    segments,
    overshoot: ringRaw > 2 ? 2 : ringRaw > 1 ? 1 : 0,
    hoursByKind,
    thinkingProject: topByKind.thinking?.name ?? null,
    hasActivity: total > 0,
  }
}
