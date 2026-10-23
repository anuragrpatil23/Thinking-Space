import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarGroupHeaderBlockProps {
  name: string
  expanded: boolean
  onToggle: () => void
  /** Optional icon rendered between chevron and name */
  icon?: React.ReactNode
  /** Optional count/badge rendered at the right edge */
  badge?: React.ReactNode
  /** Nesting depth — adds 12px of left padding per level */
  depth?: number
  className?: string
  /** A plain grey number instead of the pill (native F9 lists) */
  quietBadge?: boolean
}

/**
 * Shared collapsible group header for sidebar panels (RSS, Web, Chat).
 * Matches the visual style established by RssFeedPanelBlock.
 */
export default function SidebarGroupHeaderBlock({
  name,
  expanded,
  onToggle,
  icon,
  badge,
  depth = 0,
  className,
  quietBadge = false,
}: SidebarGroupHeaderBlockProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-1.5 border-b border-border/30 bg-muted/30 px-3 py-2.5 text-left text-xs hover:bg-muted/50',
        className,
      )}
      style={depth > 0 ? { paddingLeft: `${12 + depth * 12}px` } : undefined}
    >
      {expanded
        ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {icon}
      <span className="min-w-0 flex-1 truncate font-semibold text-muted-foreground">{name}</span>
      {badge != null && (
        <span className={quietBadge
          ? 'shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400'
          : 'shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary'}>
          {badge}
        </span>
      )}
    </button>
  )
}
