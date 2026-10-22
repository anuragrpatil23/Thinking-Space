import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// F9's shared visual parts, macOS-native in feel: white grouped panels on a
// soft grey ground, small grey section labels, segmented controls, and
// label/value rows. Every F9 view builds from these so the tab reads as one app.

export const F9_PANEL_CLASS_BLOCK = 'rounded-xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.09)] dark:bg-zinc-900 dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1)]'

export function F9PanelBlock({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn(F9_PANEL_CLASS_BLOCK, className)}>{children}</div>
}

export function F9SectionLabelBlock({ children, trailing, className }: { children: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-1 mb-1.5 flex min-h-[24px] flex-wrap items-center justify-between gap-2', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.02em] text-zinc-500 dark:text-zinc-400">{children}</p>
      {trailing}
    </div>
  )
}

export function F9SegmentedBlock<T extends string>({ options, value, onChange, ariaLabel }: {
  options: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-[7px] bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[5px] px-2.5 py-0.5 text-xs transition-colors',
            // A soft ring for the keyboard only; a click shouldn't leave an outline.
            'outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
            value === option.value
              ? 'bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:bg-zinc-600 dark:text-white'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white',
          )}
        >
          {option.label}{option.count !== undefined && <span className="ml-1 tabular-nums opacity-60">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function F9FactRowBlock({ label, value, sub, tone, divided }: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'up' | 'down' | null
  /** Starts a new group: a hairline above it. */
  divided?: boolean
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2 tabular-nums', divided && 'mt-2 border-t border-zinc-200/80 dark:border-zinc-800')}>
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-right">
        <span className={cn('font-medium', tone === 'up' && 'text-emerald-600 dark:text-emerald-400', tone === 'down' && 'text-red-600 dark:text-red-400')}>{value}</span>
        {sub && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{sub}</span>}
      </span>
    </div>
  )
}
