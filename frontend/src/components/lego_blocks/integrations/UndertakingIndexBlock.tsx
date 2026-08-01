import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import UndertakingIndexRowBlock from '@/components/lego_blocks/units/UndertakingIndexRowBlock'
import OrganizerNoteRowBlock from '@/components/lego_blocks/units/OrganizerNoteRowBlock'
import OrganizerFilterBarBlock, {
  ORGANIZER_STRIP_PILL,
} from '@/components/lego_blocks/units/OrganizerFilterBarBlock'
import OrganizerSectionManagerBlock from '@/components/lego_blocks/integrations/OrganizerSectionManagerBlock'
import { organizerSectionColorBlock } from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import DensityAxisBlock, {
  densityAxisTicksBlock,
} from '@/components/lego_blocks/units/DensityAxisBlock'
import {
  collectFilterGroupsBlock,
  noteEntryAttrsBlock,
  rowMatchesFiltersBlock,
  undertakingRowAttrsBlock,
  type OrganizerFilter,
} from '@/services/lego_blocks/units/organizerIndexFilterBlock'
import { useUndertakingIndexBlock } from '@/components/lego_blocks/hooks/units/useUndertakingIndexBlock'
import type { LinkedUndertakings } from '@/components/lego_blocks/units/UndertakingIndexRowBlock'
import type { NoteRef } from '@/services/orchestrators/aiActivityUndertakingOrch'

// The Thinking Organizer index view: undertakings and notes grouped under their
// section headings, one dense line each — a *view* over the derived index. The
// filter bar narrows the rows by attribute (year, kind, tag, state) without
// regrouping: kind stays the section spine.

interface Props {
  /** The ai-activity project id (today the basename of the project root; the
   *  registry will canonicalize this — D9). Null renders the empty state. */
  projectId: string | null
  onOpenUndertaking?: (key: string) => void
  onOpenNote?: (key: string) => void
}

// A block's header row: the section name at one end, its ruler at the other,
// both sitting on the block's top edge. Stacked instead — heading, then ruler,
// then block — the ruler wedged a band between a heading and the rows it names,
// leaving the heading floating equidistant between two blocks.
//
// Headings are the list's structure, so they need weight — but uppercase was
// the wrong way to buy it. A section name is a name ("Company Studies"), and
// setting names in caps costs the word shape you actually read by while adding
// a label-ish register the rows below don't share. Size, weight, and the
// section's own colour carry it instead.
function SectionHeader({
  title,
  colorIndex,
  axis,
}: {
  title: string
  colorIndex: number
  axis?: ReactNode
}) {
  return (
    <div
      className="flex items-end justify-between gap-4"
      style={axis ? { paddingRight: STRIP_RIGHT_OFFSET } : undefined}
    >
      <h2
        className={cn(
          // The padding is on the heading, not the row: `items-end` keeps the
          // ruler's ticks flush against the block's top border while the name
          // lifts clear of it.
          'px-1.5 pb-2.5 text-[16px] font-semibold leading-none tracking-[-0.01em]',
          organizerSectionColorBlock(colorIndex).text,
        )}
      >
        {title}
      </h2>
      {axis}
    </div>
  )
}

// The strip column's geometry, restated so the ruler can sit exactly over it:
// the strip is 24 buckets × 4px, and to its right the row keeps the w-14
// duration (56px), the gap-2 between them (8px), and its own pr-3 (12px).
const STRIP_WIDTH = 96
const STRIP_RIGHT_OFFSET = 56 + 8 + 12

