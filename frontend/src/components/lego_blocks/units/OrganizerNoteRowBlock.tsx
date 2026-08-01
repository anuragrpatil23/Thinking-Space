import { cn } from '@/lib/utils'
import OrganizerRowShellBlock from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import { noteIsReferenceBlock } from '@/services/lego_blocks/units/aiActivityNoteBlock'
import { noteAgeLabelBlock } from '@/services/lego_blocks/units/noteAgeBlock'
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
  /** Open the drawer for the undertaking on the other end of this note's link.
   *  Without it the link renders as plain text, as it always did. */
  onOpenUndertaking?: (key: string) => void
}

export default function OrganizerNoteRowBlock({
  entry,
  colorIndex,
  ordinal,
  onOpenUndertaking,
}: Props) {
  const { note, fedInto, producedBy } = entry
  const engaged = Boolean(fedInto || producedBy)
  // Reference kinds (captured knowledge) never wear the open/engaged glyph.
  const showGlyph = !noteIsReferenceBlock(note.categoryCode)

  const link = fedInto
    ? { arrow: '→', label: fedInto.title, key: fedInto.key }
    : producedBy
      ? { arrow: '←', label: producedBy.title, key: producedBy.key }
      : null

  // Notes sort by when they were opened, so a row with no age was in a
  // meaningful order with nothing on screen saying what that order was.
  const age = noteAgeLabelBlock(note.openedDate)

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
        <>
          {/* The link is the one live thing on a note row — it names the doing
              that consumed or produced this note, and as plain text it made
              half the index a dead end: you could read the edge but not
              follow it. `stopPropagation` so it stays its own target if the
              row ever becomes clickable. */}
          {link &&
            (onOpenUndertaking ? (
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation()
                  onOpenUndertaking(link.key)
                }}
                className="max-w-[16rem] truncate text-[11px] text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline"
                title={`${link.arrow} ${link.label}`}
              >
                {link.arrow} {link.label}
              </button>
            ) : (
              <span
                className="max-w-[16rem] truncate text-[11px] text-muted-foreground/60"
                title={`${link.arrow} ${link.label}`}
              >
                {link.arrow} {link.label}
              </span>
            ))}
          {/* Same width as the undertaking row's duration, so the two kinds of
              row share one right edge instead of ending wherever they happen
              to end. */}
          <span
            className={cn(
              'w-14 text-right text-xs tabular-nums text-muted-foreground/60',
              !age && 'invisible',
            )}
            title={note.openedDate ? `Opened ${note.openedDate}` : undefined}
          >
            {age || '—'}
          </span>
        </>
      }
    />
  )
}
