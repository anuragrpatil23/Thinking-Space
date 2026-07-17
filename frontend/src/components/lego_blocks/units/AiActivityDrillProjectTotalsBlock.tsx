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

  if (totals.length === 0) return null

  return (
    <div ref={hostRef} className="flex flex-wrap items-center gap-1.5">
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
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              onSelectProject && 'cursor-pointer',
              active
                ? 'border-border/80 bg-card/80 text-foreground'
                : 'border-border/40 bg-card/40 text-foreground/80 hover:border-border/70 hover:text-foreground',
              dimmed && 'opacity-55',
            )}
            title={`${project} · ${sessions} session${sessions === 1 ? '' : 's'} · ${fmtDurationMsBlock(ms)}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color.stroke }} />
            <span className="max-w-[12rem] truncate" style={{ color: color.stroke }}>{project}</span>
            <span className="tabular-nums text-foreground/70">{fmtDurationMsBlock(ms)}</span>
          </button>
        )
      })}
    </div>
  )
}