export default function UndertakingIndexBlock({ projectId, onOpenUndertaking, onOpenNote }: Props) {
  const { index, loading, error, reload } = useUndertakingIndexBlock(projectId)
  const [filters, setFilters] = useState<OrganizerFilter[]>([])
  const [managingSections, setManagingSections] = useState(false)
  // One row's inline peek open at a time — expansion is a peek, not a mode, and
  // several open at once is the density failure the index exists to avoid.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const toggleExpand = useCallback((key: string) => {
    setExpandedKey(prev => (prev === key ? null : key))
  }, [])

  const groups = useMemo(() => (index ? collectFilterGroupsBlock(index) : []), [index])

  // Every strip in the list spans the same window, so the axis is the same for
  // every row — naming it per row is impossible in 96px and would be 200 copies
  // of one fact. It is stated once above the list; the rows repeat only its
  // gridlines, which is what makes a mark's *position* mean a date.
  const axisTicks = useMemo(
    () => (index?.windowStart && index.windowEnd
      ? densityAxisTicksBlock(index.windowStart, index.windowEnd)
      : []),
    [index?.windowStart, index?.windowEnd],
  )
  const gridlines = useMemo(() => axisTicks.map(t => t.at), [axisTicks])

  // The link graph, resolved once: a row's parents are the undertakings it grew
  // out of; its children are the undertakings that grew out of it (the reverse
  // edge). Titles resolve against the whole index, so a link to a currently
  // filtered-out row still reads as a title, not a bare key.
  const linkedByKey = useMemo(() => {
    const titleByKey = new Map<string, string>()
    const childrenByKey = new Map<string, NoteRef[]>()
    if (index) {
      for (const section of index.sections) {
        for (const { record } of section.rows) titleByKey.set(record.key, record.title || record.head || record.key)
      }
      for (const section of index.sections) {
        for (const { record } of section.rows) {
          for (const parent of record.grewOutOf) {
            const list = childrenByKey.get(parent) ?? []
            list.push({ key: record.key, title: titleByKey.get(record.key) ?? record.key })
            childrenByKey.set(parent, list)
          }
        }
      }
    }
    const resolve = (key: string): LinkedUndertakings => ({
      parents: (index?.sections.flatMap(s => s.rows).find(r => r.record.key === key)?.record.grewOutOf ?? [])
        .map(k => ({ key: k, title: titleByKey.get(k) ?? k })),
      children: childrenByKey.get(key) ?? [],
    })
    return resolve
  }, [index])

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
      {/* Sections rides the filter strip's own row rather than a sibling
          container beside it. Parked outside it was a differently-shaped
          control floating at a different height with nothing to belong to; in
          the strip it shares the pills' geometry and baseline, and its distance
          from them (pushed to the far end) is what says it acts on the list
          rather than filtering it. */}
      <OrganizerFilterBarBlock
        groups={groups}
        active={filters}
        onToggle={toggle}
        trailing={
          projectId ? (
            <button
              type="button"
              onClick={() => setManagingSections(v => !v)}
              className={cn(
                'ltm-motion-fast',
                ORGANIZER_STRIP_PILL,
                managingSections
                  ? 'border-transparent bg-foreground text-background hover:bg-foreground/90'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Create, rename, reorder, or delete sections"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Sections
            </button>
          ) : undefined
        }
      />

      {projectId && managingSections && (
        <div className="mt-4">
          <OrganizerSectionManagerBlock projectId={projectId} onChanged={reload} />
        </div>
      )}

      {nothingMatches ? (
        <p className="px-2 pb-8 pt-12 text-sm text-muted-foreground/70">Nothing matches these filters.</p>
      ) : (
        /* A heading sits right on its own block, so the gap *between* blocks
           has to be clearly bigger than that — otherwise a heading reads as
           equidistant from the block above and the one it names. The strip
           above owns no bottom margin, so this one `mt-8` is the whole gap
           between chrome and content: the boundary the eye needs most, and
           the one the first heading was previously starved of. */
        <div className="mt-8 space-y-7">
          {undertakingSections.map(section => (
            <section key={section.key}>
              {/* The ruler seats on the row block's top border, ticks running
                  down to meet it — the same edge the tracks below start from.
                  Every block with tracks gets one: stated only above the first,
                  it read as a header for the whole page, and by the third
                  section you were scrolling marks with the axis off-screen. */}
              <SectionHeader
                title={section.title}
                colorIndex={section.colorIndex}
                axis={
                  axisTicks.length > 0 ? (
                    <DensityAxisBlock ticks={axisTicks} width={STRIP_WIDTH} />
                  ) : undefined
                }
              />
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
                {section.rows.map((row, i) => (
                  <UndertakingIndexRowBlock
                    key={row.record.key}
                    row={row}
                    projectId={projectId}
                    colorIndex={section.colorIndex}
                    ordinal={i + 1}
                    expanded={expandedKey === row.record.key}
                    onToggle={() => toggleExpand(row.record.key)}
                    onOpenDrawer={onOpenUndertaking}
                    linked={linkedByKey(row.record.key)}
                    gridlines={gridlines}
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
              <SectionHeader title={section.title} colorIndex={section.colorIndex} />
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
                {section.notes.map((entry, i) => (
                  <OrganizerNoteRowBlock
                    key={entry.note.key}
                    entry={entry}
                    colorIndex={section.colorIndex}
                    ordinal={i + 1}
                    onOpenUndertaking={onOpenUndertaking}
                    onOpen={onOpenNote}
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
