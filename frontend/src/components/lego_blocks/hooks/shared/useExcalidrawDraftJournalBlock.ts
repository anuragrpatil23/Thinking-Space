// Recovery journal for drawings. See docs/contracts/DURABILITY.md.
//
// Same guarantee as the note composer's journal — annotations are never only in
// the canvas — but it stores a *delta* against the drawing as loaded rather
// than the scene. Measured on the file this was written for:
//
//   whole scene            3,030,148 bytes per write
//   delta, 20 strokes in      71,525 bytes per write
//
// Writing 3MB on a timer would be the stutter; 71KB is not.
//
// Cadence is a trailing debounce, which is also what keeps it off the stroke
// path. A stroke in progress emits a continuous change stream, so the timer
// keeps resetting and never fires mid-stroke — the journal runs in the pause
// after you lift the pen. That is a stronger guarantee than checking an
// `isDrawing` flag, because it cannot be wrong about what a stroke is.

import { useCallback, useEffect, useRef } from 'react'

import {
  computeExcalidrawDeltaBlock,
  excalidrawDeltaHasWorkBlock,
  type ExcalidrawElementLikeBlock,
} from '@/services/lego_blocks/units/excalidrawSceneDeltaBlock'
import {
  createDraftIdBlock,
  type NoteDraftEntryBlock,
} from '@/services/lego_blocks/units/noteDraftJournalBlock'
import {
  resolveDraftBlock,
  writeDurableDraftBlock,
  writeHotDraftBlock,
} from '@/services/lego_blocks/integrations/noteDraftJournalStoreBlock'

/** Long enough that a normal drawing rhythm never trips it mid-stroke, short
 *  enough that a crash costs one pause's worth of annotation. */
export const EXCALIDRAW_JOURNAL_DEBOUNCE_MS_BLOCK = 900

export interface ExcalidrawDraftJournalBlock {
  /** Point the journal at a document and its on-disk elements. Call when a
   *  drawing loads; resets everything the delta is measured against. */
  setBaseline: (targetPath: string, elements: readonly ExcalidrawElementLikeBlock[]) => void
  /** Note that the scene changed. Cheap — the work happens on the debounce. */
  noteSceneChanged: () => void
  /** Write now, skipping the debounce. Hot tier is synchronous. */
  flushSync: () => void
  /** Forget the draft. Only once a save's read-back confirms the write. */
  resolve: () => void
}

export function useExcalidrawDraftJournalBlock(
  getElements: () => readonly ExcalidrawElementLikeBlock[] | null,
): ExcalidrawDraftJournalBlock {
  const draftIdRef = useRef(createDraftIdBlock())
  const targetPathRef = useRef<string | null>(null)
  const baselineRef = useRef<readonly ExcalidrawElementLikeBlock[]>([])
  const timerRef = useRef<number | null>(null)

  const buildEntry = useCallback((): NoteDraftEntryBlock | null => {
    const targetPath = targetPathRef.current
    if (!targetPath) return null
    const current = getElements()
    if (!current) return null
    const delta = computeExcalidrawDeltaBlock(baselineRef.current, current)
    // Nothing the user did — do not write, and do not leave a stale entry
    // claiming work that no longer exists.
    if (!excalidrawDeltaHasWorkBlock(baselineRef.current, delta)) return null
    return {
      id: draftIdRef.current,
      kind: 'excalidraw-delta',
      targetPath,
      content: JSON.stringify(delta),
      updatedAt: new Date().toISOString(),
      createdTarget: false,
    }
  }, [getElements])

  const write = useCallback((entry: NoteDraftEntryBlock | null) => {
    if (!entry) return
    writeHotDraftBlock(entry)
    void writeDurableDraftBlock(entry)
  }, [])

  const setBaseline = useCallback((
    targetPath: string,
    elements: readonly ExcalidrawElementLikeBlock[],
  ) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // A new document is a new draft: reusing the id would let one drawing's
    // annotations be offered as another's.
    if (targetPathRef.current !== targetPath) draftIdRef.current = createDraftIdBlock()
    targetPathRef.current = targetPath
    baselineRef.current = elements
  }, [])

  const noteSceneChanged = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      write(buildEntry())
    }, EXCALIDRAW_JOURNAL_DEBOUNCE_MS_BLOCK)
  }, [buildEntry, write])

  const flushSync = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const entry = buildEntry()
    // Hot tier first and synchronously — the only part that survives a
    // `pagehide`, where async work is dropped.
    if (entry) writeHotDraftBlock(entry)
    if (entry) void writeDurableDraftBlock(entry)
  }, [buildEntry])

  const resolve = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const id = draftIdRef.current
    // The saved scene becomes the new baseline, so the next delta measures from
    // what is now on disk rather than re-reporting work already written.
    const current = getElements()
    if (current) baselineRef.current = current
    void resolveDraftBlock(id)
  }, [getElements])

  useEffect(() => {
    const onExit = () => { flushSync() }
    window.addEventListener('beforeunload', onExit)
    window.addEventListener('pagehide', onExit)
    const api = (window as unknown as {
      electronAPI?: { onFlushBeforeQuit?: (handler: (done: () => void) => void) => () => void }
    }).electronAPI
    const offQuit = api?.onFlushBeforeQuit?.((done) => { flushSync(); done() })
    return () => {
      window.removeEventListener('beforeunload', onExit)
      window.removeEventListener('pagehide', onExit)
      offQuit?.()
      onExit()
    }
  }, [flushSync])

  return { setBaseline, noteSceneChanged, flushSync, resolve }
}
