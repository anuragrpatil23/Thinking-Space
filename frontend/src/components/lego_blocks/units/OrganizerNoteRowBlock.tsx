import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import { noteIsReferenceBlock } from '@/services/lego_blocks/units/aiActivityNoteBlock'
import type { NoteEntry } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One note (from the old organizer) — a question, idea, missed idea, company to
// watch, or learning — through the shared row shell. The leading glyph is the
// note's engagement state: ◇ untouched (the wake list) or ◆ engaged (it fed a
// doing or was produced by one). The right slot links to that doing — `→` for
// what it fed, `←` for what produced it. Its own tags (the confidence grid)
// render as the same coloured pills the undertakings and the List use. The ID
// now lives on the detail page, not the row.

interface Props {
  entry: NoteEntry
  /** The section's palette slot (shared by all rows in the grouping). */
  colorIndex: number
  /** 1-based row number within the section. */
  ordinal: number
}

export default function OrganizerNoteRowBlock({ entry, colorIndex, ordinal }: Props) {
  const { note, fedInto, producedBy } = entry
  const engaged = Boolean(fedInto || producedBy)
  // Reference kinds (captured knowledge) never wear the open/engaged glyph.
  const showGlyph = !noteIsReferenceBlock(note.categoryCode)

  const link = fedInto
    ? { arrow: '→', label: fedInto.title }
    : producedBy
      ? { arrow: '←', label: producedBy.title }
      : null

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      ordinal={ordinal}
      leadGlyph={
        showGlyph ? (
          <span
            className={engaged ? 'text-foreground/70' : 'text-muted-foreground/50'}
            title={engaged ? 'Engaged — it fed or came from a doing' : 'Untouched'}
            aria-hidden
          >
            {engaged ? '◆' : '◇'}
          </span>
        ) : undefined
      }
      title={note.title}
      tags={note.tags}
      rightSlot={
        link ? (
          <span
            className="max-w-[16rem] truncate text-[11px] text-muted-foreground/60"
            title={`${link.arrow} ${link.label}`}
          >
            {link.arrow} {link.label}
          </span>
        ) : undefined
      }
    />
  )
}
