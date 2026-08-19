// Project picker for the note composer's destination — the "which project is
// this note about" half of `<project>/<kind folder>`.
//
// It replaced a cloud of hand-saved quick-destination chips (2026-08-19). Those
// chips were flat whole-path snapshots, and their labels gave the game away:
// "sfdl thoughts", "F9 thoughts", "sfw airms meetings" — a user rebuilding
// project + note type by hand because the UI had no way to say it structurally.
// The list the user already maintains in Settings is that structure.
//
// Rows, not chips. Seventeen chips is a ragged cloud you aim at; seventeen rows
// with a search field is a list you type at. The row carries the folder path
// under the name because two projects can read alike and the path is the thing
// actually being chosen.
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { configuredVaultNameBlock } from '@/services/lego_blocks/units/vaultNameBlock'
import type { ProjectDestinationBlock } from '@/services/lego_blocks/units/noteComposerBlock'

/** Past this many projects the list gets a search field. Below it, scanning is
 *  faster than typing and the field is one more thing in the way. */
const SEARCH_THRESHOLD = 8

export interface ProjectDestinationListBlockProps {
  destinations: ProjectDestinationBlock[]
  /** Key of the project the destination currently sits under; null = vault root. */
  activeKey: string | null
  onSelect: (projectKey: string | null) => void
  /** Finger-sized rows and a larger type scale. */
  touch?: boolean
  className?: string
  listClassName?: string
}

export default function ProjectDestinationListBlock({
  destinations,
  activeKey,
  onSelect,
  touch = false,
  className,
  listClassName,
}: ProjectDestinationListBlockProps) {
  const [query, setQuery] = useState('')
  const showSearch = destinations.length > SEARCH_THRESHOLD
  // The vault has a name — the folder the user chose — and using it beats "No
  // project", which named the absence rather than the place. Every other row on
  // this list is a place; this one should be too.
  const vaultName = useMemo(() => configuredVaultNameBlock() ?? 'Vault', [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return destinations
    // Name, key and path all match: the name is what you read, the key is what
    // you type from muscle memory, and the path is how you find the one project
    // whose display name says nothing about where it lives.
    return destinations.filter(destination =>
      destination.name.toLowerCase().includes(needle)
      || destination.key.toLowerCase().includes(needle)
      || destination.segments.join('/').toLowerCase().includes(needle),
    )
  }, [destinations, query])

  const rowClass = (active: boolean) => cn(
    'ltm-motion-fast flex w-full items-baseline gap-2 rounded-lg px-2.5 text-left transition-colors',
    touch ? 'min-h-[44px] py-2 text-sm' : 'py-1.5 text-[13px]',
    active ? 'bg-foreground text-background' : 'hover:bg-muted',
  )

  return (
    <div className={cn('space-y-1.5', className)}>
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className={cn(
              'w-full rounded-lg border border-input bg-background pl-8 pr-2.5 outline-none transition-colors focus:border-foreground/30',
              touch ? 'h-10 text-sm' : 'h-8 text-xs',
            )}
          />
        </div>
      )}

      <div className={cn('min-h-0 overflow-auto', listClassName ?? 'max-h-[13rem]')}>
        {/* The vault itself is a real answer, not the empty state: "this note is
            not project work" is a thing people mean, and it is the composer's
            default. Pinned above the search results because it is never what you
            are searching *for*. */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={rowClass(activeKey === null)}
        >
          <span className="shrink-0 font-medium">{vaultName}</span>
          <span className={cn(
            'truncate font-mono text-[11px]',
            activeKey === null ? 'opacity-70' : 'text-muted-foreground',
          )}>
            vault root
          </span>
        </button>

        {filtered.map(destination => {
          const active = destination.key === activeKey
          return (
            <button
              key={destination.key}
              type="button"
              onClick={() => onSelect(destination.key)}
              title={destination.segments.join('/')}
              className={rowClass(active)}
            >
              <span className="shrink-0 font-medium">{destination.name}</span>
              <span className={cn(
                'truncate font-mono text-[11px]',
                active ? 'opacity-70' : 'text-muted-foreground',
              )}>
                {destination.segments.join('/')}
              </span>
            </button>
          )
        })}

        {filtered.length === 0 && (
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
            No project matches “{query.trim()}”.
          </div>
        )}
      </div>

      {destinations.length === 0 && (
        // Not an error: a fresh vault has no projects, and every project may be
        // rooted outside the vault (a code checkout), which cannot hold notes.
        // Either way Explorer is the way through, so say so rather than showing
        // an empty box.
        <div className="px-2.5 pb-1 text-[11px] leading-relaxed text-muted-foreground">
          No projects with a vault folder yet. Add one in Settings, or use Browse
          to pick any folder.
        </div>
      )}
    </div>
  )
}
