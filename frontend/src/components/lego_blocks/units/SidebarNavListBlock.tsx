import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Desktop counterpart to `PhoneListBlock`'s inset-grouped list, for the
 * app's section side menus (Settings today).
 *
 * Same anatomy as the phone list, scaled to a pointer: a section header, one
 * filled card per group, and text-inset hairlines between rows instead of
 * gaps. Before this existed each sidebar hand-rolled its rows, so the group
 * headings, row padding and selected fill drifted apart between the settings
 * menu, the organizer and the phone build — the settings menu alone used two
 * different header styles on the same screen.
 *
 * Differences from the phone shape, all deliberate:
 * - No chevron. The detail pane is visible beside the list, so a row selects
 *   rather than pushes.
 * - Selection has to survive at rest (the phone's `selected` only marks a row
 *   mid-push), so it is the app-wide selected treatment — a `bg-foreground`
 *   pill with inverted text, the same as the nav rail, the drawer and the
 *   organizer. It fills the row edge to edge — the card's `overflow-hidden`
 *   rounds it against the card corners — rather than floating as an inset
 *   pill. Do not swap the fill for a tint to soften it; a selected row that
 *   does not match the rail is the inconsistency this block exists to end.
 */

export function SidebarNavSectionHeaderBlock({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <p className={cn(
      // px-8 lines the header text up with the row labels (card inset 5 +
      // row padding 3), which is the alignment that makes a grouped list read
      // as one column instead of two.
      'px-8 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80',
      className,
    )}>
      {children}
    </p>
  )
}

/**
 * `enabled={false}` drops the card styling but keeps the wrapper, so a call
 * site can share one container with its phone list without branching twice.
 */
export function SidebarNavGroupBlock({ enabled = true, children, className }: {
  enabled?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(enabled && 'mx-5 overflow-hidden rounded-[10px] bg-card/70', className)}>
      {children}
    </div>
  )
}

export function SidebarNavRowBlock({
  icon,
  label,
  trailing,
  selected = false,
  onClick,
  className,
}: {
  icon?: ReactNode
  label: ReactNode
  /** Secondary value shown at the trailing edge (a count, a current setting). */
  trailing?: ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'ltm-motion-fast relative flex min-h-[30px] w-full items-center gap-2 px-3 py-1',
        'text-left text-[13px] transition-colors',
        // Hairline inset to the label, not the card edge — the iOS separator
        // rule. `last:` drops it so the card bottom is one clean edge.
        // A filled row supplies its own edge, so it drops the hairline it
        // would otherwise draw across its own fill.
        'after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:h-px after:bg-border/50',
        icon ? 'after:left-[2.5rem]' : 'after:left-3',
        'last:after:hidden',
        selected
          ? 'bg-foreground text-background after:hidden'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing !== undefined && trailing !== null && (
        <span className={cn(
          'shrink-0 text-[12px] tabular-nums',
          selected ? 'text-background/70' : 'text-muted-foreground',
        )}>{trailing}</span>
      )}
    </button>
  )
}

/** Icon sizing shared by every row in these lists. */
export const SIDEBAR_NAV_ICON_CLASS_BLOCK = 'h-4 w-4 shrink-0'
