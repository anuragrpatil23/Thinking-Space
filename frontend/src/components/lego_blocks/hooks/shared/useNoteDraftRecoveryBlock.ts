// Startup recovery sweep for the note draft journal.
// See docs/contracts/DURABILITY.md.
//
// Runs once per composer mount. Its only job is to answer "is there text from a
// previous session that never reached a file", and the bar is deliberately high:
// a false offer teaches people to dismiss the banner, which is the one outcome
// that would make the whole journal worthless on the day it matters.

import { useCallback, useEffect, useState } from 'react'

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  sortDraftsByRecencyBlock,
  unresolvedDraftsBlock,
  type NoteDraftEntryBlock,
} from '@/services/lego_blocks/units/noteDraftJournalBlock'
import {
  readAllDraftsBlock,
  resolveDraftBlock,
} from '@/services/lego_blocks/integrations/noteDraftJournalStoreBlock'

export interface NoteDraftRecoveryBlock {
  /** Drafts holding text that is nowhere else. Newest first. */
  recoverableDrafts: NoteDraftEntryBlock[]
  /** Drop a draft the user has declined. The only path that deletes journal
   *  text, and it is always a person's explicit choice. */
  discardDraft: (id: string) => Promise<void>
  /** Forget a draft locally once its text has been adopted into the buffer. */
  forgetDraft: (id: string) => void
  refresh: () => Promise<void>
}

export function useNoteDraftRecoveryBlock(currentDraftId: string): NoteDraftRecoveryBlock {
  const [recoverableDrafts, setRecoverableDrafts] = useState<NoteDraftEntryBlock[]>([])

  const refresh = useCallback(async () => {
    let entries: NoteDraftEntryBlock[]
    try {
      entries = await readAllDraftsBlock()
    } catch {
      return
    }
    // The session's own in-flight draft is not a recovery candidate; it is the
    // note on screen.
    const candidates = entries.filter(entry => entry.id !== currentDraftId)
    if (candidates.length === 0) {
      setRecoverableDrafts([])
      return
    }

    const fs = getVaultFS()
    const diskByPath = new Map<string, string | null>()
    for (const entry of candidates) {
      if (!entry.targetPath || diskByPath.has(entry.targetPath)) continue
      try {
        const exists = await fs.exists(entry.targetPath)
        diskByPath.set(entry.targetPath, exists ? await fs.read(entry.targetPath) : null)
      } catch {
        // Unreadable target. Treated as absent, which errs toward *offering*
        // recovery — the safe direction when the question is whether text
        // still exists somewhere.
        diskByPath.set(entry.targetPath, null)
      }
    }
    setRecoverableDrafts(sortDraftsByRecencyBlock(unresolvedDraftsBlock(candidates, diskByPath)))
  }, [currentDraftId])

  useEffect(() => { void refresh() }, [refresh])

  const discardDraft = useCallback(async (id: string) => {
    setRecoverableDrafts(current => current.filter(entry => entry.id !== id))
    await resolveDraftBlock(id)
  }, [])

  const forgetDraft = useCallback((id: string) => {
    setRecoverableDrafts(current => current.filter(entry => entry.id !== id))
  }, [])

  return { recoverableDrafts, discardDraft, forgetDraft, refresh }
}
