import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useWakeListBlock } from '@/components/lego_blocks/hooks/units/useWakeListBlock'
import { noteAgeLabelBlock } from '@/services/lego_blocks/units/noteAgeBlock'
import type { CanvasThemeTokens } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

// A quick Home card: the open questions — Questions-to-research (QT) tasks from
// the old organizer that no undertaking has answered, oldest first. A lean
// glance ("what did I wonder and never look into"), not the full wake list —
// that lives in the organizer index, across every task kind. Project chips at
// the top when more than one project has open questions.
//
// It brings its own panel chrome (rather than being wrapped in FlatPanel) so it
// can return null and vanish when there's nothing open — but it uses the same
// theme tokens FlatPanel does, so it reads as one of the Home cards.

interface Props {
  theme: CanvasThemeTokens
}


export default function WakeListBlock({ theme }: Props) {
  const { projects, selected, select, tasks, loadingProjects, loadingTasks, error } = useWakeListBlock()

  // Just the open Questions, oldest first.
  const questions = useMemo(
    () =>
      (tasks?.open ?? [])
        .filter(n => n.categoryCode === 'QT')
        .sort((a, b) => (a.openedDate || '').localeCompare(b.openedDate || '')),
    [tasks],
  )

  // A quick card: nothing to show → show nothing, no empty shell.
  if (loadingProjects) return null
  if (projects.length === 0) return null
  if (!loadingTasks && !error && questions.length === 0) return null

  return (
    <section
      style={{
        borderRadius: 14,
        padding: 20,
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: theme.anchorPanelShadow,
      }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Open questions</h3>
        {questions.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground/70">{questions.length}</span>
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
      {loadingTasks && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!loadingTasks && questions.length > 0 && (
        <ul className="space-y-0.5">
          {questions.map(q => (
            <li key={q.key} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground/85" title={q.title}>
                {q.title}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                {noteAgeLabelBlock(q.openedDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
