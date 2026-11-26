import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { useWheelScrollCaptureBlock } from '@/components/lego_blocks/hooks/shared/useWheelScrollCaptureBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { useVisibleIntervalBlock } from '@/components/lego_blocks/hooks/shared/useVisibleIntervalBlock'

interface AiActivityDayTimelineBlockProps {
  /** ISO day this timeline represents (anchor for the 00:00 baseline). */
  dateIso: string
  /** Chains belonging to that day (caller-filtered, already includes overnight tail). */
  chains: ActivityChain[]
  /** When set, non-matching pills dim so the active project's pills pop. */
  highlightProject?: string | null
  /** Narrow host (a phone page): show only the hours that have sessions, an
   *  hour of margin either side, and let an hour shrink below the usual floor
   *  so the day fits the width instead of scrolling. */
  fitActive?: boolean
  /** Permission approvals to mark on the strip — the person's presence inside
   *  agent work. Ticks only; they add no length to anything. */
  touchIsos?: string[]
}

/** Floor for an hour's width. The strip stretches its hours to fill the card,
 *  so this only bites on a card too narrow for that — where it scrolls. */
const MIN_PIXELS_PER_HOUR = 32
/** The floor when fitting a phone: low enough that a long day still fits a
 *  ~350px strip without scrolling. Hour labels thin out to stay legible. */
const MIN_PIXELS_PER_HOUR_FIT = 12
/** Narrowest slot an hour label can sit in without touching its neighbour. */
const HOUR_LABEL_MIN_PX = 26
const ROW_HEIGHT = 16
/* Gap between the strip and the hour labels on the strip that shows "now":
   room for the now dot to sit below the pills instead of on them. */
