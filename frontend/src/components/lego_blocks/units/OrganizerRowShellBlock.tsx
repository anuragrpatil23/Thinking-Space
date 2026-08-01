import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import TagChipListBlock from '@/components/lego_blocks/units/TagChipListBlock'
import {
  EPIC_BORDER_PALETTE,
  EPIC_ICON_COLOR_BY_BORDER,
} from '@/components/lego_blocks/units/BacklogListDomainBlock'

// The shared presentational row for the Thinking Organizer index — the List
// (backlog) row's visual language, reused: the coloured left bar from the same
// EPIC_BORDER_PALETTE and TagChipListBlock's coloured pills, on the same card
// surface. What's dropped is the work-item chrome the List row carries — status
// control, expand chevron, info/copy/grouping buttons, drag/drop. The
// `rightSlot` is where a List row spends its status control; here it carries the
// attention signal (density + count, or a link).
//
// Colour encodes the *section*, not the row: every row in a grouping shares one
// palette colour (passed as `colorIndex`), which is why the ordinal is a
// separate `ordinal` prop rather than being read off the colour index.
//
// Both the undertaking row and the note row render through this, so the two read
// as one language and can't drift.

interface Props {
  /** The section's palette slot — shared by every row in the grouping. */
  colorIndex: number
  /** 1-based row number within its section. */
  ordinal: number
  /** A small leading indicator glyph before the title (◇ untouched / ◆ engaged,
   *  for notes). Omitted for undertakings. */
  leadGlyph?: ReactNode
  title: string
  /** Coloured pills, same component and colouring as the List row. */
  tags?: string[]
  /** The attention gutter (sparkline + count, or a link) — right-aligned. */
  rightSlot?: ReactNode
  /** Reconciliation sublines (◆→ notes) rendered under the row. */
  subRows?: ReactNode
  /** The row is open — it heads an expanded panel, so it joins that panel's
   *  plane instead of sitting on the closed-row surface. */
  active?: boolean
  onClick?: () => void
}

/** The spine's fill, keyed off the same palette slot as the border class. A
 *  literal map (not string-built) so Tailwind's JIT actually generates these. */
const SPINE_BG_BY_BORDER: Record<string, string> = {
  'border-l-blue-500': 'bg-blue-500',
  'border-l-violet-500': 'bg-violet-500',
  'border-l-emerald-500': 'bg-emerald-500',
  'border-l-amber-500': 'bg-amber-500',
  'border-l-rose-500': 'bg-rose-500',
  'border-l-cyan-500': 'bg-cyan-500',
  'border-l-fuchsia-500': 'bg-fuchsia-500',
  'border-l-lime-500': 'bg-lime-500',
}

/** Border, spine fill, and matching text colour for a section, from its palette
 *  slot. The classes come from shared literal maps (not string-built) so
 *  Tailwind's JIT actually generates them, in both light and dark. */
export function organizerSectionColorBlock(colorIndex: number): { border: string; spine: string; text: string } {
  const border = EPIC_BORDER_PALETTE[colorIndex % EPIC_BORDER_PALETTE.length]
  return {
    border,
    spine: SPINE_BG_BY_BORDER[border] ?? 'bg-foreground/30',
    text: EPIC_ICON_COLOR_BY_BORDER[border] ?? 'text-foreground/80',
  }
}

export default function OrganizerRowShellBlock({
  colorIndex,
  ordinal,
  leadGlyph,
  title,
  tags,
  rightSlot,
  subRows,
  active = false,
  onClick,
}: Props) {
  const { spine } = organizerSectionColorBlock(colorIndex)
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
          // The left padding only has to clear the 3px spine, not restate the
          // right-hand padding — the ordinal column already supplies the air
          // before the title, so matching px on both sides just pushed the
          // whole row off its own edge.
          'relative flex min-h-[2.25rem] items-center gap-2 py-1.5 pl-1.5 pr-3 transition-colors',
          interactive && 'cursor-pointer focus:outline-none',
          // An open row shares the peek's surface, so header and panel read as
          // one raised block; a closed row keeps the plain hover.
          active
            ? 'bg-black/[0.035] shadow-[inset_0_1px_0_rgba(0,0,0,0.06)] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
            : interactive && 'hover:bg-zinc-50 focus-visible:bg-zinc-50 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60',
        )}
      >
        {/* The spine is a rounded bar inset from the row's top and bottom, not a
            left border. A border is full-bleed, so in a flush list the spines of
            consecutive rows weld into one continuous stripe — it stops marking a
            row and becomes a background rail, and a section change reads as a
            seam in that rail rather than a new mark. Inset and rounded, each row
            owns its own token and the colour goes back to meaning "this row is
            in that section". */}
        <span
          aria-hidden
          className={cn('absolute bottom-1 left-0 top-1 w-[3px] rounded-full', spine)}
        />

        {/* Ordinal — fixed-width so single- and double-digit numbers don't shift
            the title, self-start for the superscript feel. */}
        <span className="w-4 shrink-0 self-start pt-1 text-right font-mono text-[9px] leading-none tabular-nums text-muted-foreground/45">
          {ordinal}
        </span>

        {leadGlyph && <span className="shrink-0 text-[11px] leading-none">{leadGlyph}</span>}

        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground" title={title}>
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
