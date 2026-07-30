import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useWakeListBlock } from '@/components/lego_blocks/hooks/units/useWakeListBlock'
import type { Ask } from '@/services/lego_blocks/units/aiActivityAskBlock'

// A Home card: the open-questions wake list. Asks from the old organizer that no
// undertaking has discharged — questions posed and not yet pursued. Project
// chips at the top (same shape as the AI-activity card), open asks grouped by
// category and sorted oldest-first, so the longest-open questions surface. This
// is the forward half of the loop, which is why it lives on Home (open loops)
// rather than the retrospective org tab.

const DAY_MS = 86_400_000

function ageLabel(openedDate: string): string {
  if (!openedDate) return ''
  const opened = Date.parse(openedDate)
  if (Number.isNaN(opened)) return ''
  const days = Math.max(0, Math.floor((Date.now() - opened) / DAY_MS))
  if (days < 45) return `${days}d`
  const months = days / 30.4
  return `${months.toFixed(months < 10 ? 1 : 0)} mo`
}

export default function WakeListBlock() {
  const { projects, selected, select, asks, loadingProjects, loadingAsks, error } = useWakeListBlock()

  const grouped = useMemo(() => {
    if (!asks) return []
    const byCat = new Map<string, Ask[]>()
    for (const ask of asks.open) {
      const arr = byCat.get(ask.category) ?? []
      arr.push(ask)
      byCat.set(ask.category, arr)
    }
    // Categories ordered by their oldest open ask, so the most-neglected
    // cluster leads.
    return [...byCat.entries()]
      .map(([category, list]) => ({ category, list }))
      .sort((a, b) => (a.list[0]?.openedDate ?? '').localeCompare(b.list[0]?.openedDate ?? ''))
  }, [asks])

  // Nothing to wake on anywhere → render nothing rather than an empty card.
  if (loadingProjects) return null
  if (projects.length === 0) return null

  return (
    <section className="rounded-xl border border-border/40 bg-card/40 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Open questions</h3>
        {asks && (
          <span className="text-[11px] text-muted-foreground/70">
            {asks.dischargedCount} of {asks.totalAsks} answered
          </span>
        )}
      </div>

      {projects.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {projects.map(p => (
            <button
              key={p.projectId}
              type="button"
              onClick={() => select(p.projectId)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                p.projectId === selected
                  ? 'border-border/60 bg-card/70 text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border/40 hover:bg-card/40',
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {loadingAsks && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!loadingAsks && asks && asks.open.length === 0 && (
        <p className="text-xs text-muted-foreground/70">Nothing open — every ask has been answered.</p>
      )}

      {!loadingAsks && grouped.length > 0 && (
        <div className="space-y-3">
          {grouped.map(({ category, list }) => (
            <div key={category}>
              <h4 className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {category}
              </h4>
              <ul className="space-y-0.5">
                {list.map(ask => (
                  <li key={ask.key} className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground/85" title={ask.title}>
                      {ask.title}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                      {ageLabel(ask.openedDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
