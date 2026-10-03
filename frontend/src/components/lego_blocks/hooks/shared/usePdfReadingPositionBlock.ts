import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  computePdfReadingRestoreDeltaBlock,
  locatePdfReadingPositionBlock,
  readPdfReadingPositionBlock,
  writePdfReadingPositionBlock,
  type PdfReadingPositionBlock,
} from '@/services/lego_blocks/units/pdfReadingPositionBlock'
import {
  pushPdfReadingPositionsOrch,
  readRoamedPdfReadingPositionOrch,
} from '@/services/orchestrators/pdfReadingPositionSyncOrch'

/* The auto-bookmark: remembers where a PDF was scrolled to and puts it back
   the next time the file opens.

   Two halves that must not overlap. **Nothing is recorded until the reader
   has touched the document.** Before that, every scroll is the restore itself,
   and recording it does damage twice over: at load the scroller sits at the top
   of page 1, which would overwrite the bookmark being restored; and stamping a
   restored position with the current time would make this device's stale copy
   look newer than the position another device has not finished syncing yet.

   The restore is applied more than once. Page boxes are estimated from page 1
   at load and corrected as real measurements arrive on idle, the fit modes do
   not know their scale until the viewport has been measured, and another
   device's newer position arrives from the vault a moment after the local one.
   It is re-applied on each of those until the reader touches the document, at
   which point where they are is their business.

   Two write paths, at two speeds. localStorage is cheap and local, so it
   trails scrolling closely. The vault copy is a file in an iCloud folder, so it
   waits for a longer pause and is otherwise written when the app is
   backgrounded or the file is closed. Both are debounced off real scroll
   events — no timer runs while the page is still, which keeps this inside the
   energy contract. */

const SAVE_DEBOUNCE_MS_BLOCK = 400
const VAULT_PUSH_DEBOUNCE_MS_BLOCK = 5000

