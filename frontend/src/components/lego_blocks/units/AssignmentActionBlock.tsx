import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The queue's shared button vocabulary.
 *
 * Extracted the moment a second pane needed it. Both panes end in a row of
 * verbs, and a decision surface where "Accept" and "File into…" are styled by
 * two different hands reads as two different features — which is exactly what
 * happened the first time the manual pane shipped with its own buttons.
 */

export function KbdBlock({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground">
      {children}
    </kbd>
  )
}

export default function ActionBlock({
  icon: Icon,
  label,
  hint,
  onClick,
  primary,
  disabled,
}: {
  icon: typeof Check
  label: string
  /** The key that does this. Omitted where a pane has no keyboard path — an
   *  advertised shortcut that does nothing is worse than none. */
  hint?: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border border-border hover:bg-muted',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {hint && (
        <kbd
          className={cn(
            'ml-0.5 rounded px-1 py-px font-mono text-[10px] leading-none',
            primary ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
          )}
        >
          {hint}
        </kbd>
      )}
    </button>
  )
}
