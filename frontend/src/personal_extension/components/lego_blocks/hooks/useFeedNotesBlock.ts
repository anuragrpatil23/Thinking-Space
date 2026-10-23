import { useEffect, useSyncExternalStore } from 'react'
import { loadFeedNotesOrch, readFeedNotesOrch, subscribeFeedNotesOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'

/** The Feed's reading notes (questions, comments, picked-up articles), loaded once. */
export function useFeedNotesBlock() {
  useEffect(() => { void loadFeedNotesOrch() }, [])
  return useSyncExternalStore(subscribeFeedNotesOrch, readFeedNotesOrch)
}
