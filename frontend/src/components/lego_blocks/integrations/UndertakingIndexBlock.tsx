import { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import UndertakingIndexRowBlock from '@/components/lego_blocks/units/UndertakingIndexRowBlock'
import OrganizerNoteRowBlock from '@/components/lego_blocks/units/OrganizerNoteRowBlock'
import OrganizerFilterBarBlock from '@/components/lego_blocks/units/OrganizerFilterBarBlock'
import { organizerSectionColorBlock } from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import {
  collectFilterGroupsBlock,
  noteEntryAttrsBlock,
  rowMatchesFiltersBlock,
  undertakingRowAttrsBlock,
  type OrganizerFilter,
} from '@/services/lego_blocks/units/organizerIndexFilterBlock'
import { useUndertakingIndexBlock } from '@/components/lego_blocks/hooks/units/useUndertakingIndexBlock'

// The Thinking Organizer index view: undertakings and notes grouped under their
// section headings, one dense line each — a *view* over the derived index. The
// filter bar narrows the rows by attribute (year, kind, tag, state) without
// regrouping: kind stays the section spine.

interface Props {
  /** The ai-activity project id (today the basename of the project root; the
   *  registry will canonicalize this — D9). Null renders the empty state. */
  projectId: string | null
  onOpenUndertaking?: (key: string) => void
}

const HEADING = 'mb-1.5 px-2 text-[13px] font-bold uppercase tracking-[0.1em]'

export default function UndertakingIndexBlock({ projectId, onOpenUndertaking }: Props) {
  const { index, loading, error } = useUndertakingIndexBlock(projectId)
  const [filters, setFilters] = useState<OrganizerFilter[]>([])

  const groups = useMemo(() => (index ? collectFilterGroupsBlock(index) : []), [index])

  const toggle = useCallback((f: OrganizerFilter) => {
    setFilters(prev =>
      prev.some(x => x.attr === f.attr && x.value === f.value)
        ? prev.filter(x => !(x.attr === f.attr && x.value === f.value))
        : [...prev, f],
    )
  }, [])

  // Narrow each section, keeping a stable per-section colour (indexed over the
  // full order so filtering never recolours a section), and drop empties.
  const { undertakingSections, noteSections } = useMemo(() => {
    const uts: Array<{ key: string; title: string; colorIndex: number; rows: NonNullable<typeof index>['sections'][number]['rows'] }> = []
    const nts: Array<{ code: string; title: string; colorIndex: number; notes: NonNullable<typeof index>['noteSections'][number]['notes'] }> = []
    if (!index) return { undertakingSections: uts, noteSections: nts }
    let colorIndex = 0
    for (const section of index.sections) {
      const c = colorIndex++
      const rows = section.rows.filter(row =>
        rowMatchesFiltersBlock(undertakingRowAttrsBlock(row, section.title), filters),
      )
      if (rows.length) uts.push({ key: section.key, title: section.title, colorIndex: c, rows })
    }
    for (const section of index.noteSections) {
      const c = colorIndex++
      const notes = section.notes.filter(entry =>
        rowMatchesFiltersBlock(noteEntryAttrsBlock(entry, section.title), filters),
      )
      if (notes.length) nts.push({ code: section.code, title: section.title, colorIndex: c, notes })
    }
    return { undertakingSections: uts, noteSections: nts }
  }, [index, filters])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading index…
      </div>
    )
  }
  if (error) {
    return <div className="px-2 py-8 text-sm text-destructive">Could not load the index: {error}</div>
  }
  if (!index || (index.sections.length === 0 && index.noteSections.length === 0)) {
    return (
      <div className="px-2 py-8 text-sm text-muted-foreground/70">
        No undertakings yet. They fill in as sessions get filed at the end-of-session ask.
      </div>
    )
  }

  const nothingMatches = undertakingSections.length === 0 && noteSections.length === 0

  return (
    <div>
      <OrganizerFilterBarBlock groups={groups} active={filters} onToggle={toggle} />

      {nothingMatches ? (
        <p className="px-2 py-8 text-sm text-muted-foreground/70">Nothing matches these filters.</p>
      ) : (
        <div className="space-y-5">
          {undertakingSections.map(section => (
            <section key={section.key}>
              <h2 className={cn(HEADING, organizerSectionColorBlock(section.colorIndex).text)}>
                {section.title}
              </h2>
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
                {section.rows.map((row, i) => (
                  <UndertakingIndexRowBlock
                    key={row.record.key}
                    row={row}
                    colorIndex={section.colorIndex}
                    ordinal={i + 1}
                    onOpen={onOpenUndertaking}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Plain divider between the two taxonomies — doings above, notes below. */}
          {undertakingSections.length > 0 && noteSections.length > 0 && (
            <div className="border-t border-border/50" aria-hidden />
          )}

          {noteSections.map(section => (
            <section key={`note-${section.code}`}>
              <h2 className={cn(HEADING, organizerSectionColorBlock(section.colorIndex).text)}>
                {section.title}
              </h2>
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
                {section.notes.map((entry, i) => (
                  <OrganizerNoteRowBlock
                    key={entry.note.key}
                    entry={entry}
                    colorIndex={section.colorIndex}
                    ordinal={i + 1}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
