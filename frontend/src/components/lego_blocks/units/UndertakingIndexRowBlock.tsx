import { cn } from '@/lib/utils'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import { parseConfidenceTagsBlock } from '@/services/lego_blocks/units/confidenceTagsBlock'
import type { UndertakingIndexRow } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One index entry, one line — Jira's row craft aimed at thinking instead of
// work-tracking. The layout, left to right:
//
//   ● kind-glyph · head (dominant) · confidence token + quiet tags · [gutter]
//
// Two deliberate departures from the work-tracker it borrows from:
//
//   1. No status control. The slot a Jira row spends on status is spent here on
//      an *attention gutter* — the density sparkline plus a pointer count, both
//      derived, both honest, neither needing upkeep. That swap is the whole
//      point of the redesign: measure whether you looked, not a state you have
//      to maintain. The gutter is fixed-width so it aligns down the column and
//      a flat (never-worked) strip reads at a glance against its neighbours.
//   2. No ID chip on undertakings. Their key is a slug of the title, so a chip
//      would just echo the head. The chip earns its place on *asks*, whose
//      titles are long sentences and whose `F9-IDE-E-…` handle is worth showing
//      — that lands when asks join this surface.
//
// The head is the loudest thing in the row (the doc: the head sentence is the
// product); everything else sits quiet and grey until hover. The full trail —
// the "page" behind the entry — is a drilldown, never inline.

interface Props {
  row: UndertakingIndexRow
  onOpen?: (key: string) => void
}

// Width of the attention gutter: the sparkline (24 buckets × 4px) plus the
// count, held constant so every row's gutter starts at the same x.
const GUTTER_WIDTH = 128

export default function UndertakingIndexRowBlock({ row, onOpen }: Props) {
  const { record, tail, buckets } = row
  const pointerCount = tail.files.length

  // Grid vocabulary is recognized wherever it sits (it's currently misfiled into
  // proposedTags), then the leftovers render as ordinary pills split by origin:
  // Anurag's `tags` solid (authoritative), Kai's `proposedTags` ghosted.
  const confidence = parseConfidenceTagsBlock([...record.tags, ...record.proposedTags])
  const solidTags = record.tags.filter(t => !confidence.consumed.has(t))
  const ghostTags = record.proposedTags.filter(t => !confidence.consumed.has(t))
  const hasMeta = confidence.label || solidTags.length > 0 || ghostTags.length > 0

  return (
    <button
      type="button"
      onClick={() => onOpen?.(record.key)}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left',
        'hover:bg-accent/60 focus:bg-accent/60 focus:outline-none',
      )}
    >
      {/* Kind glyph — a filled dot marks an undertaking (a doing with a trail).
          Open asks get a hollow marker when they join this surface. */}
      <span className="shrink-0 text-[7px] leading-none text-foreground/45" aria-hidden>●</span>

      {/* Head — dominant. */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={record.title}>
        {record.title || record.head || '(untitled undertaking)'}
      </span>

      {/* Confidence token + quiet tags. */}
      {hasMeta && (
        <span className="hidden shrink items-center gap-1 overflow-hidden sm:flex">
          {confidence.label && (
            <span
              className="shrink-0 rounded-sm border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground/80"
              title="Your confidence read"
            >
              ⬡ {confidence.label}
            </span>
          )}
          {solidTags.map(tag => (
            <span
              key={`t-${tag}`}
              className="shrink-0 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-none text-foreground/70"
            >
              {tag}
            </span>
          ))}
          {ghostTags.map(tag => (
            <span
              key={`p-${tag}`}
              className="shrink-0 rounded-full border border-dashed border-border/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground/60"
              title="Proposed by Kai — not yet confirmed"
            >
              {tag}
            </span>
          ))}
        </span>
      )}

      {/* Attention gutter — fixed width, right-aligned, so it forms a column. */}
      <span
        className="flex shrink-0 items-center justify-end gap-2"
        style={{ width: GUTTER_WIDTH }}
      >
        <DensitySparklineBlock buckets={buckets} />
        <span
          className="w-6 text-right text-xs tabular-nums text-muted-foreground/60"
          title={`${pointerCount} file pointer${pointerCount === 1 ? '' : 's'}`}
        >
          {pointerCount > 0 ? pointerCount : '·'}
        </span>
      </span>
    </button>
  )
}
