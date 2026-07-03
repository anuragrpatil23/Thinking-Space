import { X } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'

export interface LinkedItemChipEntryBlock {
  path: string
  label: string
  summary?: string
}

interface LinkedItemChipsBlockProps {
  items: LinkedItemChipEntryBlock[]
  onOpenItem?: (path: string, event: MouseEvent<HTMLButtonElement>) => void
  onRemoveItem?: (path: string, event: MouseEvent<HTMLButtonElement>) => void
  removeDisabled?: boolean
  emptyMessage?: string
  className?: string
  chipClassName?: string
  labelClassName?: string
}

export default function LinkedItemChipsBlock({
  items,
  onOpenItem,
  onRemoveItem,
  removeDisabled = false,
  emptyMessage,
  className,
  chipClassName,
  labelClassName,
}: LinkedItemChipsBlockProps) {
  if (items.length === 0) {
    return emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map(item => (
        <span
          key={`linked-item-chip-${item.path}`}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-2 py-0.5 text-[11px]',
            chipClassName,
          )}
          title={item.summary ? `${item.label}: ${item.summary}` : item.label}
        >
          {onOpenItem ? (
            <button
              type="button"
              className={cn('max-w-[13rem] truncate text-blue-700 dark:text-blue-300 hover:underline', labelClassName)}
              onClick={(event) => onOpenItem(item.path, event)}
            >
              {item.label}
            </button>
          ) : (
            <span className={cn('max-w-[13rem] truncate text-foreground', labelClassName)}>
              {item.label}
            </span>
          )}
          {onRemoveItem ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => onRemoveItem(item.path, event)}
              disabled={removeDisabled}
              title="Remove link"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}
