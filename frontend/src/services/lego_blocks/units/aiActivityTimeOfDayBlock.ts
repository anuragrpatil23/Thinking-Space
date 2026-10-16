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
