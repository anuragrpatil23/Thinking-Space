import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  savePdfAnnotationsOrch,
  type PdfAnnotationSaveOutcomeOrch,
} from '@/services/orchestrators/pdfAnnotationSaveOrch'
import type { PdfAnnotationDraftBlock } from '@/services/lego_blocks/units/pdfAnnotationGeometryBlock'

/* Owns the marks made in this session and gets them into the file.

   Saves are debounced, because a reader highlighting a paragraph produces
   several marks in a few seconds and each `saveDocument()` re-serializes and
   rewrites the whole file. The debounce is deliberately short: the durability
   contract's rule is that typed — or here, drawn — content is never only in
   memory, and a long debounce is exactly the window in which a crash loses
   work.

   Marks stay rendered from the overlay even after they are saved rather than
   being re-read from the file. Re-opening the document to pick them up would
   re-raster every page for no visual change, and the in-memory
   `PDFDocumentProxy` does not gain the annotation from `saveDocument()` — so
   the canvas cannot double-draw what the overlay is showing. On the next open
   the canvas renders them and the overlay starts empty. */

const SAVE_DEBOUNCE_MS_BLOCK = 1200

export interface PdfAnnotationsStateBlock {
  annotations: readonly PdfAnnotationDraftBlock[]
  addAnnotation: (annotation: PdfAnnotationDraftBlock) => void
  undoLastAnnotation: () => void
  saveState: 'idle' | 'pending' | 'saved' | 'unwritable'
  saveError: string | null
}

export function usePdfAnnotationsBlock(params: {
  doc: PDFDocumentProxy | null
  path: string
  enabled: boolean
}): PdfAnnotationsStateBlock {
  const { doc, path, enabled } = params
  const [annotations, setAnnotations] = useState<readonly PdfAnnotationDraftBlock[]>([])
  const [saveState, setSaveState] = useState<PdfAnnotationsStateBlock['saveState']>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  /* Marks already written to the file. Re-sending them would be harmless for
     correctness — the storage key is stable — but it makes every save carry
     the whole session, which grows without bound on a long reading sitting. */
  const savedIdsRef = useRef<Set<string>>(new Set())
  const annotationsRef = useRef<readonly PdfAnnotationDraftBlock[]>([])
  annotationsRef.current = annotations

  /* A new document is a new file and a new set of marks. */
  useEffect(() => {
    setAnnotations([])
    setSaveState('idle')
    setSaveError(null)
    savedIdsRef.current = new Set()
  }, [path])

  const flushBlock = useCallback(async () => {
    if (!doc) return
    const pending = annotationsRef.current.filter((item) => !savedIdsRef.current.has(item.id))
    if (pending.length === 0) return

    const outcome: PdfAnnotationSaveOutcomeOrch = await savePdfAnnotationsOrch({
      doc,
      path,
      drafts: pending,
    })

    if (outcome.status === 'unwritable') {
      setSaveState('unwritable')
      setSaveError(outcome.reason)
      return
    }

    for (const item of pending) savedIdsRef.current.add(item.id)
    setSaveState('saved')
    setSaveError(null)
  }, [doc, path])

  const scheduleSaveBlock = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setSaveState('pending')
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void flushBlock()
    }, SAVE_DEBOUNCE_MS_BLOCK)
  }, [flushBlock])

  const addAnnotation = useCallback((annotation: PdfAnnotationDraftBlock) => {
    if (!enabled) return
    setAnnotations((prev) => [...prev, annotation])
    scheduleSaveBlock()
  }, [enabled, scheduleSaveBlock])

  const undoLastAnnotation = useCallback(() => {
    setAnnotations((prev) => {
      /* Only marks not yet in the file can be taken back this way. Undoing a
         written annotation means removing it from the PDF, which is a
         different operation than never having written it. */
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        if (!savedIdsRef.current.has(prev[index].id)) {
          return [...prev.slice(0, index), ...prev.slice(index + 1)]
        }
      }
      return prev
    })
  }, [])

  /* Never let a pending debounce be the only copy: flush on unmount and when
     the app goes to the background, which on iOS is the last callback that
     runs before the process can be killed. */
  useEffect(() => {
    const flushNowBlock = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      void flushBlock()
    }

    const handleVisibilityBlock = () => {
      if (document.visibilityState === 'hidden') flushNowBlock()
    }

    document.addEventListener('visibilitychange', handleVisibilityBlock)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityBlock)
      flushNowBlock()
    }
  }, [flushBlock])

  return { annotations, addAnnotation, undoLastAnnotation, saveState, saveError }
}
