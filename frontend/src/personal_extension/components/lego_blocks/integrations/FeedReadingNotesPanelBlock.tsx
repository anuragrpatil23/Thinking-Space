import { useMemo } from 'react'
import { MessageSquareText, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { removeFeedNoteOrch, setFeedNoteDoneOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'
import type { FeedNoteBlock } from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'
import { useFeedNotesBlock } from '../hooks/useFeedNotesBlock'
import { F9PanelBlock } from '../units/F9NativeBlock'

/** Comments and picked-up articles older than this leave the Overview (they stay in the file and in Noticed). */
const RECENT_DAYS_BLOCK = 14

/** What reading left to come back to: open questions first, then comments and tagged articles. */
export function feedNotesToShowBlock(notes: FeedNoteBlock[], now = Date.now()): FeedNoteBlock[] {
  const since = now - RECENT_DAYS_BLOCK * 86_400_000
  const live = notes.filter(n => !n.removed)
  const questions = live.filter(n => n.kind === 'question' && !n.done)
  const rest = live.filter(n => n.kind !== 'question' && !n.done && Date.parse(n.at) >= since)
  const newest = (a: FeedNoteBlock, b: FeedNoteBlock) => Date.parse(b.at) - Date.parse(a.at)
  return [...questions.sort(newest), ...rest.sort(newest)]
}

export function FeedReadingNotesPanelBlock({ feeds, onOpenItem }: { feeds: RssFeedResultBlock[]; onOpenItem: (item: RssFeedItemBlock) => void }) {
  const notes = useFeedNotesBlock()
  const shown = useMemo(() => feedNotesToShowBlock(notes).slice(0, 12), [notes])
  const itemsById = useMemo(() => {
    const ids = new Set(shown.map(n => n.itemId))
    return new Map(feeds.flatMap(f => f.items).filter(i => ids.has(i.id)).map(i => [i.id, i]))
  }, [feeds, shown])
  if (shown.length === 0) return null

  return (
    <F9PanelBlock className="px-4 py-3.5 text-[13px]">
      <p className="font-semibold">From your reading</p>
      <p className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">Press Q or C while reading to add one</p>
      {shown.map((note, index) => {
        const item = itemsById.get(note.itemId)
        return (
          <div key={note.id} className={cn('group flex items-start gap-2.5 py-2', index > 0 && 'border-t border-zinc-200/80 dark:border-zinc-800')}>
            {note.kind === 'question' ? (
              <button
                type="button"
                onClick={() => { void setFeedNoteDoneOrch(note.id, true) }}
                title="Mark understood"
                className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-400 hover:border-emerald-500 hover:bg-emerald-50"
              />
            ) : note.kind === 'comment'
              ? <MessageSquareText className="mt-[3px] h-3.5 w-3.5 shrink-0 text-zinc-400" />
              : <Tag className="mt-[3px] h-3.5 w-3.5 shrink-0 text-zinc-400" />}
            <span className="min-w-0 flex-1">
              <span className="block leading-snug text-zinc-800 dark:text-zinc-100">
                {note.kind === 'tagged' && <span className="mr-1.5 rounded bg-zinc-100 px-1 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{note.tag}</span>}
                {note.text}
              </span>
              {note.kind !== 'tagged' && (
                <button
                  type="button"
                  disabled={!item}
                  onClick={() => item && onOpenItem(item)}
                  className="mt-0.5 block max-w-full truncate text-left text-[11px] text-zinc-500 enabled:hover:text-zinc-800 dark:text-zinc-400"
                  title={note.title}
                >
                  {note.ticker ? `${note.ticker} · ` : ''}{note.title}
                </button>
              )}
              {note.kind === 'tagged' && (
                <button type="button" disabled={!item} onClick={() => item && onOpenItem(item)} className="mt-0.5 block text-[11px] text-zinc-500 enabled:hover:text-zinc-800 dark:text-zinc-400">
                  {note.ticker ? `${note.ticker} · ` : ''}{note.source}
                </button>
              )}
            </span>
            <button type="button" onClick={() => { void removeFeedNoteOrch(note.id) }} title="Remove" className="opacity-0 transition-opacity group-hover:opacity-100">
              <X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-700" />
            </button>
          </div>
        )
      })}
    </F9PanelBlock>
  )
}
