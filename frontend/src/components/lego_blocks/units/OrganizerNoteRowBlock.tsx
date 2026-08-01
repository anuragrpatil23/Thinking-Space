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
  /** Open this note's own drawer. Without it the row is inert — which is what
   *  it was before the note drawer existed. */
  onOpen?: (key: string) => void
}

export default function OrganizerNoteRowBlock({
  entry,
  colorIndex,
  ordinal,
  onOpenUndertaking,
  onOpen,
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

  // The age answers one question — "how long has this been sitting unanswered"
  // — so it is only shown where that question exists: an open loop nobody has
  // acted on. A reference kind (a learning, a lesson, a thing to remember) has
  // no lifecycle to be late in, and a note that already fed a doing has been
  // answered; on those rows a number just reads as an accusation about a record
  // doing exactly what it is for. The column stays reserved so the rows keep
  // one right edge.
  const age = engaged || !showGlyph ? '' : noteAgeLabelBlock(note.openedDate)

  return (
    <OrganizerRowShellBlock
      onClick={onOpen ? () => onOpen(note.key) : undefined}
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
              follow it. `stopPropagation` because the row itself opens this
              note's drawer — the link goes the other way, to the doing.
              It gets a fixed column rather than sitting wherever the tags
              happen to end: left to float, the arrows landed at a different x
              on every row, so a column that says the same thing each time read
              as noise. Reserved even when empty — an arrow that shifts by row
              is worse than a gap that doesn't. */}
          <span className="hidden w-56 shrink-0 text-[11px] sm:block">
            {link &&
              (onOpenUndertaking ? (
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation()
                    onOpenUndertaking(link.key)
                  }}
                  className="block w-full truncate text-left text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  title={`${link.arrow} ${link.label}`}
                >
                  {link.arrow} {link.label}
                </button>
              ) : (
                <span className="block truncate text-muted-foreground/60" title={`${link.arrow} ${link.label}`}>
                  {link.arrow} {link.label}
                </span>
              ))}
          </span>
          {/* Same width as the undertaking row's duration, so the two kinds of
              row share one right edge instead of ending wherever they happen
              to end. */}
          <span
            className={cn(
              'w-14 text-right text-xs tabular-nums text-muted-foreground/60',
              !age && 'invisible',
            )}
            title={note.openedDate ? `Open since ${note.openedDate}` : undefined}
          >
            {age || '—'}
          </span>
        </>
      }
    />
  )
}
