// Drives the recovery journal for one composer session.
// See docs/contracts/DURABILITY.md.
//
// Deliberately independent of `autoSaveEnabled`: auto-save decides when the
// *note file* is written, this decides when a second copy of typed text exists.
// Conflating them is what made manual mode the least protected mode in the app.

import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  DRAFT_DURABLE_DEBOUNCE_MS_BLOCK,
  DRAFT_HOT_DEBOUNCE_MS_BLOCK,
  createDraftIdBlock,
  type NoteDraftEntryBlock,
} from '@/services/lego_blocks/units/noteDraftJournalBlock'
import {
  resolveDraftBlock,
  writeDurableDraftBlock,
  writeHotDraftBlock,
} from '@/services/lego_blocks/integrations/noteDraftJournalStoreBlock'

export interface NoteDraftJournalBlock {
  /** This session's draft id — stable across the session, used as a filename. */
  draftId: string
  /** Record typed text. Cheap and safe to call on every keystroke. */
  record: (input: { content: string; targetPath: string | null; createdTarget: boolean }) => void
  /** Write the hot tier immediately, skipping the debounce. Synchronous, so it
   *  is usable from `pagehide` / `beforeunload`, where async work is dropped.
   *  Returns whether a copy now exists. */
  flushHotSync: () => boolean
  /** Forget the draft in both tiers. Call only once a save's read-back has
   *  confirmed the text reached its target. */
  resolve: () => void
  /** Durable write, awaited. For the moments worth paying for it: before a
   *  move, before clearing the buffer. Returns whether a copy now exists. */
  flushDurable: () => Promise<boolean>
}

export function useNoteDraftJournalBlock(): NoteDraftJournalBlock {
  const draftId = useMemo(() => createDraftIdBlock(), [])
  const pendingRef = useRef<NoteDraftEntryBlock | null>(null)
  const hotTimerRef = useRef<number | null>(null)
  const durableTimerRef = useRef<number | null>(null)

  const writeHot = useCallback(() => {
    hotTimerRef.current = null
    if (pendingRef.current) writeHotDraftBlock(pendingRef.current)
  }, [])

  const writeDurable = useCallback(async (): Promise<boolean> => {
    durableTimerRef.current = null
    const entry = pendingRef.current
    // Nothing pending means nothing at risk, which is a success for every
    // caller that asks "is the buffer safe".
    if (!entry) return true
    // The vault being unavailable is exactly the case the hot tier covers, so
    // this reports rather than throwing at someone mid-sentence.
    return writeDurableDraftBlock(entry)
  }, [])

  const record = useCallback((input: {
    content: string
    targetPath: string | null
    createdTarget: boolean
  }) => {
    pendingRef.current = {
      id: draftId,
      targetPath: input.targetPath,
      content: input.content,
      updatedAt: new Date().toISOString(),
      createdTarget: input.createdTarget,
    }
    if (hotTimerRef.current === null) {
      hotTimerRef.current = window.setTimeout(writeHot, DRAFT_HOT_DEBOUNCE_MS_BLOCK)
    }
    // Trailing rather than leading: the durable tier writes into the vault,
    // which may be iCloud-backed, so it coalesces a burst of typing into one
    // write (ENERGY contract) instead of one per pause.
    if (durableTimerRef.current !== null) window.clearTimeout(durableTimerRef.current)
    durableTimerRef.current = window.setTimeout(
      () => { void writeDurable() },
      DRAFT_DURABLE_DEBOUNCE_MS_BLOCK,
    )
  }, [draftId, writeDurable, writeHot])

  const flushHotSync = useCallback((): boolean => {
    if (hotTimerRef.current !== null) {
      window.clearTimeout(hotTimerRef.current)
      hotTimerRef.current = null
    }
    if (!pendingRef.current) return true
    return writeHotDraftBlock(pendingRef.current)
  }, [])

  const flushDurable = useCallback(async (): Promise<boolean> => {
    if (durableTimerRef.current !== null) {
      window.clearTimeout(durableTimerRef.current)
      durableTimerRef.current = null
    }
    return writeDurable()
  }, [writeDurable])

  const resolve = useCallback(() => {
    if (hotTimerRef.current !== null) {
      window.clearTimeout(hotTimerRef.current)
      hotTimerRef.current = null
    }
    if (durableTimerRef.current !== null) {
      window.clearTimeout(durableTimerRef.current)
      durableTimerRef.current = null
    }
    pendingRef.current = null
    void resolveDraftBlock(draftId)
  }, [draftId])

  // Teardown: the hot tier is synchronous, so this actually completes. The
  // durable tier is fired but not awaited — nothing on this path can await.
  useEffect(() => {
    const onExit = () => {
      flushHotSync()
      void writeDurable()
    }
    window.addEventListener('beforeunload', onExit)
    window.addEventListener('pagehide', onExit)
    return () => {
      window.removeEventListener('beforeunload', onExit)
      window.removeEventListener('pagehide', onExit)
      onExit()
    }
  }, [flushHotSync, writeDurable])

  // Electron's quit path. `beforeunload` and `pagehide` are not reliable across
  // every quit route — notably the auto-updater's, which is the "sudden app
  // install" case — so main holds the quit open and waits for the ack below.
  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: { onFlushBeforeQuit?: (handler: (done: () => void) => void) => () => void }
    }).electronAPI
    if (!api?.onFlushBeforeQuit) return
    return api.onFlushBeforeQuit((done) => {
      // Hot tier first and synchronously: if anything below throws or stalls,
      // the text is already safe.
      flushHotSync()
      void writeDurable().finally(done)
    })
  }, [flushHotSync, writeDurable])

  return { draftId, record, flushHotSync, resolve, flushDurable }
}
