import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The card's inset surface: one panel style shared by everything that sits
 * *inside* a card rather than beside it — the day timeline, the day table,
 * empty states standing in for either.
 *
 * It exists because those surfaces drifted apart. The timeline, the table and
 * the table's empty state each carried their own radius/border/fill triple, so
 * a drill showed two or three shades of "inset" stacked on top of each other
 * and the eye read them as different materials. Anything that wants to be an
 * inset panel should render this instead of restating the classes, so the next
 * one cannot drift either.
 *
 * Deliberately unpadded: a table fills its panel edge to edge while a chart
 * needs room to breathe, so padding is the caller's call and comes in through
 * `className`.
 */
export default function InsetSurfaceBlock({
  className,
  style,
  children,
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={cn('rounded-xl border border-border/40 bg-muted/20', className)} style={style}>
      {children}
    </div>
  )
}
