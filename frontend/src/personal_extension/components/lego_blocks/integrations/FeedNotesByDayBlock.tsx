import { useState, type ReactNode } from 'react'
import { ChevronRight, MessageSquareText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { rssDayLabelBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { removeFeedNoteOrch, removeFeedNotesOrch, setFeedNoteDoneOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'
import type { FeedNoteArticleBlock } from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'

/**
 * What reading left behind, by day: one row per article with its tags, and
 * its questions and comments under it. The newest `openDays` days are open;
 * older ones fold to a line. × on a question or comment takes just that one;
 * × on the article takes its tags away (the questions stay).
 */
export function FeedNotesByDayBlock({ days, openDays = 2, onOpenArticle, articleActions, dense = false }: {
  days: Array<{ day: string; articles: FeedNoteArticleBlock[] }>
  openDays?: number
  /** Opens the article when it is still in the feed; null when it is not */
  onOpenArticle?: (article: FeedNoteArticleBlock) => (() => void) | null
  /** Extra actions on an article row (Noticed: Write it down) */
  articleActions?: (article: FeedNoteArticleBlock) => ReactNode
  /** The Overview's side column */
  dense?: boolean
}) {
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const toggle = (day: string) => setToggled(prev => {
    const next = new Set(prev)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    return next
  })

  return (
    <div>
      {days.map(({ day, articles }, index) => {
        const open = (index < openDays) !== toggled.has(day)
        return (
          <div key={day}>
            <button
              type="button"
              onClick={() => toggle(day)}
              className={cn('flex w-full items-center gap-1.5 py-2 text-left text-[12px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200', index > 0 && 'border-t border-zinc-200/80 dark:border-zinc-800', dense ? '' : 'px-5')}
            >
              <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
              {rssDayLabelBlock(day)}
              <span className="font-normal tabular-nums text-zinc-400">{articles.length}</span>
            </button>
            {open && articles.map(article => {
              const openArticle = onOpenArticle?.(article) ?? null
              return (
                <div key={article.itemId || article.notes[0].id} className={cn('group pb-2.5 pt-1', dense ? 'pl-[18px]' : 'pl-[38px] pr-5')}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={!openArticle}
                        onClick={() => openArticle?.()}
                        className="block text-left leading-snug text-zinc-900 enabled:hover:underline disabled:cursor-default dark:text-zinc-100"
                      >
                        {article.title}
                      </button>
                      <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {article.tags.map(tag => (
                          <span key={tag.id} className="rounded bg-zinc-100 px-1 py-px text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{tag.tag}</span>
                        ))}
                        <span className="min-w-0 truncate">{article.ticker ? `${article.ticker} · ` : ''}{article.source}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      {articleActions?.(article)}
                      {article.tags.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { void removeFeedNotesOrch(article.tags.map(t => t.id)) }}
                          title="Remove from here (the article's questions and comments stay)"
                          className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-700" />
                        </button>
                      )}
                    </span>
                  </div>
                  {[...article.questions, ...article.comments].map(note => (
                    <div key={note.id} className="group/note mt-1.5 flex items-start gap-2 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-200">
                      {note.kind === 'question' ? (
                        <button
                          type="button"
                          onClick={() => { void setFeedNoteDoneOrch(note.id, true) }}
                          title="Mark understood"
                          className="mt-[2px] h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-400 hover:border-emerald-500 hover:bg-emerald-50"
                        />
                      ) : <MessageSquareText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                      <span className="min-w-0 flex-1">{note.text}</span>
                      <button type="button" onClick={() => { void removeFeedNoteOrch(note.id) }} title="Remove" className="opacity-0 transition-opacity group-hover/note:opacity-100">
                        <X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-700" />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
