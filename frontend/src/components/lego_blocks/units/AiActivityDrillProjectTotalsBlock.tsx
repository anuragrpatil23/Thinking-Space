import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { fmtDurationMsBlock, mergedDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'

interface AiActivityDrillProjectTotalsBlockProps {
  /** The chains in the current drill (day or range). */
  chains: ActivityChain[]
  /** Currently filtered project, if any — its chip is emphasized. */
  activeProject?: string | null
  /** Click a project to filter to it (toggles off when clicked again). */
  onSelectProject?: (project: string | null) => void
}

/**
 * Per-project wall-clock totals for the drilled set — the compact replacement
 * for the AI-generated range summary. Each project the drill touched shows its
 * merged active time (overlaps collapsed) so you see where the time went at a
 * glance; the table below gives the session-by-session breakdown.
 */
export default function AiActivityDrillProjectTotalsBlock({
  chains,
  activeProject = null,
  onSelectProject,
}: AiActivityDrillProjectTotalsBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()

  const totals = useMemo(() => {
    const byProject = new Map<string, ActivityChain[]>()
    for (const c of chains) {
      const list = byProject.get(c.project)
      if (list) list.push(c)
      else byProject.set(c.project, [c])
    }
    return Array.from(byProject.entries())
      .map(([project, projectChains]) => ({
        project,
        ms: mergedDurationMsBlock(projectChains),
        sessions: projectChains.reduce((n, c) => n + c.sessions.length, 0),
      }))
      .sort((a, b) => b.ms - a.ms)
  }, [chains])

  // Cross-project total = merged active time across every chain (overlaps
  // collapsed), matching the day header's total — not the sum of per-project
  // rows, which would double-count parallel work on two projects at once.
  const totalMs = useMemo(() => mergedDurationMsBlock(chains), [chains])

  if (totals.length === 0) return null

  return (
    <div ref={hostRef} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {totals.map(({ project, ms, sessions }) => {
        const color = getProjectColor(project, isDark)
        const active = activeProject === project
        const dimmed = activeProject != null && !active
        return (
          <button
            key={project}
            type="button"
            onClick={onSelectProject ? () => onSelectProject(active ? null : project) : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 px-1 py-0.5 text-[11px] transition-opacity',
              onSelectProject && 'cursor-pointer',
              dimmed && 'opacity-45',
            )}
            title={`${project} · ${sessions} session${sessions === 1 ? '' : 's'} · ${fmtDurationMsBlock(ms)}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color.stroke }} />
            <span className={cn('max-w-[12rem] truncate', active && 'font-semibold')} style={{ color: color.stroke }}>{project}</span>
            <span className="tabular-nums text-foreground/70">{fmtDurationMsBlock(ms)}</span>
          </button>
        )
      })}
      {totals.length > 1 && (
        <span className="ml-auto inline-flex items-center gap-1 px-1 py-0.5 text-[10px]">
          <span className="uppercase tracking-[0.1em] text-muted-foreground/60">Total</span>
          <span className="font-medium tabular-nums text-foreground/70">{fmtDurationMsBlock(totalMs)}</span>
        </span>
      )}
    </div>
  )
}
