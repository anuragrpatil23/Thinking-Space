import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
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
  /** Position within the section, for the shared border palette. */
  colorIndex: number
}

export default function OrganizerNoteRowBlock({ entry, colorIndex }: Props) {
  const { note, fedInto, producedBy } = entry
  const engaged = Boolean(fedInto || producedBy)

  const link = fedInto
    ? { arrow: '→', label: fedInto.title }
    : producedBy
      ? { arrow: '←', label: producedBy.title }
      : null

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      leadGlyph={
        <span
          className={engaged ? 'text-foreground/70' : 'text-muted-foreground/50'}
          title={engaged ? 'Engaged — it fed or came from a doing' : 'Untouched'}
          aria-hidden
        >
          {engaged ? '◆' : '◇'}
        </span>
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
