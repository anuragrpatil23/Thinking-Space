import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ContextMenuBlock from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import type { FilterGroup, OrganizerFilter } from '@/services/lego_blocks/units/organizerIndexFilterBlock'

// The organizer index filter bar, styled to match the List's dark bucket pills.
// One dark dropdown per attribute (Year, Kind, Tag, State) with a chevron and a
// count badge; picking a value toggles a filter and the view narrows (AND).
// Active filters show as dark chips, each removable. Narrow-only.

const ENGAGEMENT_LABELS: Record<string, string> = { open: 'Open', engaged: 'Engaged' }

function chipLabel(f: OrganizerFilter): string {
  return f.attr === 'engagement' ? (ENGAGEMENT_LABELS[f.value] ?? f.value) : f.value
}

/** The filter strip's shared pill geometry — the trailing actions borrow it so
 *  the whole row reads as one control strip.
 *
 *  These are chrome, not content: filled cards at `text-sm` in `rounded-xl`
 *  competed with the row titles below them for weight. Quiet outlines that firm
 *  up on hover say "controls" without shouting over the list they narrow. */
export const ORGANIZER_STRIP_PILL =
  'inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground'

// Dropdown buttons stay light; only a *selected* filter is dark (the chip).
const DROPDOWN_PILL = ORGANIZER_STRIP_PILL
// The count rides bare beside the label. A filled badge inside an outlined pill
// was a second container for one number.
const DROPDOWN_BADGE = 'text-[11px] leading-none tabular-nums text-muted-foreground/50'
const CHIP_PILL =
  'inline-flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1 text-[13px] font-medium text-background transition-opacity hover:opacity-85'

interface Props {
  groups: FilterGroup[]
  active: OrganizerFilter[]
  onToggle: (f: OrganizerFilter) => void
  /** Actions that ride the far end of the same strip (Sections). They belong in
   *  this row rather than a sibling container: parked outside, an action floats
   *  as an unexplained lone control, and it can't share the pills' baseline. */
  trailing?: ReactNode
}

function FilterDropdown({
  group,
  active,
  onToggle,
}: {
  group: FilterGroup
  active: OrganizerFilter[]
  onToggle: (f: OrganizerFilter) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const suppressReopen = useRef(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const isActive = (value: string) => active.some(f => f.attr === group.attr && f.value === value)
  const activeCount = active.filter(f => f.attr === group.attr).length

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onPointerDown={() => { suppressReopen.current = position !== null }}
        onClick={() => {
          if (suppressReopen.current) { suppressReopen.current = false; return }
          const rect = buttonRef.current?.getBoundingClientRect()
          if (rect) setPosition({ x: rect.left, y: rect.bottom + 6 })
        }}
        className={cn(
          DROPDOWN_PILL,
          (position !== null || activeCount > 0) && 'border-border bg-muted/50 text-foreground',
        )}
      >
        {group.label}
        <span className={cn(DROPDOWN_BADGE, activeCount > 0 && 'text-foreground/70')}>
          {activeCount > 0 ? activeCount : group.values.length}
        </span>
        {/* Chevron trails the label — leading, it read as a disclosure arrow for
            the strip itself rather than the menu this one button opens. */}
        <ChevronDown
          className={cn('h-3.5 w-3.5 opacity-45 transition-transform', position !== null && 'rotate-180')}
        />
      </button>
      {position && (
        <ContextMenuBlock
          position={position}
          onClose={() => setPosition(null)}
          entries={group.values.map(v => ({
            key: `${group.attr}:${v.value}`,
            label: `${isActive(v.value) ? '✓  ' : ''}${v.label}`,
            onClick: () => onToggle({ attr: group.attr, value: v.value }),
          }))}
        />
      )}
    </>
  )
}

export default function OrganizerFilterBarBlock({ groups, active, onToggle, trailing }: Props) {
  if (groups.length === 0 && !trailing) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map(group => (
        <FilterDropdown key={group.attr} group={group} active={active} onToggle={onToggle} />
      ))}

      {active.length > 0 && <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />}

      {active.map(f => (
        <button
          key={`${f.attr}:${f.value}`}
          type="button"
          onClick={() => onToggle(f)}
          className={CHIP_PILL}
          title="Remove filter"
        >
          {chipLabel(f)}
          <X className="h-3.5 w-3.5 opacity-60" />
        </button>
      ))}

      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  )
}
