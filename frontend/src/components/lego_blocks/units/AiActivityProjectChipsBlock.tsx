import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ActivityProject } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'

interface AiActivityProjectChipsBlockProps {
  projects: ActivityProject[]
  activeProject: string | null
  onSelect: (project: string | null) => void
  /** When true, noise buckets ([auto-commit], [telegram]) are hidden. */
  hideNoise?: boolean
}

export default function AiActivityProjectChipsBlock({
  projects,
  activeProject,
  onSelect,
  hideNoise = true,
}: AiActivityProjectChipsBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const visible = useMemo(
    () => (hideNoise ? projects.filter(p => !p.isNoise) : projects),
    [projects, hideNoise],
  )

  if (visible.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/70">
        No Claude sessions in this range.
      </div>
    )
  }

  return (
    <div ref={hostRef} className="grid grid-cols-2 gap-x-3 gap-y-0.5 md:grid-cols-3 lg:grid-cols-4">
      {visible.map(p => {
        const color = getProjectColor(p.name, isDark)
        const active = activeProject === p.name
        return (
          <button
            key={p.name}
            type="button"
            onClick={() => onSelect(active ? null : p.name)}
            className={cn(
              'flex items-center gap-1.5 rounded border border-transparent px-1.5 py-0.5 text-left text-[11px] transition-colors',
              'hover:border-border/40 hover:bg-card/40',
              active && 'border-border/60 bg-card/60',
            )}
            style={{ background: active ? color.chipBg : undefined }}
            title={`${p.name} · ${p.totalSessions} sessions · ${p.totalChains} chains`}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: color.stroke }}
              aria-hidden
            />
            <span
              className="flex-1 truncate font-medium"
              style={{ color: color.stroke }}
            >
              {p.name}
            </span>
            <span className="shrink-0 tabular-nums text-foreground/60">
              {p.totalMsgs.toLocaleString()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
