import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import type { NoteEntry } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One note (from the old organizer) — a question, idea, missed idea, company to
// watch, or learning — rendered through the shared row shell, so it reads as one
// language with the undertakings. Its `F9-…` ID chip earns its place here (the
// head is a long sentence; the handle is worth showing). A standing note that
// fed an undertaking carries a `→ what it fed` link, since it stays in its
// section rather than migrating away.

interface Props {
  entry: NoteEntry
  /** Position within the section, for the shared border palette. */
  colorIndex: number
}

export default function OrganizerNoteRowBlock({ entry, colorIndex }: Props) {
  const { note, fedInto } = entry

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      idBadge={note.key.toUpperCase()}
      title={note.title}
      rightSlot={
        fedInto ? (
          <span
            className="max-w-[16rem] truncate text-[11px] text-muted-foreground/60"
            title={`Fed: ${fedInto.title}`}
          >
            → {fedInto.title}
          </span>
        ) : undefined
      }
    />
  )
}
