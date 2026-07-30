import { useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ContextMenuBlock from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import type { FilterGroup, OrganizerFilter } from '@/services/lego_blocks/units/organizerIndexFilterBlock'

// The organizer index filter bar. One dropdown per attribute (Year, Kind, Tag,
// State); picking a value toggles a filter and the view narrows (AND). Active
// filters show as black chips — the List's look — each removable. Narrow-only:
// nothing here regroups the view.

const ENGAGEMENT_LABELS: Record<string, string> = { open: 'Open', engaged: 'Engaged' }

function chipLabel(f: OrganizerFilter): string {
  return f.attr === 'engagement' ? (ENGAGEMENT_LABELS[f.value] ?? f.value) : f.value
}

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
          'inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-border hover:text-foreground',
          position !== null && 'border-border text-foreground',
        )}
      >
        {group.label}
        <ChevronDown className="h-3 w-3" />
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
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {groups.map(group => (
        <FilterDropdown key={group.attr} group={group} active={active} onToggle={onToggle} />
      ))}

      {active.length > 0 && <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />}

      {active.map(f => (
        <button
          key={`${f.attr}:${f.value}`}
          type="button"
          onClick={() => onToggle(f)}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          title="Remove filter"
        >
          {chipLabel(f)}
          <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  )
}
