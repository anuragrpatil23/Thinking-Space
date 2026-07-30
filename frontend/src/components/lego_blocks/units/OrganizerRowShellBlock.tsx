import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import TagChipListBlock from '@/components/lego_blocks/units/TagChipListBlock'
import {
  EPIC_BORDER_PALETTE,
  formatRowOrdinal,
} from '@/components/lego_blocks/units/BacklogListDomainBlock'

// The shared presentational row for the Thinking Organizer index — the List
// (backlog) row's visual language, reused: the coloured left bar from the same
// EPIC_BORDER_PALETTE, the layers icon, the mono ID chip, and TagChipListBlock's
// coloured pills, on the same card surface. What's dropped is the work-item
// chrome the List row carries — status control, expand chevron, info/copy/
// grouping buttons, drag/drop — because that machinery is exactly what the
// redesign removes. The `rightSlot` is where a List row spends its status
// control; here it carries the attention signal (density + count, or age).
//
// Both the undertaking row and the open-ask row render through this, so the two
// kinds read as one language and can't drift.

interface Props {
  /** Row position within its section — indexes into the shared border palette,
   *  matching how the List colours sibling rows. */
  colorIndex: number
  /** Mono ID chip (an ask's `F9-IDE-E-…` handle). Omitted for undertakings,
   *  whose key would just echo the title. */
  idBadge?: string
  title: string
  /** Coloured pills, same component and colouring as the List row. */
  tags?: string[]
  /** The attention gutter (sparkline + count, or age) — right-aligned. */
  rightSlot?: ReactNode
  /** Reconciliation sublines (◇→ discharged notes) rendered under the row. */
  subRows?: ReactNode
  onClick?: () => void
}

export default function OrganizerRowShellBlock({
  colorIndex,
  idBadge,
  title,
  tags,
  rightSlot,
  subRows,
  onClick,
}: Props) {
  const borderColorClass = EPIC_BORDER_PALETTE[colorIndex % EPIC_BORDER_PALETTE.length]
  const interactive = Boolean(onClick)

  return (
    <div className="bg-card">
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          interactive
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onClick?.()
                }
              }
            : undefined
        }
        className={cn(
          'flex items-center gap-2 border-l-[3px] px-3 py-1.5 transition-colors',
          borderColorClass,
          interactive && 'cursor-pointer hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-50 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60',
        )}
      >
        {/* Row ordinal — the List's small superscript index. */}
        <sup className="-ml-1 mt-0.5 shrink-0 self-start font-mono text-[9px] leading-none tabular-nums text-muted-foreground/45">
          {formatRowOrdinal(colorIndex)}
        </sup>

        {idBadge && (
          <span className="hidden shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:inline-flex">
            {idBadge}
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </span>

        {tags && tags.length > 0 && (
          <TagChipListBlock
            tags={tags}
            variant="solid"
            className="hidden max-w-[38%] flex-nowrap justify-end overflow-hidden sm:flex"
            chipClassName="shrink-0 truncate"
            keyPrefix="org-row-tag"
          />
        )}

        {rightSlot && <span className="ml-auto flex shrink-0 items-center justify-end gap-2 pl-2">{rightSlot}</span>}
      </div>
      {subRows}
    </div>
  )
}
