export interface SectionData {
  name: string
  created: number
  modified: number
}

/** Generic metric shown as a colored label inside a tag chip. */
export interface TagMetric {
  label: string
  value: number
  color: string // tailwind text color class e.g. "text-emerald-600 dark:text-emerald-400"
}

export interface TagSelectorItem {
  name: string
  metrics: TagMetric[]
}

interface SingleSelectProps {
  items: TagSelectorItem[]
  loading?: boolean
  multiSelect?: false
  selected?: string | null
  onSelect?: (name: string | null) => void
}

interface MultiSelectProps {
  items: TagSelectorItem[]
  loading?: boolean
  multiSelect: true
  selected?: string[]
  onSelect?: (names: string[]) => void
}

type TagSelectorProps = SingleSelectProps | MultiSelectProps

/**
 * General-purpose tag/chip selector grid.
 * Each item shows a name and colored metric values.
 * Clicking toggles selection.
 *
 * Supports both single-select (default) and multi-select modes.
 */
export default function SectionBreakdown(props: TagSelectorProps) {
  const { items, loading = false } = props

  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted/30 animate-pulse h-8 w-20" />
        ))}
      </div>
    )
  }

  if (items.length === 0) return null

  const isMulti = props.multiSelect === true

  const isSelected = (name: string): boolean => {
    if (isMulti) {
      return (props.selected as string[] | undefined)?.includes(name) ?? false
    }
    return (props.selected as string | null | undefined) === name
  }

  const hasAnySelection = isMulti
    ? ((props.selected as string[] | undefined)?.length ?? 0) > 0
    : (props.selected as string | null | undefined) != null

  const clickable = !!props.onSelect

  const handleClick = (name: string) => {
    if (!clickable) return

    if (isMulti) {
      const onSelect = props.onSelect as (names: string[]) => void
      const current = (props.selected as string[] | undefined) ?? []
      if (current.includes(name)) {
        onSelect(current.filter(s => s !== name))
      } else {
        onSelect([...current, name])
      }
    } else {
      const onSelect = props.onSelect as (name: string | null) => void
      const sel = props.selected as string | null | undefined
      onSelect(sel === name ? null : name)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => {
        const hasMetrics = item.metrics.some(m => m.value > 0)
        if (!hasMetrics) return null
        const sel = isSelected(item.name)
        const isDimmed = hasAnySelection && !sel

        return (
          <button
            key={item.name}
            type="button"
            onClick={() => handleClick(item.name)}
            className={`
              inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-all
              ${clickable ? 'cursor-pointer hover:border-foreground/30' : 'cursor-default'}
              ${sel
                ? 'ring-1 ring-primary border-primary/50 bg-primary/5'
                : isDimmed
                  ? 'border-border/20 bg-muted/10 opacity-40'
                  : 'border-border/30 bg-muted/20 hover:bg-muted/30'
              }
            `}
          >
            <span className="text-sm font-medium truncate max-w-[120px]" title={item.name}>
              {item.name}
            </span>
            <span className="flex items-center gap-1.5 text-xs tabular-nums">
              {item.metrics.map(m => m.value > 0 && (
                <span key={m.label} className={`${m.color} font-medium`}>
                  {m.label}
                </span>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Convenience adapter: converts SectionData[] to TagSelectorItem[]
// ---------------------------------------------------------------------------

export function sectionsToTagItems(sections: SectionData[]): TagSelectorItem[] {
  return sections.map(s => ({
    name: s.name,
    metrics: [
      { label: `+${s.created}`, value: s.created, color: 'text-emerald-600 dark:text-emerald-400' },
      { label: `${s.modified} mod`, value: s.modified, color: 'text-blue-600 dark:text-blue-400' },
    ],
  }))
}
