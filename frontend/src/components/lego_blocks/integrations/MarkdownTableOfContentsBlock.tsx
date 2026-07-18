import { useEffect, useMemo, useRef, useState } from 'react'
import { ListTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  parseMarkdownTableOfContentsBlock,
  type MarkdownTableOfContentsItemBlock,
} from '@/services/lego_blocks/units/markdownTableOfContentsBlock'
import { assignSectionOutlineLabelsBlock } from '@/services/lego_blocks/units/outlineCounterBlock'
import DocumentOutlinePanelBlock, {
  type DocumentOutlineRowBlock,
} from '@/components/lego_blocks/units/DocumentOutlinePanelBlock'

interface MarkdownTableOfContentsBlockProps {
  content: string
  currentLine: number
  compact?: boolean
  onSelectHeading: (heading: MarkdownTableOfContentsItemBlock) => void
}

export default function MarkdownTableOfContentsBlock({
  content,
  currentLine,
  compact = false,
  onSelectHeading,
}: MarkdownTableOfContentsBlockProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const items = useMemo(() => parseMarkdownTableOfContentsBlock(content), [content])
  const activeItem = useMemo(() => {
    let lastMatch: MarkdownTableOfContentsItemBlock | null = null
    for (const item of items) {
      if (item.line > currentLine) break
      lastMatch = item
    }
    return lastMatch
  }, [currentLine, items])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const panelRows = useMemo<DocumentOutlineRowBlock[]>(() => {
    const { titleIndex, labels } = assignSectionOutlineLabelsBlock(items.map((item) => item.level))
    return items.map((item, idx) => ({
      key: item.id,
      label: labels[idx],
      text: item.title,
      level: item.level,
      isTitle: idx === titleIndex,
      active: item.id === activeItem?.id,
      onSelect: () => {
        onSelectHeading(item)
        setOpen(false)
      },
    }))
  }, [activeItem?.id, items, onSelectHeading])

  const headingCountLabel = items.length === 1 ? '1 heading' : `${items.length} headings`

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
          items.length === 0 && 'opacity-55',
        )}
        title={items.length > 0 ? 'Open table of contents' : 'No headings found yet'}
      >
        <ListTree className="h-3.5 w-3.5" />
        <span>Contents</span>
        <span className="rounded bg-background/80 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
          {items.length}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl">
          <div className="border-b border-border/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">Table of Contents</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {items.length > 0
                    ? `${headingCountLabel}${activeItem ? ` • current: ${activeItem.title}` : ''}`
                    : 'Add markdown headings to build an outline.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>

          {items.length > 0 ? (
            <DocumentOutlinePanelBlock
              rows={panelRows}
              size="large"
              className={cn(compact ? 'max-h-[55vh]' : 'max-h-[24rem]')}
            />
          ) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No headings yet. Add `#`, `##`, or deeper heading levels and they will appear here.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
