import { useMemo } from 'react'
import type { RssFeedItemBlock, RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { groupFeedNotesByDayBlock } from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'
import { useFeedNotesBlock } from '../hooks/useFeedNotesBlock'
import { F9PanelBlock } from '../units/F9NativeBlock'
import { FeedNotesByDayBlock } from './FeedNotesByDayBlock'

/** Days shown on the Overview; everything stays in Noticed and the notes file. */
const OVERVIEW_DAYS_BLOCK = 5

/** The Overview's "From your reading": questions, comments and tagged articles, by day. */
export function FeedReadingNotesPanelBlock({ feeds, onOpenItem }: { feeds: RssFeedResultBlock[]; onOpenItem: (item: RssFeedItemBlock) => void }) {
  const notes = useFeedNotesBlock()
  const days = useMemo(() => groupFeedNotesByDayBlock(notes).slice(0, OVERVIEW_DAYS_BLOCK), [notes])
  const itemsById = useMemo(() => {
    const ids = new Set(days.flatMap(d => d.articles.map(a => a.itemId)))
    return new Map(feeds.flatMap(f => f.items).filter(i => ids.has(i.id)).map(i => [i.id, i]))
  }, [feeds, days])
  if (days.length === 0) return null

  return (
    <F9PanelBlock className="px-4 pb-1.5 pt-3.5 text-[13px]">
      <p className="font-semibold">From your reading</p>
      <p className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">Press Q or C while reading to add one</p>
      <FeedNotesByDayBlock
        dense
        days={days}
        openDays={1}
        onOpenArticle={(article) => {
          const item = itemsById.get(article.itemId)
          return item ? () => onOpenItem(item) : null
        }}
      />
    </F9PanelBlock>
  )
}
