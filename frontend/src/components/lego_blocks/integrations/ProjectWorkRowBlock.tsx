import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { fmtDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { parseRangeSummaryArcsBlock } from '@/services/lego_blocks/units/rangeSummaryArcsBlock'
import { useProjectRangeSummaryBlock } from '@/components/lego_blocks/hooks/shared/useProjectRangeSummaryBlock'
import { useProjectJobRunningBlock } from '@/components/lego_blocks/hooks/shared/useProjectJobRunningBlock'
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

/** A fallback topic that names nothing: a slash-command label (`[/resume]`) or
 *  captured command output (`<local-command-stdout>…`). Kept off the "what"
 *  line; the session still counts and still appears in the expanded list. */
function isPlaceholderTitle(title: string): boolean {
  const t = title.trim()
  return (t.startsWith('[') && t.endsWith(']')) || t.startsWith('<') || t.startsWith('(')
}

function fmtPct(fraction: number): string {
  const pct = fraction * 100
  if (pct > 0 && pct < 1) return '<1%'
  return `${Math.round(pct)}%`
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
  // Only the row whose job the model is on right now; waiting rows stay still.
  const working = useProjectJobRunningBlock(projectId, rangeStartDate, rangeEndDate, loading)

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

  // Session shares are of the sessions' own sum, not the project's merged
  // duration: parallel sessions overlap on the clock, so wall-clock times can
  // add up to more than the project and percentages of it would pass 100.
  const sessionMsSum = sessions.reduce((n, s) => n + s.ms, 0)
  const whatRows: Array<{ title: string; meta?: string; dur?: string; pct?: string; body?: string }> = hasArcs
    ? parsed.arcs.map(a => ({ title: a.title, meta: a.meta, body: a.body }))
    : sessions
        .filter(s => !isPlaceholderTitle(s.title))
        .map(s => ({
          title: s.title,
          dur: fmtDurationMsBlock(s.ms),
          pct: sessionMsSum > 0 ? fmtPct(s.ms / sessionMsSum) : undefined,
        }))
  const shownRows = open ? whatRows : whatRows.slice(0, WHAT_TITLE_LIMIT)
  const whatMore = whatRows.length - shownRows.length
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
            {working ? (
              <span
                aria-label="Summarizing"
                title="Summarizing now"
                className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-t-transparent motion-safe:animate-spin"
                style={{ borderColor: color, borderTopColor: 'transparent' }}
              />
            ) : hasArcs ? (
              <span
                title="Summary available"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: color }}
              />
            ) : (
              // Hollow = no summary yet (or only the rules-based fallback):
              // the lines below are session titles, not themes.
              <span
                title={loading ? 'Waiting to be summarized' : 'No summary — showing session titles'}
                className="h-2 w-2 shrink-0 rounded-full border-[1.5px]"
                style={{ borderColor: color }}
              />
            )}
            <span className="truncate">{label}</span>
          </span>
          {/* Fixed short track: the bar shows share, and a share reads at a glance
              in 10rem. Stretched across the row it was mostly empty grey. */}
          <span className="relative h-1.5 w-40 shrink-0">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.max(share * 100, 1.5)}%`, background: color, opacity: 0.8 }}
            />
          </span>
          <span className="flex-1" />
          {/* Fixed slot (room for a week), right-aligned against the time: the cell
              count changes per set, and a variable width pushed the time column
              around. Topic rows reserve the same slot. */}
          <span className="flex w-[60px] shrink-0 items-center justify-end gap-[3px]" aria-hidden>
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
          <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-foreground/80">
            {fmtDurationMsBlock(durationMs)}
          </span>
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
            {fmtPct(share)}
          </span>
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground',
              open && 'rotate-90',
            )}
          />
        </div>
        {whatRows.length > 0 && (
          <div className="mt-2 space-y-1 pl-3.5">
            {/* One topic per line, with room to read it. Settled themes carry the
                summary's own meta; session titles still waiting on the summary
                are dimmed and carry their measured duration. */}
            {shownRows.map(row => (
              <div key={row.title}>
                <div className="flex items-baseline gap-3">
                  <span className="mt-[7px] h-1 w-1 shrink-0 self-start rounded-full bg-foreground/25" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px] leading-6',
                      hasArcs ? 'text-foreground/85' : 'text-muted-foreground',
                    )}
                  >
                    {row.title}
                  </span>
                  {/* Same fixed columns as the project line above (time, %, chevron),
                      so every number in the card sits in one of two columns. A
                      theme's meta line ends where the times end. */}
                  {row.meta ? (
                    <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
                      {row.meta}
                    </span>
                  ) : (
                    <>
                      <span className="w-[60px] shrink-0" aria-hidden />
                      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
                        {row.dur}
                      </span>
                    </>
                  )}
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/50">
                    {row.pct}
                  </span>
                  <span className="w-3.5 shrink-0" aria-hidden />
                </div>
                {open && row.body && (
                  <LightMarkdownTextBlock
                    text={row.body}
                    className="mb-2 pl-4 text-[12px] leading-relaxed text-muted-foreground"
                  />
                )}
              </div>
            ))}
            {whatMore > 0 && (
              <div className="pl-4 text-[11px] text-muted-foreground/60">+{whatMore} more</div>
            )}
          </div>
        )}
      </button>

      {open && (error || parsed.extras.length > 0 || (loading && !hasArcs)) && (
        <div className="mb-2 mt-1 space-y-1 pl-3.5">
          {error && <p className="text-[11px] text-destructive">Summary failed: {error}</p>}
          {parsed.extras.length > 0 && (
            <div className="space-y-0.5 border-t border-border/30 pt-2">
              {parsed.extras.map(extra => (
                <LightMarkdownTextBlock
                  key={extra}
                  text={extra}
                  className="text-[12px] leading-relaxed text-muted-foreground/80"
                />
              ))}
            </div>
          )}
          {loading && !hasArcs && <p className="pl-4 text-[11px] text-muted-foreground/60">Summarizing…</p>}
        </div>
      )}
    </div>
  )
}
