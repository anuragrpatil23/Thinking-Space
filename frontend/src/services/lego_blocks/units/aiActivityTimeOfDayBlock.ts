// Sessions placed on each day's clock, for the Trend section's time-of-day view.
//
// The hours-per-day bars answer "how much"; Plan usage already answers it again
// in limit-%. This answers "when": late nights, mornings eaten by building, one
// long block or a scattered day. One row per local day, 12a → 12a.
//
// Sessions, not chains: a chain stitches windows across idle gaps, so its
// start→end span would paint the gaps as work.

const DAY_MIN = 24 * 60

export interface TimeOfDaySegmentBlock {
  /** Minutes after local midnight, clamped to the day. */
  startMin: number
  endMin: number
  project: string
  topic: string
  startIso: string
  endIso: string
}

interface SessionLike {
  startedIso: string
  /** Absent on some mirrored rows — treated as start (a tick). */
  endedIso?: string
  project: string
  topic: string
}

function localMidnight(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** Noise buckets (`[auto-commit]`, `[telegram]`) are automation, not your day. */
function isNoiseProject(project: string): boolean {
  return project.startsWith('[') && project.endsWith(']')
}

/**
 * Segments per day, keyed by `YYYY-MM-DD`. A session that crosses midnight is
 * split across both rows. A session with no measured span (vault-markdown
 * mirrors carry start === end) keeps zero width; the view draws it as a tick.
 */
export function timeOfDaySegmentsBlock(
  days: readonly string[],
  sessions: readonly SessionLike[],
  filterProject?: string | null,
): Map<string, TimeOfDaySegmentBlock[]> {
  const out = new Map<string, TimeOfDaySegmentBlock[]>()
  for (const day of days) out.set(day, [])
  const bounds = days.map(day => ({ day, start: localMidnight(day) }))

  for (const s of sessions) {
    if (isNoiseProject(s.project)) continue
    if (filterProject && s.project !== filterProject) continue
    const start = Date.parse(s.startedIso)
    const end = Math.max(start, Date.parse(s.endedIso ?? s.startedIso))
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    for (const { day, start: dayStart } of bounds) {
      const dayEnd = dayStart + DAY_MIN * 60_000
      const overlaps = start === end ? start >= dayStart && start < dayEnd : start < dayEnd && end > dayStart
      if (!overlaps) continue
      out.get(day)!.push({
        startMin: Math.max(0, (start - dayStart) / 60_000),
        endMin: Math.min(DAY_MIN, (end - dayStart) / 60_000),
        project: s.project,
        topic: s.topic,
        startIso: s.startedIso,
        endIso: s.endedIso ?? s.startedIso,
      })
    }
  }
  for (const segments of out.values()) segments.sort((a, b) => a.startMin - b.startMin)
  return out
}

export interface PackedTimeOfDayBlock {
  /** 1 when nothing overlaps; 2 when anything does (a third overlap shares lane 2). */
  lanes: 1 | 2
  items: Array<TimeOfDaySegmentBlock & { lane: 0 | 1 }>
}

/**
 * One row's segments, cleaned for drawing.
 *
 * Same-project segments closer than `mergeGapMin` fuse into one block — a
 * minute's pause between windows is not a break worth a hairline. Overlapping
 * segments then go to a second lane instead of being drawn translucent on top
 * of each other: two project colours mixed read as a third colour that belongs
 * to nobody.
 */
export function packTimeOfDayRowBlock(
  segments: readonly TimeOfDaySegmentBlock[],
  mergeGapMin = 10,
): PackedTimeOfDayBlock {
  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin)
  const merged: TimeOfDaySegmentBlock[] = []
  const lastByProject = new Map<string, TimeOfDaySegmentBlock>()
  for (const seg of sorted) {
    const prev = lastByProject.get(seg.project)
    if (prev && seg.startMin - prev.endMin < mergeGapMin) {
      if (seg.endMin > prev.endMin) {
        prev.endMin = seg.endMin
        prev.endIso = seg.endIso
      }
      continue
    }
    const copy = { ...seg }
    merged.push(copy)
    lastByProject.set(seg.project, copy)
  }

  const laneEnd = [-Infinity, -Infinity]
  const items = merged.map(seg => {
    const lane: 0 | 1 = seg.startMin >= laneEnd[0] ? 0 : 1
    laneEnd[lane] = Math.max(laneEnd[lane], seg.endMin)
    return { ...seg, lane }
  })
  return { lanes: items.some(i => i.lane === 1) ? 2 : 1, items }
}

/** Minutes covered by a set of intervals, overlaps counted once. */
function unionMinutes(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let curStart = -Infinity
  let curEnd = -Infinity
  for (const [a, b] of sorted) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart
      curStart = a
      curEnd = b
    } else if (b > curEnd) {
      curEnd = b
    }
  }
  if (curEnd > curStart) total += curEnd - curStart
  return total
}

/**
 * Totals for the legend and the row ends. Wall-clock time: two sessions at
 * once count once, both within a key (two building sessions in parallel) and
 * for the day as a whole. So keys can add up to more than the days — the same
 * hour can be building *and* thinking — and the legend says what each kind
 * took, not a partition of the day.
 */
export function timeOfDayTotalsBlock(
  segmentsByDay: ReadonlyMap<string, readonly TimeOfDaySegmentBlock[]>,
  keyOf: (project: string) => string,
): { byKey: Map<string, number>; byDay: Map<string, number> } {
  const byKey = new Map<string, number>()
  const byDay = new Map<string, number>()
  for (const [day, segments] of segmentsByDay) {
    byDay.set(day, unionMinutes(segments.map(s => [s.startMin, s.endMin])))
    const perKey = new Map<string, Array<[number, number]>>()
    for (const s of segments) {
      const key = keyOf(s.project)
      const list = perKey.get(key) ?? []
      list.push([s.startMin, s.endMin])
      perKey.set(key, list)
    }
    for (const [key, list] of perKey) byKey.set(key, (byKey.get(key) ?? 0) + unionMinutes(list))
  }
  return { byKey, byDay }
}
