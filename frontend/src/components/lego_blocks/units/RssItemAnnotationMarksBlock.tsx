import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useRssItemAnnotationsBlock } from '@/components/lego_blocks/hooks/shared/useRssItemAnnotationsBlock'

// Small text chips for the marks optional modules put on an article (see
// rssItemAnnotationBlock). Renders nothing when there are none.
export default function RssItemAnnotationMarksBlock({
  itemId,
  inverted,
  className,
}: {
  itemId: string
  /** On a selected (dark) row. */
  inverted?: boolean
  className?: string
}) {
  const annotate = useRssItemAnnotationsBlock()
  const navigate = useNavigate()
  const marks = annotate(itemId)
  if (marks.length === 0) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {marks.map((mark) => (
        <button
          key={mark.label}
          type="button"
          title={mark.title}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
            mark.onOpen({ navigate })
          }}
          className={cn(
            'rounded border px-1.5 py-px text-[10px] font-medium leading-tight transition-colors',
            inverted
              ? 'border-white/40 text-white/90 hover:bg-white/15'
              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          {mark.label}
        </button>
      ))}
    </span>
  )
}
