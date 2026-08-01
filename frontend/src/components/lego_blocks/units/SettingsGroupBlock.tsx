import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Settings chrome primitives — the grouped inset list that macOS System
// Settings and iOS Settings use: a small-caps group label OUTSIDE a single
// hairline-divided container, one row per setting, control right-aligned on
// the same line as its label.
//
// Why not nested cards: the old panes wrapped a bordered Card around a section
// that wrapped every row in another border, so the page read as a stack of
// boxes and each control drifted a full pane-width away from the label it
// belonged to. One container per group, dividers instead of borders, and a
// capped text column keep label and control visually paired.

/** Caps the reading column so a label and its control stay related. */
export const SETTINGS_PANE_WIDTH_BLOCK = 'mx-auto w-full max-w-[880px]'

export function SettingsSectionHeaderBlock({
  title,
  description,
}: {
  title: string
  description?: ReactNode
}) {
  return (
    <header className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'pb-1')}>
      <h1 className="text-[19px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description && (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
    </header>
  )
}

export function SettingsGroupBlock({
  heading,
  description,
  footnote,
  children,
  className,
}: {
  heading?: string
  description?: ReactNode
  footnote?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(SETTINGS_PANE_WIDTH_BLOCK, className)}>
      {heading && (
        <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {heading}
        </h2>
      )}
      {description && (
        <p className="mb-2 px-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
        {children}
      </div>
      {footnote && (
        <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-muted-foreground">{footnote}</p>
      )}
    </section>
  )
}

/**
 * One setting: label (+ optional secondary line) on the left, control on the
 * right. Pass `as="label"` so the whole row is a hit target for a Switch.
 * `stacked` drops the control onto its own line for wide controls (pickers,
 * rule editors) that cannot share the label's line.
 */
export function SettingsRowBlock({
  label,
  description,
  control,
  children,
  as = 'div',
  htmlFor,
  stacked = false,
  className,
}: {
  label?: ReactNode
  description?: ReactNode
  control?: ReactNode
  children?: ReactNode
  as?: 'div' | 'label'
  htmlFor?: string
  stacked?: boolean
  className?: string
}) {
  const Tag = as
  return (
    <Tag
      {...(as === 'label' && htmlFor ? { htmlFor } : {})}
      className={cn(
        'flex gap-4 px-3.5 py-3',
        as === 'label' && 'cursor-pointer',
        stacked ? 'flex-col' : 'items-center justify-between',
        className,
      )}
    >
      {(label || description) && (
        // max-w keeps the secondary line at a readable measure as the pane widens,
        // instead of stretching one sentence across the whole row.
        <div className="min-w-0 max-w-[600px] space-y-0.5">
          {label && <div className="text-[13px] font-medium leading-tight text-foreground">{label}</div>}
          {description && (
            <div className="text-[12px] leading-snug text-muted-foreground">{description}</div>
          )}
        </div>
      )}
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      {children}
    </Tag>
  )
}

/** Shared control sizing so selects/inputs in a row line up across panes. */
export const SETTINGS_CONTROL_CLASS_BLOCK =
  'h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring'
