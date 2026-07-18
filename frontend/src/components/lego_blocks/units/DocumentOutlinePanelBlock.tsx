import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared outline list for document Contents UIs — the mini-nav rail's hover
 * panel and the Contents dropdown render the same rows so numbering, title
 * handling, and indentation can never drift between them. Card chrome
 * (border/background/header) stays with the consumer; this is just the list.
 */
export interface DocumentOutlineRowBlock {
  key: string
  /** Outline label from outlineCounterBlock; '' renders no numeral. */
  label: string
  text: string
  level: number
  /** Document-title row: unnumbered, emphasized, separated from sections. */
  isTitle?: boolean
  active?: boolean
  onSelect: () => void
}

interface DocumentOutlinePanelBlockProps {
  rows: DocumentOutlineRowBlock[]
  size?: 'compact' | 'large'
  className?: string
}

export default function DocumentOutlinePanelBlock({
  rows,
  size = 'compact',
  className,
}: DocumentOutlinePanelBlockProps) {
  const compact = size === 'compact'
  const sectionLevels = rows.filter((row) => !row.isTitle).map((row) => row.level)
  const baseLevel = sectionLevels.length > 0 ? Math.min(...sectionLevels) : 1
  const indentStep = compact ? 10 : 14
  const basePadding = compact ? 10 : 12

  const listRef = useRef<HTMLDivElement | null>(null)
  const activeKey = rows.find((row) => row.active)?.key
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-outline-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  return (
    <div ref={listRef} className={cn('min-h-0 overflow-y-auto py-1', className)}>
      {rows.map((row) => {
        if (row.isTitle) {
          return (
            <button
              key={row.key}
              type="button"
              onClick={row.onSelect}
              className={cn(
                'mb-1 block w-full truncate whitespace-nowrap border-b border-border/60 text-left font-semibold text-foreground transition-colors hover:bg-muted/60',
                compact ? 'max-w-[300px] px-2.5 pb-1.5 pt-1 text-[11px]' : 'px-3 pb-2 pt-1.5 text-sm',
              )}
            >
              {row.text || '—'}
            </button>
          )
        }

        const depth = Math.max(0, Math.min(row.level - baseLevel, 3))
        return (
          <button
            key={row.key}
            type="button"
            onClick={row.onSelect}
            data-outline-active={row.active ? 'true' : undefined}
            className={cn(
              'flex w-full items-center whitespace-nowrap text-left leading-tight transition-colors',
              compact ? 'max-w-[300px] gap-1.5 px-2.5 py-1 text-[11px]' : 'gap-2 px-3 py-1.5 text-sm',
              row.active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              row.level <= baseLevel && 'font-medium',
            )}
            style={{ paddingLeft: basePadding + depth * indentStep }}
          >
            {row.label && (
              <span
                className={cn(
                  'shrink-0 text-right font-mono leading-none',
                  compact ? 'min-w-[1.1em] text-[10px]' : 'min-w-[1.4em] text-xs',
                  row.active ? 'text-primary' : 'text-muted-foreground/70',
                )}
              >
                {row.label}
              </span>
            )}
            <span className="min-w-0 truncate">{row.text || '—'}</span>
          </button>
        )
      })}
    </div>
  )
}
