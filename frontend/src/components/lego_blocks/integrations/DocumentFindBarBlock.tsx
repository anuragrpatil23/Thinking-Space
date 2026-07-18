import { useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InDocumentFindState } from '@/components/lego_blocks/hooks/units/useInDocumentFindBlock'

interface DocumentFindBarBlockProps {
  find: InDocumentFindState
  onClose: () => void
  className?: string
}

/**
 * Floating "find in document" bar (Cmd/Ctrl+F). Enter = next match,
 * Shift+Enter = previous, Escape = close. Purely presentational over the
 * search state owned by useInDocumentFindBlock.
 */
export default function DocumentFindBarBlock({ find, onClose, className }: DocumentFindBarBlockProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const hasQuery = find.query.trim().length > 0

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur',
        className,
      )}
      role="search"
    >
      <input
        ref={inputRef}
        type="text"
        value={find.query}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) find.prev()
            else find.next()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder="Find in document"
        className="h-7 w-44 min-w-0 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        aria-label="Find in document"
      />
      <span className="min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {hasQuery ? `${find.activePosition}/${find.matchCount}` : ''}
      </span>
      <button
        type="button"
        onClick={find.prev}
        disabled={find.matchCount === 0}
        title="Previous match (Shift+Enter)"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={find.next}
        disabled={find.matchCount === 0}
        title="Next match (Enter)"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
