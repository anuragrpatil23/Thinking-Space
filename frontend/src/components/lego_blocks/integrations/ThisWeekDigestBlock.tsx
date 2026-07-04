import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useAiActivityBlock } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import {
  fmtDurationMsBlock,
  mergedDurationMsBlock,
  projectDigestBlock,
} from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import {
  AI_ACTIVITY_SET_MODE_EVENT,
  getAiActivitySetMode,
} from '@/services/lego_blocks/units/storageKeyBlock'

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMonthDay(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

export default function ThisWeekDigestBlock() {
  // 30d covers both the current week and the last two 3-day sets (max reach
  // back is ~6 days). The card filters down to its own window itself, so the
  // preset only needs to be wide enough.
  const activity = useAiActivityBlock('30d')

  const [setMode, setSetMode] = useState<boolean>(() => getAiActivitySetMode())
  useEffect(() => {
    const onChange = () => setSetMode(getAiActivitySetMode())
    window.addEventListener(AI_ACTIVITY_SET_MODE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(AI_ACTIVITY_SET_MODE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  // Default (week) mode: a single Monday-to-now window. Set mode: two
  // separate windows — the current set (start-of-set → now) and the
  // previous set (its full 1-3 day span, ending the day before the current
  // set begins). Both use month-anchored set boundaries.
  const windows = useMemo(() => {
    const now = new Date()
    if (!setMode) {
      const start = mondayOf(now)
      return [
        {
          key: 'week',
          heading: 'This week',
          label: `${fmtMonthDay(start)} – ${fmtMonthDay(now)}`,
          startMs: start.getTime(),
          endMs: now.getTime(),
        },
      ]
    }
    // Current set: month-anchored 3-day window containing today.
    const day = now.getDate()
    const currentSetNum = Math.floor((day - 1) / 3) + 1
    const currentStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      3 * (currentSetNum - 1) + 1,
    )
    currentStart.setHours(0, 0, 0, 0)

    // Previous set: either previous set of same month, or last set of the
    // previous month if we're currently on set 1.
    let prevYear = now.getFullYear()
    let prevMonth = now.getMonth()
    let prevSetNum: number
    if (currentSetNum > 1) {
      prevSetNum = currentSetNum - 1
    } else {
      prevMonth = now.getMonth() - 1
      const prevAnchor = new Date(now.getFullYear(), prevMonth, 1)
      prevYear = prevAnchor.getFullYear()
      prevMonth = prevAnchor.getMonth()
      const prevMonthLen = new Date(prevYear, prevMonth + 1, 0).getDate()
      prevSetNum = Math.ceil(prevMonthLen / 3)
    }
    const prevMonthLen = new Date(prevYear, prevMonth + 1, 0).getDate()
    const prevStartDay = 3 * (prevSetNum - 1) + 1
    const prevEndDay = Math.min(3 * prevSetNum, prevMonthLen)
    const prevStart = new Date(prevYear, prevMonth, prevStartDay)
    prevStart.setHours(0, 0, 0, 0)
    const prevEnd = new Date(prevYear, prevMonth, prevEndDay)
    prevEnd.setHours(23, 59, 59, 999)

    return [
      {
        key: 'current-set',
        heading: 'This set',
        label: `${fmtMonthDay(currentStart)} – ${fmtMonthDay(now)}`,
        startMs: currentStart.getTime(),
        endMs: now.getTime(),
      },
      {
        key: 'prev-set',
        heading: 'Prev set',
        label: `${fmtMonthDay(prevStart)} – ${fmtMonthDay(prevEnd)}`,
        startMs: prevStart.getTime(),
        endMs: prevEnd.getTime(),
      },
    ]
  }, [setMode])

  // For each window: chains (excluding noise buckets), project digest, and
  // a compact summary. Building once per window keeps the render loop clean.
  const sections = useMemo(() => {
    return windows.map(w => {
      const chains = activity.chains.filter(c => {
        if (c.project.startsWith('[') && c.project.endsWith(']')) return false
        const t = Date.parse(c.startedIso)
        return Number.isFinite(t) && t >= w.startMs && t <= w.endMs
      })
      const digest = projectDigestBlock(chains)
      const msgs = chains.reduce((n, c) => n + c.msgCount, 0)
      return {
        ...w,
        digest,
        summary: {
          durLabel: fmtDurationMsBlock(mergedDurationMsBlock(chains)),
          chains: chains.length,
          msgs,
        },
      }
    })
  }, [windows, activity.chains])

  // Header numbers roll up across all windows so the top-line stays a
  // single glance at the current rhythm unit(s).
  const totalSummary = useMemo(() => {
    return sections.reduce(
      (acc, s) => ({
        chains: acc.chains + s.summary.chains,
        msgs: acc.msgs + s.summary.msgs,
      }),
      { chains: 0, msgs: 0 },
    )
  }, [sections])
  const totalDurLabel = useMemo(() => {
    const allChains = activity.chains.filter(c => {
      if (c.project.startsWith('[') && c.project.endsWith(']')) return false
      const t = Date.parse(c.startedIso)
      if (!Number.isFinite(t)) return false
      return sections.some(s => t >= s.startMs && t <= s.endMs)
    })
    return fmtDurationMsBlock(mergedDurationMsBlock(allChains))
  }, [activity.chains, sections])

  // Scroll affordance: the digest list often overflows the card, but the
  // overflow isn't visible without a hint. Track edge positions to show
  // top/bottom chevrons only when there's more content in that direction.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canUp, setCanUp] = useState(false)
  const [canDown, setCanDown] = useState(false)

  const syncScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanUp(el.scrollTop > 4)
    setCanDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }, [])

  useEffect(() => {
    syncScroll()
    const el = scrollRef.current
    if (!el) return
    const obs = new ResizeObserver(syncScroll)
    obs.observe(el)
    return () => obs.disconnect()
  }, [syncScroll, sections])

  const scrollByPage = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {setMode ? 'This set · Prev set' : 'This week'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {setMode ? 'what you worked on with AI' : `${sections[0].label} · what you worked on with AI`}
          </p>
        </div>
        {totalSummary.chains > 0 && (
          <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
            <span>
              <strong className="tabular-nums text-foreground/85">{totalDurLabel}</strong>
            </span>
            <span>
              <strong className="tabular-nums text-foreground/85">{totalSummary.chains}</strong> chains
            </span>
            <span>
              <strong className="tabular-nums text-foreground/85">{totalSummary.msgs.toLocaleString()}</strong> msgs
            </span>
          </div>
        )}
      </div>

      <div className="relative mt-3 flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={syncScroll}
        className="h-full overflow-y-auto rounded-2xl border border-border/40 bg-card/40 p-4 shadow-sm backdrop-blur"
      >
        {activity.loading ? (
          <div className="space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted/20" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/20" />
            <div className="h-4 w-2/5 animate-pulse rounded bg-muted/20" />
          </div>
        ) : totalSummary.chains === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            {setMode ? 'No AI activity in this set or the previous one.' : 'No AI activity yet this week.'}
          </p>
        ) : (
          <div className="space-y-5">
            {sections.map((section, sIdx) => (
              <div key={section.key} className="space-y-2">
                {setMode && (
                  <div
                    className={
                      sIdx > 0
                        ? 'flex items-baseline justify-between gap-3 border-t border-border/30 pt-3'
                        : 'flex items-baseline justify-between gap-3'
                    }
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/80">
                        {section.heading}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{section.label}</span>
                    </div>
                    {section.summary.chains > 0 && (
                      <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
                        <span className="tabular-nums text-foreground/70">{section.summary.durLabel}</span>
                        <span className="tabular-nums">
                          {section.summary.chains} · {section.summary.msgs.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {section.digest.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60">Nothing this window.</p>
                ) : (
                  <div className="space-y-3">
                    {section.digest.map(d => {
                      const color = getProjectColor(d.project)
                      return (
                        <div key={d.project} className="space-y-0.5">
                          <div className="flex items-baseline gap-2 text-[11px]">
                            <span
                              className="inline-flex items-center gap-1.5 font-medium"
                              style={{ color: color.stroke }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: color.stroke }}
                              />
                              {d.project}
                            </span>
                            <span className="tabular-nums text-foreground/70">
                              {fmtDurationMsBlock(d.durationMs)}
                            </span>
                            <span className="tabular-nums text-muted-foreground/60">
                              {d.chains} chain{d.chains === 1 ? '' : 's'} · {d.msgs.toLocaleString()} msgs
                            </span>
                          </div>
                          {d.topics.length > 0 && (
                            <ul className="space-y-0.5 pl-3.5 text-[11px] text-muted-foreground">
                              {d.topics.map((t, i) => (
                                <li key={i} className="truncate" title={t}>
                                  · {t}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canUp && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label="Scroll up"
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
      {canDown && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label="Scroll down"
          className="absolute bottom-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
      </div>
    </div>
  )
}
