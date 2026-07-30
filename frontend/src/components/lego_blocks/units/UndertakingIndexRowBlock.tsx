import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import type { UndertakingIndexRow } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One undertaking (a doing) in the index, rendered through the shared row shell
// — the List row's look, minus its work-item chrome. The head is the title; the
// tags are the same coloured pills the List uses; the attention gutter (density
// sparkline + pointer count) sits where a List row keeps its status control.
// Below the row, the migrating notes that fed this undertaking reconcile as ◆→
// sublines — the question beneath the answer, so the note→undertaking loop is
// legible. They're ◆ (filled), not ◇, because a note that fed a doing is by
// definition engaged.

interface Props {
  row: UndertakingIndexRow
  /** The section's palette slot (shared by all rows in the grouping). */
  colorIndex: number
  /** 1-based row number within the section. */
  ordinal: number
  onOpen?: (key: string) => void
}

export default function UndertakingIndexRowBlock({ row, colorIndex, ordinal, onOpen }: Props) {
  const { record, tail, buckets } = row
  const pointerCount = tail.files.length

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      ordinal={ordinal}
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
        row.fedNotes.length > 0 ? (
          <ul className="mb-0.5 ml-7 mt-px space-y-px">
            {row.fedNotes.map(note => (
              <li key={note.key} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground/60">
                <span className="shrink-0 text-muted-foreground/50" aria-hidden>◆→</span>
                <span className="truncate" title={`${note.key} — ${note.title}`}>{note.title}</span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  )
}
