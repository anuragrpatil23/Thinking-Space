import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import type { UndertakingIndexRow } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One undertaking (a doing) in the index, rendered through the shared row shell
// — the List row's look, minus its work-item chrome. The head is the title; the
// tags are the same coloured pills the List uses; the attention gutter (density
// sparkline + pointer count) sits where a List row keeps its status control.
// Below the row, the asks this undertaking discharged reconcile as ◇→ sublines
// — the question beneath the answer, so the ask→undertaking loop is legible.

interface Props {
  row: UndertakingIndexRow
  /** Position within the section, for the shared border palette. */
  colorIndex: number
  onOpen?: (key: string) => void
}

export default function UndertakingIndexRowBlock({ row, colorIndex, onOpen }: Props) {
  const { record, tail, buckets } = row
  const pointerCount = tail.files.length

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      title={record.title || record.head || '(untitled undertaking)'}
      tags={[...record.tags, ...record.proposedTags]}
      onClick={onOpen ? () => onOpen(record.key) : undefined}
      rightSlot={
        <>
          <DensitySparklineBlock buckets={buckets} />
          <span
            className="w-6 text-right text-xs tabular-nums text-muted-foreground/60"
            title={`${pointerCount} file pointer${pointerCount === 1 ? '' : 's'}`}
          >
            {pointerCount > 0 ? pointerCount : '·'}
          </span>
        </>
      }
      subRows={
        row.discharged.length > 0 ? (
          <ul className="mb-0.5 ml-9 mt-px space-y-px">
            {row.discharged.map(ask => (
              <li key={ask.key} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground/60">
                <span className="shrink-0 text-muted-foreground/40" aria-hidden>◇→</span>
                <span className="truncate" title={`${ask.key} — ${ask.title}`}>{ask.title}</span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  )
}
