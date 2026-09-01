import { useEffect, useRef, useState, type RefObject } from 'react'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import { appendReadingSpan } from '@/services/lego_blocks/integrations/thinkingspaceReadingBlock'
import {
  claimReadingForegroundBlock,
  isReadingForegroundBlock,
  subscribeReadingForegroundBlock,
} from '@/services/lego_blocks/units/readingForegroundBlock'
import {
  setReadingLiveStateBlock,
  traceReadingBlock,
} from '@/services/lego_blocks/units/readingTraceBlock'
import {
  JOURNAL_CHECKPOINT_INTERVAL_MS,
  checkpointReadingJournalBlock,
  clearReadingJournalEntryBlock,
} from '@/services/lego_blocks/units/readingJournalBlock'
import {
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  resumeReadingAttentionBlock,
  isReportableAttentionBlock,
  type ReadingAttentionStateBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'
import {
  createCanvasAttentionBlock,
  creditCanvasAttentionBlock,
  finishCanvasAttentionBlock,
  observeCanvasViewportBlock,
  type CanvasAttentionStateBlock,
  type CanvasViewportRectBlock,
} from '@/services/lego_blocks/units/canvasAttentionBlock'
import {
  readingTitleFromPathBlock,
  type ThinkingspaceReadingRecord,
  type ThinkingspaceReadingSource,
  type ThinkingspaceReadingWhere,
} from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

/**
 * Signs that a person is present, passive and capturing so they fire wherever
 * the interaction lands — inside CM6, the Excalidraw canvas, nested scrollers.
 *
 * `pointermove` is canvas-only and load-bearing there: an Apple Pencil hovering
 * above the glass generates moves and no touches, which is the same reason the
 * wake lock was extended to Excalidraw in edit mode. On markdown, scroll +
 * keydown + pointerdown already establish presence, so the highest-frequency
 * listener comes off the more common surface entirely.
 */
const TEXT_PRESENCE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll'] as const
const CANVAS_PRESENCE_EVENTS = [...TEXT_PRESENCE_EVENTS, 'pointermove'] as const

/** Ignore presence events closer together than this. The accumulator only
 *  needs to know that *some* signal arrived; refining a number whose ceiling
 *  is measured in minutes does not repay per-event work. */
const SIGNAL_THROTTLE_MS = 1_000

/** Reads the canvas viewport in world coordinates, or null when the canvas
 *  isn't ready. Supplied only by Excalidraw surfaces. */
export type CanvasViewportSampler = () => CanvasViewportRectBlock | null

/** Element ids intersecting a rect, sampled once when a station closes. */
export type CanvasElementSampler = (rect: CanvasViewportRectBlock) => string[]

export interface ReadingAttentionOptions {
  /** Scroll container, for the markdown `where`. */
  scrollRef?: RefObject<HTMLElement | null>
  /** Document uuid from frontmatter, when it has one. */
  uuid?: string | null
  viewportSampler?: CanvasViewportSampler
  elementSampler?: CanvasElementSampler
}

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
 * only between observed signs of presence, and only for the one document
 * holding app-wide foreground (see readingForegroundBlock).
 *
 * A sitting ends on unmount, on a path change, when `attending` goes false, or
 * when another document takes foreground. It is also flushed — without ending
 * — when the app hides, because closing a window does not reliably unmount
 * React and reading-then-quitting is a normal way to finish.
 *
 * Nothing here polls. Every credit happens on an event that was going to fire
 * anyway.
 */
export function useReadingAttentionBlock(
  path: string | null,
  attending: boolean,
  options: ReadingAttentionOptions = {},
): void {
  const wants = Boolean(path) && attending

  // Foreground is exclusive: two documents cannot both own the same minute,
  // and every mounted reader sees the same document-level events.
  const tokenRef = useRef<symbol | null>(null)
  if (tokenRef.current === null) tokenRef.current = Symbol('reading-foreground')
  const [hasForeground, setHasForeground] = useState(false)

  useEffect(() => {
    const token = tokenRef.current!
    if (!wants) {
      setHasForeground(false)
      return
    }
    const unsubscribe = subscribeReadingForegroundBlock(() => {
      setHasForeground(isReadingForegroundBlock(token))
    })
    const release = claimReadingForegroundBlock(token)
    setHasForeground(isReadingForegroundBlock(token))
    return () => {
      unsubscribe()
      release()
    }
  }, [wants])

  // Everything the emit needs, in refs so cleanup reads the values current
  // when the sitting started rather than a stale closure.
  const optionsRef = useRef(options)
  optionsRef.current = options
  const stateRef = useRef<ReadingAttentionStateBlock | null>(null)
  const canvasRef = useRef<CanvasAttentionStateBlock | null>(null)
  const startedAtRef = useRef(0)
  const lastSignalRef = useRef(0)
  const maxScrollRef = useRef(0)
  const endScrollRef = useRef<number | null>(null)
  const lastCheckpointRef = useRef(0)

  useEffect(() => {
    if (!path || !attending || !hasForeground) return

    const source = sourceForPath(path)
    const isCanvas = source === 'reading-draw'
    const now = Date.now()
    stateRef.current = createReadingAttentionBlock(now)
    canvasRef.current = isCanvas ? createCanvasAttentionBlock() : null
    startedAtRef.current = now
    lastSignalRef.current = now
    maxScrollRef.current = 0
    endScrollRef.current = null
    lastCheckpointRef.current = now
    traceReadingBlock({ outcome: 'sitting-started', path })

    // Reading layout forces a reflow when a mutation is pending, so this is
    // called ONLY from scroll handling, where the browser has just finished
    // layout and the read is nearly free. Calling it from pointermove — as an
    // earlier version did — put a forced reflow in the middle of a gesture.
    const sampleScroll = () => {
      const ratio = scrollRatioOf(optionsRef.current.scrollRef?.current ?? null)
      if (ratio === null) return
      endScrollRef.current = ratio
      if (ratio > maxScrollRef.current) maxScrollRef.current = ratio
    }

    const creditAt = (at: number) => {
      if (stateRef.current) stateRef.current = creditReadingAttentionBlock(stateRef.current, at)
      setReadingLiveStateBlock({
        path, source, startedAt: new Date(startedAtRef.current).toISOString(),
        activeMs: stateRef.current?.creditedMs ?? 0,
        stations: canvasRef.current ? canvasRef.current.closed.length + 1 : 0,
      })
      // Write-ahead: the span so far goes somewhere synchronous, so a memory
      // kill or force-quit costs the last few seconds rather than the sitting.
      // Throttled — this is a main-thread localStorage write.
      if (at - lastCheckpointRef.current >= JOURNAL_CHECKPOINT_INTERVAL_MS) {
        lastCheckpointRef.current = at
        const snapshot = buildRecord(at, stateRef.current?.creditedMs ?? 0, { silent: true })
        if (snapshot) checkpointReadingJournalBlock(snapshot)
      }
      if (!canvasRef.current) return
      const rect = optionsRef.current.viewportSampler?.() ?? null
      canvasRef.current = rect
        ? observeCanvasViewportBlock(
            canvasRef.current, rect, at, optionsRef.current.elementSampler,
          )
        : creditCanvasAttentionBlock(canvasRef.current, at)
    }

    const onSignal = (event: Event) => {
      const at = Date.now()
      if (at - lastSignalRef.current < SIGNAL_THROTTLE_MS) return
      lastSignalRef.current = at
      creditAt(at)
      if (event.type === 'scroll') sampleScroll()
    }

    // Leaving credits the time up to the moment of leaving and freezes;
    // returning resumes without crediting the absence. In Electron a window
    // that is blurred but still visible never fires visibilitychange, so
    // `blur` is the only event that catches switching to another app.
    const onLeave = () => {
      const at = Date.now()
      creditAt(at)
      lastSignalRef.current = at
    }
    const onReturn = () => {
      const at = Date.now()
      if (stateRef.current) stateRef.current = resumeReadingAttentionBlock(stateRef.current, at)
      if (canvasRef.current?.current) {
        canvasRef.current = {
          closed: canvasRef.current.closed,
          current: {
            rect: canvasRef.current.current.rect,
            attention: resumeReadingAttentionBlock(canvasRef.current.current.attention, at),
          },
        }
      }
      lastSignalRef.current = at
    }

    const buildRecord = (
      endMs: number,
      creditedMs: number,
      opts: { silent?: boolean } = {},
    ): ThinkingspaceReadingRecord | null => {
      if (!isReportableAttentionBlock(creditedMs)) {
        if (!opts.silent) traceReadingBlock({ outcome: 'below-floor', path, activeMs: creditedMs })
        return null
      }
      const startMs = startedAtRef.current
      let where: ThinkingspaceReadingWhere | undefined
      if (isCanvas) {
        const stations = canvasRef.current
          ? finishCanvasAttentionBlock(canvasRef.current, endMs, optionsRef.current.elementSampler)
          : []
        if (stations.length > 0) where = { kind: 'canvas', stations }
      } else if (maxScrollRef.current > 0 || endScrollRef.current !== null) {
        where = {
          kind: 'scroll',
          max: maxScrollRef.current,
          ...(endScrollRef.current !== null ? { end: endScrollRef.current } : {}),
        }
      }
      const uuid = optionsRef.current.uuid
      return {
        key: `${source}|${path}|${startMs}`,
        source,
        filePath: path,
        ...(uuid ? { uuid } : {}),
        title: readingTitleFromPathBlock(path),
        method: 'measured',
        startMs,
        endMs,
        activeMs: creditedMs,
        recordedAt: endMs,
        ...(where ? { where } : {}),
      }
    }

    // Flush without ending the sitting. Closing a window does not reliably
    // unmount React, so without this the last sitting of every session — the
    // one that ends by quitting — would be lost silently. The key is stable,
    // so the real close merges over this row rather than duplicating it, and
    // mergeReadingRecordsBlock keeps whichever measured more attention.
    const flush = () => {
      const at = Date.now()
      creditAt(at)
      lastSignalRef.current = at
      const state = stateRef.current
      if (!state) return
      const record = buildRecord(at, state.creditedMs)
      if (!record) return
      checkpointReadingJournalBlock(record)
      void appendReadingSpan(getVaultFS(), record).then(durable => {
        if (durable) clearReadingJournalEntryBlock(record.key)
      })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') { onReturn(); return }
      onLeave()
      flush()
    }

    const presenceEvents = isCanvas ? CANVAS_PRESENCE_EVENTS : TEXT_PRESENCE_EVENTS
    for (const type of presenceEvents) {
      document.addEventListener(type, onSignal, { passive: true, capture: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onLeave)
    window.addEventListener('focus', onReturn)
    window.addEventListener('pagehide', flush)

    return () => {
      for (const type of presenceEvents) {
        document.removeEventListener(type, onSignal, { capture: true })
      }
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('pagehide', flush)

      const endMs = Date.now()
      const state = stateRef.current
      if (!state) return
      const { creditedMs } = creditReadingAttentionBlock(state, endMs)
      const record = buildRecord(endMs, creditedMs)
      traceReadingBlock({ outcome: 'sitting-ended', path, activeMs: creditedMs })
      stateRef.current = null
      canvasRef.current = null
      setReadingLiveStateBlock(null)
      if (!record) return
      // Journal first, synchronously, then attempt the vault. If the app dies
      // between the two the next launch drains it; if the vault takes it, the
      // journal entry is forgotten.
      checkpointReadingJournalBlock(record)
      // Fire-and-forget: the writer is module-level and serialized, so it
      // outlives this component's unmount.
      void appendReadingSpan(getVaultFS(), record).then(durable => {
        if (durable) clearReadingJournalEntryBlock(record.key)
      })
    }
  }, [path, attending, hasForeground])
}
