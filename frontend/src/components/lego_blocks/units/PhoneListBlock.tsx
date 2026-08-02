import { useEffect, useRef, useState, type ReactNode } from 'react'
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
    <div className={cn(enabled && 'mx-4 overflow-hidden rounded-[10px] bg-card', className)}>
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

/**
 * iOS large-title nav bar: a big title that scrolls away, and a compact blurred
 * bar that materializes underneath the status bar as it goes.
 *
 * Deliberately not Swift. The scroller is the web view, so a UIKit nav bar would
 * need the web scroll offset bridged to native on every frame — a JS->native hop
 * in a 60fps path, for a bar that here is pure presentation. Sticky positioning
 * collapses in the same layout pass as the scroll that caused it.
 *
 * It also fixes a plain bug: these phone pages reserved nothing at the top, so
 * rows scrolled under the status bar with no backdrop and smeared into the clock.
 *
 * Render it as the FIRST child of the scrolling element. It returns a fragment,
 * not a wrapper: `position: sticky` is confined to its parent's box, so a
 * wrapper around the bar and the title made the bar scroll away the moment the
 * title did. Its parent has to BE the scroller. That is also why these pages
 * carry no top/side padding on their scroller — the bar spans edge to edge and
 * the rows inset themselves (`PhoneListGroupBlock`).
 *
 * The bar reserves no safe-area inset of its own: the shell already pads
 * `.ltm-app-main` by `--ltm-safe-top`, and padding here too stacked two status
 * bars' worth of dead space above the title.
 */
export function PhoneLargeTitleBlock({ title, trailing }: {
  title: ReactNode
  /** Optional action rendered at the bar's trailing edge, always visible. */
  trailing?: ReactNode
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const bar = barRef.current
    const bigTitle = titleRef.current
    if (!bar || !bigTitle) return

    let scroller: HTMLElement | null = bar.parentElement
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scroller = scroller.parentElement
    }
    if (!scroller) return

    let frame = 0
    // Collapse when the large title has actually slid under the bar, not at a
    // fixed scrollTop — that is what makes the handoff read as one motion
    // instead of a bar blinking on while the big title is still in full view.
    const measure = () => {
      frame = 0
      setCollapsed(bigTitle.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <>
      {/* `isolate` + explicit z-order, not DOM order: `backdrop-filter` promotes
          the frosted layer to its own compositing layer, and WebKit then paints
          it OVER later siblings that only have `z-index: auto`. The compact
          title appeared for a frame or two and was then covered by its own
          backdrop (2026-08-02). */}
      <div ref={barRef} className="sticky top-0 z-20 isolate">
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 z-0 border-b border-border/60 bg-background/80 backdrop-blur-xl',
            'transition-opacity duration-150 ease-out',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div className="relative z-10 flex h-11 items-center justify-center px-4">
          <span className={cn(
            'truncate text-[17px] font-semibold text-foreground',
            'transition-opacity duration-150 ease-out',
            collapsed ? 'opacity-100' : 'opacity-0',
          )}>
            {title}
          </span>
          {trailing && <div className="absolute right-2 flex items-center">{trailing}</div>}
        </div>
      </div>
      <h1
        ref={titleRef}
        className="px-4 pb-1 text-[34px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground"
      >
        {title}
      </h1>
    </>
  )
}

/** Icon sizing shared by every row in these lists. */
export const PHONE_LIST_ICON_CLASS_BLOCK = 'h-[20px] w-[20px] shrink-0 text-muted-foreground'
