import { useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { fmtDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { parseRangeSummaryArcsBlock } from '@/services/lego_blocks/units/rangeSummaryArcsBlock'
import { useProjectRangeSummaryBlock } from '@/components/lego_blocks/hooks/shared/useProjectRangeSummaryBlock'
import LightMarkdownTextBlock from '@/components/lego_blocks/units/LightMarkdownTextBlock'
import { cn } from '@/lib/utils'

// One project in the This Week card, as a glanceable row:
//
//   ● Thinking-Space   ████████████░░░   2h 21m   ▮
//     Vault & agent infrastructure · Thinking Space UI          ›
//
// How much (bar = share of the set), when (one cell per day of the set), and
// what (the range summary's theme titles). The summary paragraphs are the
// detail behind the chevron. Until the summary lands — or when it is the
// rules-based fallback, which has no themes — the "what" line is the sessions'
// own titles, so a row never reads "Generating…".

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WHAT_TITLE_LIMIT = 4

function isoDayLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtIsoDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${MONTH_SHORT[m - 1]} ${d}`
}

function chainMs(c: ActivityChain): number {
  return Math.max(0, Date.parse(c.endedIso) - Date.parse(c.startedIso))
}

interface Props {
  projectId: string
  label: string
  /** Project colour (stroke). */
  color: string
  durationMs: number
  /** The set's total, for the bar's share. */
  sectionMs: number
  /** Every local date in the set, oldest first — one day cell each. */
  days: string[]
  chains: ActivityChain[]
  rangeStartDate: string
  rangeEndDate: string
}

export default function ProjectWorkRowBlock({
  projectId,
  label,
  color,
  durationMs,
  sectionMs,
  days,
  chains,
  rangeStartDate,
  rangeEndDate,
}: Props) {
  const [open, setOpen] = useState(false)
  const { summary, loading, error } = useProjectRangeSummaryBlock({
    projectId,
    projectLabel: label,
    rangeStartDate,
    rangeEndDate,
    chains,
  })
  const parsed = useMemo(() => parseRangeSummaryArcsBlock(summary?.summary ?? ''), [summary])
  const hasArcs = parsed.arcs.length > 0

  // Longest first; a title shared by several windows of one session shows once.
  const sessions = useMemo(() => {
    const byTitle = new Map<string, { title: string; ms: number; day: string }>()
    for (const c of chains) {
      const title = c.topic || '(untitled session)'
      const prev = byTitle.get(title)
      if (prev) prev.ms += chainMs(c)
      else byTitle.set(title, { title, ms: chainMs(c), day: isoDayLocal(c.startedIso) })
    }
    return [...byTitle.values()].sort((a, b) => b.ms - a.ms)
  }, [chains])

  const dayMs = useMemo(() => {
    const out = new Map<string, number>()
    for (const c of chains) {
      const day = isoDayLocal(c.startedIso)
      out.set(day, (out.get(day) ?? 0) + chainMs(c))
    }
    return out
  }, [chains])
  const maxDayMs = Math.max(1, ...dayMs.values())

  const whatTitles = hasArcs ? parsed.arcs.map(a => a.title) : sessions.map(s => s.title)
  const whatMore = whatTitles.length - WHAT_TITLE_LIMIT
  const share = sectionMs > 0 ? Math.min(1, durationMs / sectionMs) : 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="group -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <div className="flex items-center gap-3">
          <span className="flex w-36 shrink-0 items-center gap-2 truncate text-[12px] font-medium" style={{ color }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{label}</span>
          </span>
          <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.max(share * 100, 1.5)}%`, background: color, opacity: 0.8 }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-foreground/80">
            {fmtDurationMsBlock(durationMs)}
          </span>
          <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
            {days.map(day => {
              const ms = dayMs.get(day) ?? 0
              return (
                <span
                  key={day}
                  title={`${fmtIsoDay(day)} · ${ms > 0 ? fmtDurationMsBlock(ms) : 'nothing'}`}
                  className={cn('h-2.5 w-1.5 rounded-[2px]', ms === 0 && 'border border-foreground/15')}
                  style={ms > 0 ? { background: color, opacity: 0.3 + 0.7 * (ms / maxDayMs) } : undefined}
                />
              )
            })}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-3.5">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[11px]',
              hasArcs ? 'text-foreground/70' : 'text-muted-foreground/70',
            )}
          >
            {whatTitles.slice(0, WHAT_TITLE_LIMIT).join(' · ')}
            {whatMore > 0 && <span className="text-muted-foreground/50"> · +{whatMore}</span>}
          </span>
          {loading && !summary && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/50" aria-label="Summarizing" />
          )}
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground',
              open && 'rotate-90',
            )}
          />
        </div>
      </button>

      {open && (
        <div className="mb-2 mt-1 space-y-3 pl-3.5">
          {error && <p className="text-[11px] text-destructive">Summary failed: {error}</p>}
          {hasArcs ? (
            <>
              {parsed.arcs.map(arc => (
                <div key={arc.title}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-medium text-foreground/85">{arc.title}</span>
                    {arc.meta && (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{arc.meta}</span>
                    )}
                  </div>
                  {arc.body && (
                    <LightMarkdownTextBlock
                      text={arc.body}
                      className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground"
                    />
                  )}
                </div>
              ))}
              {parsed.extras.length > 0 && (
                <div className="space-y-0.5 border-t border-border/30 pt-2">
                  {parsed.extras.map(extra => (
                    <LightMarkdownTextBlock
                      key={extra}
                      text={extra}
                      className="text-[11px] leading-relaxed text-muted-foreground/80"
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1">
              {sessions.map(s => (
                <div key={s.title} className="flex items-baseline gap-3 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-foreground/75">{s.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/60">{fmtIsoDay(s.day)}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground/80">
                    {fmtDurationMsBlock(s.ms)}
                  </span>
                </div>
              ))}
              {loading && <p className="pt-1 text-[10px] text-muted-foreground/60">Summarizing…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
