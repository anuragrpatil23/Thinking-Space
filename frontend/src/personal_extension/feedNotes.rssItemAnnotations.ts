// Marks the Feed's articles that have questions or comments on them (the
// reading notes, feedNotesOrch): "1 question", "2 comments" on the row and in
// the reader. The public reader imports any *.rssItemAnnotations.ts module and
// knows nothing else about it; clicking a mark opens the article in the Feed.

import { registerRssItemAnnotationProviderBlock } from '@/services/lego_blocks/units/rssItemAnnotationBlock'
import { loadFeedNotesOrch, readFeedNotesOrch, subscribeFeedNotesOrch } from './services/orchestrators/feedNotesOrch'
import type { FeedNoteBlock } from './services/lego_blocks/units/feedNoteBlock'

let byItem = new Map<string, { questions: number; comments: number }>()
let indexed: FeedNoteBlock[] | null = null

function countsFor(itemId: string): { questions: number; comments: number } | undefined {
  const notes = readFeedNotesOrch()
  if (notes !== indexed) {
    indexed = notes
    byItem = new Map()
    for (const note of notes) {
      if (note.removed || (note.kind !== 'question' && note.kind !== 'comment')) continue
      const entry = byItem.get(note.itemId) ?? { questions: 0, comments: 0 }
      // An understood question still counts: the article had one
      if (note.kind === 'question') entry.questions += 1
      else entry.comments += 1
      byItem.set(note.itemId, entry)
    }
  }
  return byItem.get(itemId)
}

const openInFeed = (itemId: string) => ({ navigate }: { navigate: (to: string) => void }) => {
  navigate(`/webull?subtab=feed&rss=${encodeURIComponent(itemId)}`)
}

const subscribe = (onChange: () => void) => {
  void loadFeedNotesOrch()
  return subscribeFeedNotesOrch(onChange)
}

registerRssItemAnnotationProviderBlock({
  id: 'f9-feed-questions',
  annotate: (itemId) => {
    const n = countsFor(itemId)?.questions ?? 0
    return n ? { label: n === 1 ? '1 question' : `${n} questions`, title: 'Questions you asked while reading this', onOpen: openInFeed(itemId) } : null
  },
  subscribe,
})

registerRssItemAnnotationProviderBlock({
  id: 'f9-feed-comments',
  annotate: (itemId) => {
    const n = countsFor(itemId)?.comments ?? 0
    return n ? { label: n === 1 ? '1 comment' : `${n} comments`, title: 'Comments you made while reading this', onOpen: openInFeed(itemId) } : null
  },
  subscribe,
})
