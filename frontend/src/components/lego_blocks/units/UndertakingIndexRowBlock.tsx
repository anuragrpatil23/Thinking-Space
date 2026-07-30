import { cn } from '@/lib/utils'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import type { UndertakingIndexRow } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One index entry, one line. The book-index discipline: title, tags, sparkline,
// pointer count — nothing else. Many visible at once, scannable in seconds. The
// trail (the "page" behind the entry) is a drilldown, never shown inline; an
// earlier design that put the whole trail on every row made each entry a
// chapter, which is the density failure this view exists to fix.
//
// Tags render in two weights: Anurag's `tags` are solid (authoritative);
// `proposedTags` are ghosted (Kai's guesses, pending promotion). Showing the
// difference is what lets a glance trust which is which. Promotion / rejection
// is a separate affordance (G14), not here.

interface Props {
  row: UndertakingIndexRow
  onOpen?: (key: string) => void
}

export default function UndertakingIndexRowBlock({ row, onOpen }: Props) {
  const { record, tail, buckets } = row
  const pointerCount = tail.files.length

  return (
    <button
      type="button"
      onClick={() => onOpen?.(record.key)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left',
        'hover:bg-accent/60 focus:bg-accent/60 focus:outline-none',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={record.title}>
        {record.title || record.head || '(untitled undertaking)'}
      </span>

      {(record.tags.length > 0 || record.proposedTags.length > 0) && (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {record.tags.map(tag => (
            <span
              key={`t-${tag}`}
              className="rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-none text-foreground/80"
            >
              {tag}
            </span>
          ))}
          {record.proposedTags.map(tag => (
            <span
              key={`p-${tag}`}
              className="rounded-full border border-dashed border-border/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground/70"
              title="Proposed by Kai — not yet confirmed"
            >
              {tag}
            </span>
          ))}
        </span>
      )}

      <DensitySparklineBlock buckets={buckets} className="shrink-0" />

      <span
        className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70"
        title={`${pointerCount} file pointer${pointerCount === 1 ? '' : 's'}`}
      >
        {pointerCount > 0 ? pointerCount : '·'}
      </span>
    </button>
  )
}
