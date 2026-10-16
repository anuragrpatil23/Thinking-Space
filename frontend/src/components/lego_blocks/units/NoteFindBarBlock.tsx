// The one find bar for documents — a floating pill: "● mission  1 of 3 ↑ ↓ ×".
// Shown for ⌘F in a note, for a note opened from a vault search (pre-filled
// with the search words), and for HTML pages (over the webview's own find).
// The words are an inline field: type to find something else in this note.
// Enter = next, Shift+Enter = previous, Esc = close. Purely presentational;
// whoever owns the matches passes them in.

import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NoteFindBarBlockProps {
  value: string
  onChange: (value: string) => void
  /** Null while a search is still running. */
  count: number | null
  /** Index of the match being looked at; -1 when none. */
  current: number
  onStep: (direction: 1 | -1) => void
  onClose: () => void
  /** Focus and select the field whenever this changes (⌘F). 0 = don't. */
  focusKey?: number
  /** What to say when nothing matched. */
  emptyLabel?: string
  placeholder?: string
  className?: string
}

const BTN =
  'flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

export default function NoteFindBarBlock({
  value,
  onChange,
  count,
  current,
  onStep,
  onClose,
  focusKey = 0,
  emptyLabel = 'no matches',
  placeholder = 'Find in note',
  className,
}: NoteFindBarBlockProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!focusKey) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  const hasQuery = value.trim().length > 0
  const status = !hasQuery ? '' : count === null ? '…' : count === 0 ? emptyLabel : `${current + 1} of ${count}`

  return (
    <div
      role="search"
      className={cn(
        'flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background/90 pl-3 pr-1 text-xs shadow-sm backdrop-blur',
        className,
      )}
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500/80" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        size={Math.min(Math.max(value.length, placeholder.length) + 1, 28)}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 bg-transparent px-1 font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
      />
      <span
        aria-live="polite"
        className={cn('shrink-0 tabular-nums', count === 0 ? 'text-muted-foreground/70' : 'text-muted-foreground')}
      >
        {status}
      </span>
      <span className="ml-1 flex items-center">
        <button type="button" className={BTN} disabled={!count || count < 2} onClick={() => onStep(-1)} title="Previous (Shift+Enter, ⇧⌘G)" aria-label="Previous match">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={BTN} disabled={!count || count < 2} onClick={() => onStep(1)} title="Next (Enter, ⌘G)" aria-label="Next match">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={BTN} onClick={onClose} title="Close (Esc)" aria-label="Close find">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}
