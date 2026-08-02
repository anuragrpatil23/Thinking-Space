import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * iOS inset-grouped list primitives, for the phone pages whose "list" is a
 * reused desktop sidebar (Webull/F9, Thinking Organizer, Settings).
 *
 * The thing that makes those pages read as a web nav rather than an iOS list
 * is not the row height — it is that the rows float on the page background
 * with gaps between them. A real grouped list is one filled card with
 * text-inset hairlines, full-contrast labels, and a chevron on anything that
 * pushes. That is what these render.
 *
 * Desktop keeps its own markup: this is a phone-only shape, and callers gate
 * on their existing `phoneListMode` flag rather than passing a surface prop.
 */

export function PhoneListSectionHeaderBlock({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <p className={cn(
      'px-4 pb-2 pt-6 text-[13px] font-normal uppercase tracking-[0.06em] text-muted-foreground',
      className,
    )}>
      {children}
    </p>
  )
}

/**
 * `enabled={false}` drops the card styling but keeps the wrapper element, so a
 * call site can share one container between its phone list and its desktop
 * nav (whose spacing utilities live in `className`) without branching twice.
 */
export function PhoneListGroupBlock({ enabled = true, children, className }: {
  enabled?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(enabled && 'overflow-hidden rounded-[10px] bg-card', className)}>
      {children}
    </div>
  )
}

export function PhoneListRowBlock({
  icon,
  label,
  trailing,
  showChevron = true,
  selected = false,
  onClick,
  className,
}: {
  icon?: ReactNode
  label: ReactNode
  /** Secondary value shown before the chevron (a count, a current setting). */
  trailing?: ReactNode
  showChevron?: boolean
  /** Only meaningful where a detail pane is visible at the same time. */
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // `active:` is the touch equivalent of the desktop `hover:` these rows
        // used to carry — on a touch screen hover never fires, so a tap had no
        // feedback at all until the next screen appeared.
        'relative flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left',
        'text-[17px] text-foreground transition-colors active:bg-foreground/[0.06]',
        // Hairline inset to the label, not the card edge — the iOS separator
        // rule. `last:` drops it so the card bottom is one clean edge.
        'after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:h-px after:bg-border/60',
        icon ? 'after:left-[3.25rem]' : 'after:left-4',
        'last:after:hidden',
        selected && 'bg-foreground/[0.06]',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing !== undefined && trailing !== null && (
        <span className="shrink-0 text-[15px] tabular-nums text-muted-foreground">{trailing}</span>
      )}
      {showChevron && (
        <ChevronRight className="-mr-1 h-4 w-4 shrink-0 text-muted-foreground/45" />
      )}
    </button>
  )
}

/** Icon sizing shared by every row in these lists. */
export const PHONE_LIST_ICON_CLASS_BLOCK = 'h-[20px] w-[20px] shrink-0 text-muted-foreground'