const NOW_GAP_PX = 14
const ROW_GAP = 3
const MIN_PILL_PX = 8
const PILL_DEFAULT_DURATION_MIN = 15
// Slack: chains within this many pixels (~15 min) can share a row even if
// their bounding boxes technically overlap. Stops a flurry of short sessions
// from exploding the strip vertically.
const ROW_PACK_SLACK_PX = 14
function fmtHour(h: number): string {
  // h may exceed 24 for overnight tail — wrap to 0-23 for display.
  const display = ((h % 24) + 24) % 24
  const suffix = display < 12 ? 'a' : 'p'
  const hour12 = display % 12 === 0 ? 12 : display % 12
  return `${hour12}${suffix}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

/**
 * Project chains onto a horizontal time strip for a single day. The strip
 * covers from earliest 00:00 (or first chain if it starts before 00:00 of the
 * selected day — shouldn't happen) up to 06:00 of the next day so overnight
 * sessions stay on the same row.
 */
export default function AiActivityDayTimelineBlock({
  dateIso,
  chains,
  touchIsos,
  highlightProject = null,
  fitActive = false,
}: AiActivityDayTimelineBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [hoverId, setHoverId] = useState<string | null>(null)

  const dayStartMs = useMemo(
    () => Date.parse(dateIso + 'T00:00:00'),
    [dateIso],
  )

  // Now marker, whenever "now" falls on this strip — today, and also
  // yesterday's strip after midnight, which runs on to 06:00 (it used to be
  // today-only, so at 1:40am yesterday's strip showed no marker). Ticks once
  // a minute only while visible and in range (ENERGY: no unconditional
  // timers); any other day holds no interval at all.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const nowHour = (nowMs - dayStartMs) / 3_600_000
  const nowOnStrip = nowHour >= 0 && nowHour < 30
  useVisibleIntervalBlock(() => setNowMs(Date.now()), nowOnStrip ? 60_000 : null)

  // Collapse overlapping same-project chains into a single visual pill so two
  // parallel sessions (different terminals, same cwd) read as one block of
  // work on the strip. The drill table below still surfaces each underlying
  // chain on its own row — the timeline is the only place we merge.
  type MergedPill = {
    key: string
    project: string
    startedIso: string
    endedIso: string
    chains: ActivityChain[]
    msgCount: number
    topic: string
    /** Agents' work: drawn hatched, never merged with the person's pills. */
    agent: boolean
    /** Agent waits from the pill's sessions — drawn as a dotted tail, never as
     *  a filled bar, because waiting is not working. */
    waits: Array<{ startMs: number; endMs: number; label: string }>
  }
  const pills = useMemo<MergedPill[]>(() => {
    if (chains.length === 0) return []
    // Merge key includes the actor: a person's pill and an agent's pill for the
    // same project overlap all the time and must stay two pills.
    const byProject = new Map<string, ActivityChain[]>()
    for (const c of chains) {
      const k = c.actor === 'agent' ? `${c.project}\u0000agent` : c.project
      const arr = byProject.get(k) ?? []
      arr.push(c)
      byProject.set(k, arr)
    }
    const out: MergedPill[] = []
    for (const [groupKey, list] of byProject) {
      const project = list[0].project
      const agent = list[0].actor === 'agent'
      const sorted = [...list].sort(
        (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
      )
      let cur: { startMs: number; endMs: number; chains: ActivityChain[] } | null = null
      const flush = () => {
        if (!cur) return
        const first = cur.chains[0]
        const msgCount = cur.chains.reduce((n, c) => n + c.msgCount, 0)
        const waits = cur.chains.flatMap(c =>
          c.sessions.flatMap(s =>
            (s.waits ?? []).map(w => ({ startMs: Date.parse(w.startIso), endMs: Date.parse(w.endIso), label: w.label })),
          ),
        )
        out.push({
          key: `${groupKey}::${cur.startMs}::${cur.chains.length}`,
          project,
          agent,
          waits,
          startedIso: new Date(cur.startMs).toISOString(),
          endedIso: new Date(cur.endMs).toISOString(),
          chains: cur.chains,
          msgCount,
          topic:
            cur.chains.length === 1
              ? first.topic
              : `${cur.chains.length} parallel sessions · ${first.topic}`,
        })
      }
      for (const c of sorted) {
        const s = Date.parse(c.startedIso)
        const e = Date.parse(c.endedIso)
        if (cur && s < cur.endMs) {
          cur.chains.push(c)
          if (e > cur.endMs) cur.endMs = e
        } else {
          flush()
          cur = { startMs: s, endMs: e, chains: [c] }
        }
      }
      flush()
    }
    return out
  }, [chains])

  // Compute axis: start at hour 0; end at the later of 24 and the latest
  // pill-end hour (rounded up), capped at 30 to avoid runaway widths.
  const { startHour, endHour } = useMemo(() => {
    if (pills.length === 0) return { startHour: 0, endHour: 24 }
    let latestHourFractional = 24
    for (const p of pills) {
      const startedH = (Date.parse(p.startedIso) - dayStartMs) / 3_600_000
      const endedH = (Date.parse(p.endedIso) - dayStartMs) / 3_600_000
      const lastTouched = Math.max(startedH, endedH) + PILL_DEFAULT_DURATION_MIN / 60
      if (lastTouched > latestHourFractional) latestHourFractional = lastTouched
    }
    // Reaches "now" too, so the marker always has a place on the strip.
    const end = Math.min(30, Math.ceil(Math.max(latestHourFractional, nowOnStrip ? nowHour + 0.25 : 0)))
    if (!fitActive) return { startHour: 0, endHour: end }
    let first = 24
    let last = 0
    for (const p of pills) {
      const startedH = (Date.parse(p.startedIso) - dayStartMs) / 3_600_000
      const endedH = (Date.parse(p.endedIso) - dayStartMs) / 3_600_000
      first = Math.min(first, startedH)
      last = Math.max(last, startedH + PILL_DEFAULT_DURATION_MIN / 60, endedH)
    }
    return {
      startHour: Math.max(0, Math.floor(first) - 1),
      endHour: Math.min(end, Math.ceil(last) + 1),
    }
  }, [pills, dayStartMs, fitActive, nowOnStrip, nowHour])

  // An hour is as wide as the card allows: the day spans the full width, so
  // the timeline's right edge lands where the day row's and the legend's do
  // instead of stopping wherever 32px × 24 happened to end. Measured from the
  // scroll wrapper; until that has a width, the floor.
  const [wrapWidth, setWrapWidth] = useState(0)
  const pxPerHour = Math.max(
    fitActive ? MIN_PIXELS_PER_HOUR_FIT : MIN_PIXELS_PER_HOUR,
    wrapWidth / (endHour - startHour),
  )
  // Label every hour while there is room, then every 2nd, 3rd… so they never
  // run into each other on a squeezed strip.
  const labelStep = Math.max(1, Math.ceil(HOUR_LABEL_MIN_PX / pxPerHour))
  const widthPx = (endHour - startHour) * pxPerHour
  const hourTicks = useMemo(() => {
    const out: number[] = []
    for (let h = startHour; h <= endHour; h += 1) out.push(h)
    return out
  }, [startHour, endHour])

  // Lay pills out in rows; pack greedily so overlapping pills (different
  // projects, since same-project overlaps are already merged into one pill)
  // stack vertically.
  const placed = useMemo(() => {
    type Placed = {
      key: string
      pill: MergedPill
      leftPx: number
      widthPx: number
      row: number
    }
    const sorted = [...pills].sort(
      (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
    )
    const rowEnds: number[] = []
    const out: Placed[] = []
    for (const c of sorted) {
      const rawStartedH = (Date.parse(c.startedIso) - dayStartMs) / 3_600_000
      let rawEndedH = (Date.parse(c.endedIso) - dayStartMs) / 3_600_000
      if (rawEndedH < rawStartedH + PILL_DEFAULT_DURATION_MIN / 60) {
        rawEndedH = rawStartedH + PILL_DEFAULT_DURATION_MIN / 60
      }
      // Clamp the visible portion to the strip window. A session that started
      // before the selected day (long-running multi-day session) gets its left
      // edge pinned to the day's 0h; one that runs past the strip's end gets
      // its right edge pinned to endHour. Tooltip still shows the real times.
      const startedH = Math.max(rawStartedH, startHour)
      const endedH = Math.min(rawEndedH, endHour)
      if (endedH <= startedH) continue // entirely outside the visible window
      const leftPx = (startedH - startHour) * pxPerHour
      const widthPx = Math.max(MIN_PILL_PX, (endedH - startedH) * pxPerHour)
      // A wait's dotted tail shares the pill's row, so the row is reserved to
      // the end of the latest wait — otherwise a later pill packs on top of it.
      const waitEndH = c.waits.reduce(
        (m, w) => Math.max(m, Math.min((w.endMs - dayStartMs) / 3_600_000, endHour)),
        0,
      )
      const extentPx = Math.max(leftPx + widthPx, (waitEndH - startHour) * pxPerHour)
      let row = rowEnds.findIndex(end => end <= leftPx + ROW_PACK_SLACK_PX)
      if (row === -1) {
        row = rowEnds.length
        rowEnds.push(0)
      }
      rowEnds[row] = extentPx
      out.push({ key: c.key, pill: c, leftPx, widthPx, row })
    }
    return { placed: out, rows: rowEnds.length }
  }, [pills, dayStartMs, startHour, endHour, pxPerHour])

  const stripHeight = placed.rows * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
  const showNow = nowOnStrip && nowHour >= startHour && nowHour <= endHour

  // Horizontal-overflow affordances: chevrons + edge fades appear when there's
  // offscreen content. macOS overlay scrollbars hide the default affordance,
  // so without these the user has no idea more timeline exists to the right.
  const scrollWrapRef = useRef<HTMLDivElement | null>(null)
  // Trackpad scroll over the timeline scrolls it in place instead of panning the
  // canvas underneath; releases to the canvas once scrolled to either end.
  useWheelScrollCaptureBlock(scrollWrapRef, 'x')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollWrapRef.current
    if (!el) return
    const update = () => {
      setWrapWidth(el.clientWidth)
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [widthPx, chains.length])

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollWrapRef.current
    if (!el) return
    const delta = el.clientWidth * 0.5 * (direction === 'left' ? -1 : 1)
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  // Below every hook, not above them. This return used to sit before the
  // scroll-affordance hooks, so a day crossing between "has sessions" and
  // "none" changed how many hooks this component called between two renders —
  // which is the one thing React cannot tolerate, and which shows up later as
  // "rendered fewer hooks than expected" or as state landing on the wrong
  // component. The hooks are inert on an empty day anyway: the ref is null, so
  // the effect returns immediately and observes nothing.
  if (chains.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground/70">
        No sessions on this day.
      </div>
    )
  }

  return (
    <div ref={hostRef} className="relative">
    {/* Horizontal only. `overflow-x-auto` alone does not mean the other axis
        stays put: CSS promotes a `visible` axis to `auto` as soon as its
        partner is not visible, so the wrapper was quietly scrollable up and
        down too — on a touch screen that reads as the timeline sliding under
        your finger when you meant to scroll the page. Hidden on y pins it and
        lets the vertical swipe fall through to the page, and
        overscroll-x-contain stops a horizontal fling from chaining out to
        whatever is behind the card. */}
    <div
      ref={scrollWrapRef}
      className="ltm-hscroll-bare overflow-x-auto overflow-y-hidden"
    >
      <div className="relative" style={{ width: Math.max(widthPx, 320) }}>
        {/* Hour grid + pills. The strip has no height cap and never scrolls
            vertically: a busy day makes it taller and the card grows with it,
            which is the panel's whole layout contract. It used to cap at 440px
            and scroll internally, which put a second, silent scroll axis inside
            a view whose only real axis is time. */}
        <div className="relative">
        <div className="relative" style={{ height: stripHeight }}>
          {hourTicks.map((h, i) => {
            const isLast = i === hourTicks.length - 1
            // The closing line sits just inside the strip's right edge — at
            // the edge itself it would be clipped — and stays as faint as the
            // opening one, so the day reads as bracketed, not underlined.
            const x = (h - startHour) * pxPerHour - (isLast ? 1 : 0)
            const isMidnight = h % 24 === 0 && h !== 0 && !isLast
            return (
              <div
                key={h}
                className="absolute top-0 bottom-0"
                style={{
                  left: x,
                  width: 1,
                  background: isMidnight
                    ? 'rgba(148,163,184,0.35)'
                    : 'rgba(148,163,184,0.10)',
                }}
              />
            )
          })}

          {showNow && (
            <div
              aria-label="Now"
              // Above the pills (they lift to z-10 on hover): under them the
              // line vanished into a running session. It runs on into the gap
              // below the strip and the dot sits in the middle of that gap,
              // clear of the pills above and the hour labels below.
              className="pointer-events-none absolute top-0 z-20"
              style={{ left: (nowHour - startHour) * pxPerHour - 0.75, width: 1.5, bottom: -NOW_GAP_PX / 2 }}
            >
              {/* The Explorer's selection colour, so "now" and "selected"
                  speak the same accent across the app; a hairline of the
                  background around it keeps it legible on top of a pill. */}
              <div
                className="h-full w-full bg-[var(--ltm-explorer-selected-color,#c73773)]"
                style={{ boxShadow: '0 0 0 1px hsl(var(--background) / 0.55)' }}
              />
              <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--ltm-explorer-selected-color,#c73773)]" />
            </div>
          )}

          {placed.placed.map(({ key, pill, leftPx, widthPx, row }) => {
            const color = getProjectColor(pill.project, isDark)
            const isHover = hoverId === key
            const isHighlighted = highlightProject != null && pill.project === highlightProject
            const isDimmed = highlightProject != null && !isHighlighted
            // Pills use the project's chipBg as a soft fill with NO border —
            // borders were reading as dark outlines that fought the color
            // language. Hover/highlight states use a project-tinted ring so the
            // chrome stays in the same hue family as the pill itself.
            const ringStyle = (isHighlighted || isHover) ? color.stroke : undefined
            return (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setHoverId(key)}
                onMouseLeave={() => setHoverId(h => (h === key ? null : h))}
                className={cn(
                  'absolute overflow-hidden rounded-md transition-all',
                  (isHover || isHighlighted) && 'z-10 shadow-sm',
                  isDimmed && 'opacity-30',
                )}
                style={{
                  left: leftPx,
                  width: widthPx,
                  top: row * (ROW_HEIGHT + ROW_GAP),
                  height: ROW_HEIGHT,
                  // Use the project's `fill` (≈45% alpha) instead of `chipBg`
                  // (≈15%) — chipBg was too faint to read at small pill sizes.
                  // Agents' work is hatched: same hue, so the project still
                  // reads, but never mistakable for the person's own time.
                  background: pill.agent
                    ? `repeating-linear-gradient(135deg, ${color.fill} 0 4px, transparent 4px 7px)`
                    : color.fill,
                  boxShadow: ringStyle
                    ? `inset 0 0 0 1.5px ${ringStyle}`
                    : undefined,
                }}
                title={`${pill.agent ? 'Agents · ' : ''}${fmtTime(pill.startedIso)}–${fmtTime(pill.endedIso)} · ${projectLabelBlock(pill.project)} · ${pill.msgCount} msgs — ${pill.topic}`}
                aria-label={`${projectLabelBlock(pill.project)} · ${pill.msgCount} msgs at ${fmtTime(pill.startedIso)}`}
              />
            )
          })}

          {/* Waits: a dotted line on the agent pill's row from when it went
              idle to when what it was waiting on came back. Drawn, not
              counted — no total anywhere includes these. */}
          {placed.placed.flatMap(({ key, pill, row }) =>
            pill.waits.map((w, i) => {
              const sH = Math.max((w.startMs - dayStartMs) / 3_600_000, startHour)
              const eH = Math.min((w.endMs - dayStartMs) / 3_600_000, endHour)
              if (eH <= sH) return null
              const color = getProjectColor(pill.project, isDark)
              return (
                <div
                  key={`${key}::wait::${i}`}
                  className="pointer-events-auto absolute"
                  style={{
                    left: (sH - startHour) * pxPerHour,
                    width: (eH - sH) * pxPerHour,
                    top: row * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2 - 1,
                    height: 2,
                    backgroundImage: `repeating-linear-gradient(90deg, ${color.stroke} 0 2px, transparent 2px 5px)`,
                    opacity: 0.55,
                  }}
                  title={`${fmtTime(new Date(w.startMs).toISOString())}–${fmtTime(new Date(w.endMs).toISOString())} · ${w.label}`}
                />
              )
            }),
          )}

          {/* Touches: the person approving a prompt inside agent work. */}
          {(touchIsos ?? []).map((iso, i) => {
            const h = (Date.parse(iso) - dayStartMs) / 3_600_000
            if (h < startHour || h > endHour) return null
            return (
              <div
                key={`touch::${i}`}
                className="absolute w-[2px] rounded-full bg-foreground/55"
                style={{ left: (h - startHour) * pxPerHour - 1, bottom: -5, height: 5 }}
                title={`You approved a prompt at ${fmtTime(iso)}`}
              />
            )
          })}
        </div>
        </div>

        {/* Hour axis labels — outside the scrollable strip so they're always visible. */}
        <div className="relative" style={{ height: 12, marginTop: showNow ? NOW_GAP_PX : 4 }}>
          {hourTicks.map((h, i) => {
            if (i % labelStep !== 0) return null
            const x = (h - startHour) * pxPerHour
            const isMidnight = h % 24 === 0 && h !== 0
            return (
              <div
                key={h}
                className={cn(
                  'absolute text-[9px] tabular-nums',
                  // The end labels hang inward. Centred on their ticks, half of
                  // each sat outside the strip and the scroller cut it off —
                  // the first one read "2a".
                  i === 0
                    ? 'translate-x-0'
                    : i === hourTicks.length - 1
                      ? '-translate-x-full'
                      : '-translate-x-1/2',
                  isMidnight ? 'font-semibold text-foreground/70' : 'text-muted-foreground/70',
                )}
                style={{ left: x }}
              >
                {fmtHour(h)}
              </div>
            )
          })}
        </div>
      </div>
    </div>

    {/* Edge fades hint at offscreen content; pointer-events-none so they don't
        block clicks on pills underneath. */}
    {canScrollLeft && (
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background/95 to-transparent"
        aria-hidden
      />
    )}
    {canScrollRight && (
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background/95 to-transparent"
        aria-hidden
      />
    )}

    {/* Chevron nav — anchored to the bottom corners so they sit on the hour
        axis row instead of overlapping pills in the strip. Smaller + softer
        than before to disappear visually when not needed. */}
    {canScrollLeft && (
      <button
        type="button"
        onClick={() => scrollBy('left')}
        className="absolute bottom-0 left-0 z-20 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground shadow-sm transition-colors hover:border-border/60 hover:text-foreground"
        aria-label="Scroll timeline earlier"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
    )}
    {canScrollRight && (
      <button
        type="button"
        onClick={() => scrollBy('right')}
        className="absolute bottom-0 right-0 z-20 rounded-full border border-border/30 bg-background/85 p-0.5 text-muted-foreground shadow-sm transition-colors hover:border-border/60 hover:text-foreground"
        aria-label="Scroll timeline later"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    )}
    </div>
  )
}