export function usePdfReadingPositionBlock(params: {
  path: string
  /** Real reading surfaces only — a preview must not move the bookmark. */
  enabled: boolean
  numPages: number
  viewportRef: React.RefObject<HTMLElement | null>
  surfaceRef: React.RefObject<HTMLElement | null>
  pageRefs: React.RefObject<Map<number, HTMLElement>>
  /** Identity changes whenever measured page boxes change. */
  metricsByPage: unknown
  displayedScale: number
}): void {
  const {
    path, enabled, numPages, viewportRef, surfaceRef, pageRefs, metricsByPage, displayedScale,
  } = params

  const restoreTargetRef = useRef<PdfReadingPositionBlock | null>(null)
  /* Laid out and restored at least once: from here a touch means reading. */
  const readyRef = useRef(false)
  const trackingRef = useRef(false)
  const latestRef = useRef<PdfReadingPositionBlock | null>(null)
  const timerRef = useRef<number | null>(null)
  const pushTimerRef = useRef<number | null>(null)
  const pushDirtyRef = useRef(false)
  /* Bumped when a newer position arrives from another device, to re-run the
     restore against it. */
  const [roamedRevision, setRoamedRevision] = useState(0)
  const frameRef = useRef<number | null>(null)
  const numPagesRef = useRef(numPages)
  numPagesRef.current = numPages

  const pushBlock = useCallback(() => {
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current)
      pushTimerRef.current = null
    }
    if (!pushDirtyRef.current) return
    pushDirtyRef.current = false
    void pushPdfReadingPositionsOrch()
  }, [])

  const saveLocalBlock = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const latest = latestRef.current
    if (!latest) return
    latestRef.current = null
    writePdfReadingPositionBlock(path, latest)

    pushDirtyRef.current = true
    if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current)
    pushTimerRef.current = window.setTimeout(pushBlock, VAULT_PUSH_DEBOUNCE_MS_BLOCK)
  }, [path, pushBlock])

  /* Everything, now: the app is going away or the file is being closed. */
  const flushBlock = useCallback(() => {
    saveLocalBlock()
    pushBlock()
  }, [pushBlock, saveLocalBlock])

  const saveLocalRef = useRef(saveLocalBlock)
  saveLocalRef.current = saveLocalBlock
  const flushRef = useRef(flushBlock)
  flushRef.current = flushBlock

  /* A new document is a new bookmark. The cleanup is the previous file's
     flush, bound to the previous path. */
  useEffect(() => {
    restoreTargetRef.current = enabled ? readPdfReadingPositionBlock(path) : null
    readyRef.current = false
    trackingRef.current = false
    latestRef.current = null
    if (!enabled) return flushBlock

    /* The local copy is applied at once; the vault is asked in parallel, and
       its answer is used only if it is newer and the reader has not started
       moving. Adopted with its own timestamp — this device was not there. */
    let cancelled = false
    void readRoamedPdfReadingPositionOrch(path).then((roamed) => {
      if (cancelled || !roamed || trackingRef.current) return
      const local = readPdfReadingPositionBlock(path)
      if (local && local.at >= roamed.at) return
      writePdfReadingPositionBlock(path, roamed, roamed.at)
      restoreTargetRef.current = roamed
      setRoamedRevision((revision) => revision + 1)
    })

    return () => {
      cancelled = true
      flushBlock()
    }
  }, [enabled, flushBlock, path])

  /* Before paint, so the document never visibly opens at page 1 and jumps. */
  useLayoutEffect(() => {
    if (!enabled || numPages <= 0) return

    const target = restoreTargetRef.current
    if (target) {
      const viewport = viewportRef.current
      /* A file that got shorter since it was last read resumes at its end. */
      const page = Math.min(target.page, numPages)
      const element = pageRefs.current?.get(page)
      if (!viewport || !element) return

      const pageRect = element.getBoundingClientRect()
      if (!(pageRect.height > 0)) return

      viewport.scrollTop += computePdfReadingRestoreDeltaBlock({
        position: page === target.page ? target : { page, offset: 0 },
        viewportTop: viewport.getBoundingClientRect().top,
        pageRect,
      })
    }

    readyRef.current = true
  }, [displayedScale, enabled, metricsByPage, numPages, pageRefs, roamedRevision, viewportRef])

  useEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    const surface = surfaceRef.current
    if (!viewport || !surface) return

    const sampleBlock = () => {
      frameRef.current = null
      if (!trackingRef.current) return

      const position = locatePdfReadingPositionBlock({
        numPages: numPagesRef.current,
        viewportTop: viewport.getBoundingClientRect().top,
        pageRectFor: (page) => pageRefs.current?.get(page)?.getBoundingClientRect() ?? null,
      })
      if (!position) return

      latestRef.current = position
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => saveLocalRef.current(), SAVE_DEBOUNCE_MS_BLOCK)
    }

    const handleScrollBlock = () => {
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(sampleBlock)
    }

    /* The reader's first touch ends the restore and starts the recording. A
       touch while the file is still loading is neither: there is nothing to
       read yet, and the restore has not had its turn. */
    const releaseRestoreBlock = () => {
      if (!readyRef.current) return
      restoreTargetRef.current = null
      trackingRef.current = true
    }

    const handleKeyDownBlock = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      /* Typing in another pane is not the reader moving through this file. */
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      releaseRestoreBlock()
    }

    /* On iOS this is the last callback that runs before the process can be
       killed, so a pending debounce must not be the only copy. */
    const handleVisibilityBlock = () => {
      if (document.visibilityState === 'hidden') flushRef.current()
    }
    const handlePageHideBlock = () => flushRef.current()

    viewport.addEventListener('scroll', handleScrollBlock, { passive: true })
    surface.addEventListener('wheel', releaseRestoreBlock, { passive: true })
    surface.addEventListener('touchstart', releaseRestoreBlock, { passive: true })
    surface.addEventListener('pointerdown', releaseRestoreBlock, { passive: true })
    window.addEventListener('keydown', handleKeyDownBlock)
    document.addEventListener('visibilitychange', handleVisibilityBlock)
    window.addEventListener('pagehide', handlePageHideBlock)

    return () => {
      viewport.removeEventListener('scroll', handleScrollBlock)
      surface.removeEventListener('wheel', releaseRestoreBlock)
      surface.removeEventListener('touchstart', releaseRestoreBlock)
      surface.removeEventListener('pointerdown', releaseRestoreBlock)
      window.removeEventListener('keydown', handleKeyDownBlock)
      document.removeEventListener('visibilitychange', handleVisibilityBlock)
      window.removeEventListener('pagehide', handlePageHideBlock)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [enabled, pageRefs, surfaceRef, viewportRef])
}
