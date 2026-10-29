import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedToggleOption<TValue extends string> {
  value: TValue
  label: string
  icon?: ComponentType<{ className?: string }>
  title?: string
}

interface SegmentedToggleBlockProps<TValue extends string> {
  value: TValue
  onChange: (next: TValue) => void
  options: SegmentedToggleOption<TValue>[]
  ariaLabel?: string
  className?: string
  /** `sm` is the toolbar size; `md` and `lg` are the same control at form-row
   *  and touch scale (the note settings panel, desktop and phone). */
  size?: 'sm' | 'md' | 'lg'
}

// Segmented pill toggle used for value-based view switches (e.g. Doc/Canvas,
// List/Canvas). Route-based tabs should use SubNavTabsBlock instead.
export default function SegmentedToggleBlock<TValue extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  size = 'sm',
}: SegmentedToggleBlockProps<TValue>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-border/70 bg-background/80 p-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        size === 'sm' ? 'h-7' : size === 'md' ? 'h-9 rounded-lg' : 'h-11 rounded-lg',
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            title={option.title ?? option.label}
            className={cn(
              'inline-flex items-center gap-1 rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[11px]' : size === 'md' ? 'h-7 px-3 text-[13px]' : 'h-9 px-4 text-[15px]',
              isActive
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
