import { useEffect, useRef, type RefObject } from 'react'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import { appendReadingSpan } from '@/services/lego_blocks/integrations/thinkingspaceReadingBlock'
import {
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  resumeReadingAttentionBlock,
  isReportableAttentionBlock,
  type ReadingAttentionStateBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'
import {
  readingTitleFromPathBlock,
  type ThinkingspaceReadingSource,
} from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

/** Signs that a person is present. Passive and capturing so they fire wherever
 *  in the document the interaction actually lands — including inside CM6, the
 *  Excalidraw canvas, and nested scrollers. */
const PRESENCE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const

/** Ignore presence events closer together than this. The accumulator only
 *  needs to know that *some* signal arrived; processing every pointermove
 *  would burn work to refine a number whose ceiling is measured in minutes. */
const SIGNAL_THROTTLE_MS = 1_000

function sourceForPath(path: string): ThinkingspaceReadingSource {
  return isExcalidrawPathBlock(path) ? 'reading-draw' : 'reading-md'
}

function scrollRatioOf(el: HTMLElement | null): number | null {
  if (!el) return null
  const scrollable = el.scrollHeight - el.clientHeight
  if (scrollable <= 1) return null
  return Math.min(1, Math.max(0, el.scrollTop / scrollable))
}

/**
 * Measure attention on an open document and append a span when the sitting
 * ends.
 *
 * `attending` is the caller's answer to "is this document being read right
 * now" — the same expression that leases the screen wake lock, so the two can
 * never disagree about what reading means. Time accrues only while it is true,
 * and only between observed signs of presence (see readingAttentionBlock).
 *
 * A sitting ends on unmount, on a path change, or when `attending` goes false;
 * it is written only if it cleared the attention floor. Nothing here polls —
 * every credit happens on an event that was going to fire anyway.
 */
export function useReadingAttentionBlock(
  path: string | null,
  attending: boolean,
  scrollRef?: RefObject<HTMLElement | null>,
): void {
  // Everything the emit needs, held in refs so the cleanup reads the values
  // current when the sitting started rather than a stale closure.
  const stateRef = useRef<ReadingAttentionStateBlock | null>(null)
  const startedAtRef = useRef(0)
  const lastSignalRef = useRef(0)
  const maxScrollRatioRef = useRef(0)
  const lastScrollRatioRef = useRef<number | null>(null)
  const scrollRefRef = useRef(scrollRef)
  scrollRefRef.current = scrollRef

  useEffect(() => {
    if (!path || !attending) return

    const now = Date.now()
    stateRef.current = createReadingAttentionBlock(now)
    startedAtRef.current = now
    lastSignalRef.current = now
    maxScrollRatioRef.current = 0
    lastScrollRatioRef.current = null

    const sampleScroll = () => {
      const ratio = scrollRatioOf(scrollRefRef.current?.current ?? null)
      if (ratio === null) return
      lastScrollRatioRef.current = ratio
      if (ratio > maxScrollRatioRef.current) maxScrollRatioRef.current = ratio
    }

    const onSignal = () => {
      const at = Date.now()
      if (at - lastSignalRef.current < SIGNAL_THROTTLE_MS) return
      lastSignalRef.current = at
      if (stateRef.current) stateRef.current = creditReadingAttentionBlock(stateRef.current, at)
      sampleScroll()
    }

    // Leaving credits the time up to the moment of leaving and then freezes;
    // returning resumes without crediting the absence. In Electron a window
    // that is blurred but still visible never fires visibilitychange, so
    // `blur` is the only event that catches switching to another app.
    const onLeave = () => {
      const at = Date.now()
      if (stateRef.current) stateRef.current = creditReadingAttentionBlock(stateRef.current, at)
      lastSignalRef.current = at
      sampleScroll()
    }
    const onReturn = () => {
      const at = Date.now()
      if (stateRef.current) stateRef.current = resumeReadingAttentionBlock(stateRef.current, at)
      lastSignalRef.current = at
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onReturn()
      else onLeave()
    }

    for (const type of PRESENCE_EVENTS) {
      document.addEventListener(type, onSignal, { passive: true, capture: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onLeave)
    window.addEventListener('focus', onReturn)

    const sittingPath = path
    return () => {
      for (const type of PRESENCE_EVENTS) {
        document.removeEventListener(type, onSignal, { capture: true })
      }
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('focus', onReturn)

      const endMs = Date.now()
      const state = stateRef.current
      stateRef.current = null
      if (!state) return
      sampleScroll()
      const { creditedMs } = creditReadingAttentionBlock(state, endMs)
      if (!isReportableAttentionBlock(creditedMs)) return

      const startMs = startedAtRef.current
      const source = sourceForPath(sittingPath)
      const isCanvas = source === 'reading-draw'
      // Fire-and-forget: the writer is module-level and serialized, so it
      // outlives this component's unmount.
      void appendReadingSpan(getVaultFS(), {
        key: `${source}|${sittingPath}|${startMs}`,
        source,
        filePath: sittingPath,
        title: readingTitleFromPathBlock(sittingPath),
        method: 'measured',
        startMs,
        endMs,
        activeMs: creditedMs,
        recordedAt: endMs,
        // A canvas has no extent for a ratio to be a fraction of.
        ...(isCanvas ? {} : {
          maxScrollRatio: maxScrollRatioRef.current,
          ...(lastScrollRatioRef.current !== null
            ? { endScrollRatio: lastScrollRatioRef.current }
            : {}),
        }),
      })
    }
  }, [path, attending])
}
