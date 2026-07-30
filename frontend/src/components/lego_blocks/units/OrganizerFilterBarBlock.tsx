import { useRef, useState } from 'react'
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

// The dark charcoal pill shared by the dropdowns and the active chips.
const PILL = 'inline-flex items-center gap-2 rounded-xl bg-zinc-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-600'
const COUNT_BADGE = 'rounded-full bg-zinc-600 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-zinc-200'

interface Props {
  groups: FilterGroup[]
  active: OrganizerFilter[]
  onToggle: (f: OrganizerFilter) => void
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
        className={cn(PILL, position !== null && 'bg-zinc-600')}
      >
        <ChevronDown className="h-4 w-4 text-zinc-400" />
        {group.label}
        <span className={COUNT_BADGE}>{activeCount > 0 ? activeCount : group.values.length}</span>
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

export default function OrganizerFilterBarBlock({ groups, active, onToggle }: Props) {
  if (groups.length === 0) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {groups.map(group => (
        <FilterDropdown key={group.attr} group={group} active={active} onToggle={onToggle} />
      ))}

      {active.length > 0 && <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />}

      {active.map(f => (
        <button
          key={`${f.attr}:${f.value}`}
          type="button"
          onClick={() => onToggle(f)}
          className={PILL}
          title="Remove filter"
        >
          {chipLabel(f)}
          <X className="h-4 w-4 text-zinc-400" />
        </button>
      ))}
    </div>
  )
}
