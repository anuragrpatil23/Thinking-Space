import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { removeFeedNoteOrch, setFeedNoteDoneOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'
import type { FeedNoteBlock } from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'

/** "Q" or "C": which kind of note, at a glance. */
export function FeedNoteKindBadgeBlock({ kind, className }: { kind: 'question' | 'comment'; className?: string }) {
  return (
    <span
      title={kind === 'question' ? 'Question' : 'Comment'}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none',
        kind === 'question' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
        className,
      )}
    >
      {kind === 'question' ? 'Q' : 'C'}
    </span>
  )
}

/**
 * One question or comment: its badge and text, with "Understood" (questions)
 * and × on hover. Clicks stay on the line, so a row around it does not open.
 */
export function FeedNoteLineBlock({ note, className }: { note: FeedNoteBlock; className?: string }) {
  if (note.kind !== 'question' && note.kind !== 'comment') return null
  return (
    <div className={cn('group/note flex items-start gap-2 leading-snug', className)}>
      <FeedNoteKindBadgeBlock kind={note.kind} className="mt-[1px]" />
      <span className={cn('min-w-0 flex-1', note.done && 'text-zinc-400 line-through')}>{note.text}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/note:opacity-100">
        {note.kind === 'question' && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); void setFeedNoteDoneOrch(note.id, !note.done) }}
            title={note.done ? 'Open again' : 'Understood'}
            className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
          >
            <Check className="h-3 w-3" /> {note.done ? 'Reopen' : 'Understood'}
          </button>
        )}
        <button type="button" onClick={(event) => { event.stopPropagation(); void removeFeedNoteOrch(note.id) }} title="Remove" className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <X className="h-3 w-3 text-zinc-400 hover:text-zinc-700" />
        </button>
      </span>
    </div>
  )
}
