// The floating "money · 3 of 12 ↑ ↓ ×" pill over a note opened from a vault
// search. Sticky at the top-right of the note, zero layout height, so it
// floats over the text instead of pushing it down.

import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchHitCounterBlockProps {
  words: readonly string[]
  count: number
  current: number
  onStep: (direction: 1 | -1) => void
  onClear: () => void
}

const STEP_BTN =
  'flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

export default function SearchHitCounterBlock({ words, count, current, onStep, onClear }: SearchHitCounterBlockProps) {
  const label = words.join(' ')
  return (
    <div className="pointer-events-none sticky top-3 z-20 flex h-0 justify-end px-3">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background/90 pl-3 pr-1 text-xs shadow-sm backdrop-blur"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500/80" />
        <span className="max-w-[12rem] truncate font-medium text-foreground">{label}</span>
        <span className={cn('ml-1 tabular-nums', count === 0 ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
          {count === 0 ? 'not in the text' : `${current + 1} of ${count}`}
        </span>
        <span className="ml-1 flex items-center">
          <button type="button" className={STEP_BTN} disabled={count < 2} onClick={() => onStep(-1)} title="Previous (⇧⌘G)" aria-label="Previous match">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={STEP_BTN} disabled={count < 2} onClick={() => onStep(1)} title="Next (⌘G)" aria-label="Next match">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={STEP_BTN} onClick={onClear} title="Clear highlights" aria-label="Clear highlights">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  )
}
