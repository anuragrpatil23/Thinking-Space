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
  createPendingReadingAttentionBlock,
  creditReadingAttentionBlock,
  isReadingSittingBreakBlock,
  isReportableAttentionBlock,
  suspendReadingAttentionBlock,
  type ReadingAttentionStateBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'
import {
  createPdfAttentionBlock,
  creditPdfAttentionBlock,
  finishPdfAttentionBlock,
  observePdfPageBlock,
  type PdfAttentionStateBlock,
} from '@/services/lego_blocks/units/pdfAttentionBlock'
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
 * Signs that a person is present *in this document*.
 *
 * Bound to the surface's own root element, not to `document`. That distinction
 * is the whole point: `attending` asks whether this is the active pane, never
 * whether the interaction is in it, so document-level listeners credited a PDF
 * sitting on its cover for every click in the explorer and every keystroke in a
 * side panel. One real span collected 15 minutes on a book cover that way.
 *
 * Capturing, so non-bubbling `scroll` from nested scrollers still reaches the
 * root during the capture phase, and interaction inside CM6 or the Excalidraw
 * canvas is seen without either needing to cooperate.
 *
 * `pointermove` is canvas-only and load-bearing there: an Apple Pencil hovering
 * above the glass generates moves and no touches, which is the same reason the
 * wake lock was extended to Excalidraw in edit mode. On markdown, scroll +
 * keydown + pointerdown already establish presence, so the highest-frequency
 * listener comes off the more common surface entirely.
 */
const TEXT_PRESENCE_EVENTS = ['pointerdown', 'wheel', 'scroll'] as const
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

/** The page currently being read, 1-based, or null before the document loads.
 *  PdfDocumentBlock already derives this from an IntersectionObserver over the
 *  page elements; this hook consumes it rather than recomputing it. */
export type PdfPageSampler = () => number | null

/** What a canvas surface publishes: where the viewport is, and which elements
 *  a rect covered when it was left. Supplied together because a station close
 *  needs both, and half of them is a station with no drift hint — which is how
 *  the first real recording came out. */
export interface CanvasSamplersBlock {
  sample: CanvasViewportSampler
  sampleElements: CanvasElementSampler
}

export interface ReadingAttentionOptions {
  /**
   * The document surface's root element. Presence listeners bind here, so
   * interaction anywhere else in the app is not this document's reading.
   * Includes the surface's own chrome — a PDF's page buttons are reading
   * interaction even though they sit outside the scroller.
   */
  surfaceRef?: RefObject<HTMLElement | null>
  /** Scroll container, for the markdown `where`. */
  scrollRef?: RefObject<HTMLElement | null>
  /** Document uuid from frontmatter, when it has one. */
  uuid?: string | null
  canvasSamplers?: CanvasSamplersBlock | null
  pageSampler?: PdfPageSampler | null
}

function sourceForPath(path: string): ThinkingspaceReadingSource {
  if (isExcalidrawPathBlock(path)) return 'reading-draw'
  if (/\.pdf$/i.test(path)) return 'reading-pdf'
  return 'reading-md'
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
  const pdfRef = useRef<PdfAttentionStateBlock | null>(null)
  const lastSignalRef = useRef(0)
  const maxScrollRef = useRef(0)
  const endScrollRef = useRef<number | null>(null)
  const lastCheckpointRef = useRef(0)

  useEffect(() => {
    if (!path || !attending || !hasForeground) {
      // An empty "Measuring now" used to have three possible causes and no way
      // to tell them apart. Name the one that actually applies.
      setReadingLiveStateBlock({
        measuring: false,
        reason: !path ? 'no path (countsAsReading off, or no document)'
          : !attending ? 'not attending (inactive pane, editing, loading, or error)'
            : 'another document holds foreground',
        path: path ?? null,
        attending,
        hasForeground,
      })
      return
    }

    const source = sourceForPath(path)
    const isCanvas = source === 'reading-draw'
    const isPdf = source === 'reading-pdf'

    // Mounting does not start a sitting — the first sign of presence does.
    // Everything below is armed and waiting, holding no time.
    let signals = 0

    const startSitting = () => {
      stateRef.current = createPendingReadingAttentionBlock()
      // `null` rather than a timestamp: the first station / page dwell anchors
      // itself to the first observed signal, which is also where the document
      // total starts accruing. That is what keeps them summing to each other.
      canvasRef.current = isCanvas ? createCanvasAttentionBlock(null) : null
      pdfRef.current = isPdf ? createPdfAttentionBlock(null) : null
      maxScrollRef.current = 0
      endScrollRef.current = null
      lastCheckpointRef.current = 0
      signals = 0
    }

    const publishLive = () => {
      const state = stateRef.current
      setReadingLiveStateBlock({
        measuring: true,
        path,
        source,
        startedAt: state?.firstEventMs !== null && state?.firstEventMs !== undefined
          ? new Date(state.firstEventMs).toISOString()
          : null,
        awaitingFirstSignal: state?.firstEventMs === null || state?.firstEventMs === undefined,
        activeMs: state?.creditedMs ?? 0,
        signals,
        stations: canvasRef.current ? canvasRef.current.closed.length + 1 : 0,
      })
    }

    startSitting()
    lastSignalRef.current = 0
    traceReadingBlock({ outcome: 'sitting-started', path })
    // Publish immediately: an empty panel was ambiguous between "never started"
    // and "started, nothing yet", and now those are genuinely different states.
    publishLive()

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

    /**
     * The finished sitting, or null when it never became one.
     *
     * Bounds come from the sitting's own observations — first signal to last —
     * never from now. A record that ended at `Date.now()` was claiming the
     * unobserved tail between the last scroll and whatever closed the document,
     * which is how a book left open overnight produced a 945-minute span.
     */
    const buildRecord = (
      opts: { silent?: boolean } = {},
    ): ThinkingspaceReadingRecord | null => {
      const state = stateRef.current
      if (!state || state.firstEventMs === null || state.lastEventMs === null) return null
      const creditedMs = state.creditedMs
      if (!isReportableAttentionBlock(creditedMs)) {
        if (!opts.silent) traceReadingBlock({ outcome: 'below-floor', path, activeMs: creditedMs })
        return null
      }
      const startMs = state.firstEventMs
      const endMs = state.lastEventMs
      let where: ThinkingspaceReadingWhere | undefined
      if (isCanvas) {
        const stations = canvasRef.current
          ? finishCanvasAttentionBlock(
              canvasRef.current, endMs, optionsRef.current.canvasSamplers?.sampleElements,
            )
          : []
        if (stations.length > 0) where = { kind: 'canvas', stations }
      } else if (isPdf) {
        const { pages, maxPage } = pdfRef.current
          ? finishPdfAttentionBlock(pdfRef.current, endMs)
          : { pages: [], maxPage: 0 }
        if (pages.length > 0) where = { kind: 'pdf', pages, maxPage }
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
        recordedAt: Date.now(),
        ...(where ? { where } : {}),
      }
    }

    // Journal first, synchronously, then attempt the vault. If the app dies
    // between the two the next launch drains it; if the vault takes it, the
    // journal entry is forgotten.
    const emit = (record: ThinkingspaceReadingRecord) => {
      checkpointReadingJournalBlock(record)
      // Fire-and-forget: the writer is module-level and serialized, so it
      // outlives this component's unmount.
      void appendReadingSpan(getVaultFS(), record).then(durable => {
        if (durable) clearReadingJournalEntryBlock(record.key)
      })
    }

    const creditAt = (at: number) => {
      // A gap wider than the ceiling is not a quiet stretch of reading, it is
      // two sittings with an absence between them. Closing the first one here —
      // retroactively, at the last thing it observed — is what keeps a document
      // left open across a night from swallowing the next day's reading into a
      // span filed under yesterday.
      const previous = stateRef.current
      if (previous && isReadingSittingBreakBlock(previous, at)) {
        const record = buildRecord()
        traceReadingBlock({
          outcome: 'sitting-ended', path, activeMs: previous.creditedMs, detail: 'idle break',
        })
        if (record) emit(record)
        startSitting()
      }

      signals += 1
      if (stateRef.current) stateRef.current = creditReadingAttentionBlock(stateRef.current, at)
      publishLive()
      // Write-ahead: the span so far goes somewhere synchronous, so a memory
      // kill or force-quit costs the last few seconds rather than the sitting.
      // Throttled — this is a main-thread localStorage write.
      if (at - lastCheckpointRef.current >= JOURNAL_CHECKPOINT_INTERVAL_MS) {
        lastCheckpointRef.current = at
        const snapshot = buildRecord({ silent: true })
        if (snapshot) checkpointReadingJournalBlock(snapshot)
      }
      if (pdfRef.current) {
        const page = optionsRef.current.pageSampler?.() ?? null
        pdfRef.current = page !== null
          ? observePdfPageBlock(pdfRef.current, page, at)
          : creditPdfAttentionBlock(pdfRef.current, at)
      }
      if (!canvasRef.current) return
      const samplers = optionsRef.current.canvasSamplers
      const rect = samplers?.sample() ?? null
      canvasRef.current = rect
        ? observeCanvasViewportBlock(
            canvasRef.current, rect, at, samplers?.sampleElements,
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

    /**
     * Leaving freezes the clock. It does *not* credit.
     *
     * The old version credited the gap up to the moment of leaving, on the
     * theory that you were reading right until you switched away. That holds
     * for a document you close when you finish and fails for one sitting open
     * in a pane while you work elsewhere — where it minted up to five minutes
     * on every app switch, for a document nobody had looked at. In Electron a
     * window that is blurred but still visible never fires visibilitychange,
     * so `blur` is the only event that catches switching to another app.
     */
    const onLeave = () => {
      if (stateRef.current) stateRef.current = suspendReadingAttentionBlock(stateRef.current)
      if (canvasRef.current?.current) {
        canvasRef.current = {
          ...canvasRef.current,
          current: {
            rect: canvasRef.current.current.rect,
            attention: suspendReadingAttentionBlock(canvasRef.current.current.attention),
          },
        }
      }
      if (pdfRef.current?.current) {
        pdfRef.current = {
          ...pdfRef.current,
          current: {
            page: pdfRef.current.current.page,
            attention: suspendReadingAttentionBlock(pdfRef.current.current.attention),
          },
        }
      }
    }

    // Flush without ending the sitting. Closing a window does not reliably
    // unmount React, so without this the last sitting of every session — the
    // one that ends by quitting — would be lost silently. The key is stable,
    // so the real close merges over this row rather than duplicating it, and
    // mergeReadingRecordsBlock keeps whichever measured more attention.
    // Nothing is credited here: a flush is not a sign that anyone was reading.
    const flush = () => {
      const record = buildRecord()
      if (record) emit(record)
    }

    // Returning needs no handler. The state is suspended, so the next real
    // signal re-arms the clock from itself and the absence costs nothing —
    // and if the absence was long enough, `creditAt` breaks the sitting first.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') return
      onLeave()
      flush()
    }

    // Keydown cannot be scoped to the element: a PDF binds its page-turn
    // shortcuts on `window`, so reading by arrow key with focus on `body` is
    // normal and must count. Instead it is refused when focus is in an editable
    // field somewhere else — which is what "typing in a side panel while a
    // document happens to be open" looks like.
    const onKeySignal = (event: Event) => {
      const focused = document.activeElement as HTMLElement | null
      if (focused && focused !== document.body) {
        const root = optionsRef.current.surfaceRef?.current ?? null
        const outside = !root || !root.contains(focused)
        const editable = focused.tagName === 'INPUT'
          || focused.tagName === 'TEXTAREA'
          || focused.isContentEditable === true
        if (outside && editable) return
      }
      onSignal(event)
    }

    const presenceEvents = isCanvas ? CANVAS_PRESENCE_EVENTS : TEXT_PRESENCE_EVENTS
    // Bound to the element present when the sitting started. A surface that
    // swaps its root mid-sitting ends the sitting anyway, because `attending`
    // flips with it.
    const bindTarget: EventTarget = options.surfaceRef?.current ?? document
    for (const type of presenceEvents) {
      bindTarget.addEventListener(type, onSignal, { passive: true, capture: true })
    }
    window.addEventListener('keydown', onKeySignal, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onLeave)
    window.addEventListener('pagehide', flush)

    return () => {
      for (const type of presenceEvents) {
        bindTarget.removeEventListener(type, onSignal, { capture: true })
      }
      window.removeEventListener('keydown', onKeySignal)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('pagehide', flush)

      const state = stateRef.current
      const record = buildRecord()
      traceReadingBlock({ outcome: 'sitting-ended', path, activeMs: state?.creditedMs ?? 0 })
      stateRef.current = null
      canvasRef.current = null
      pdfRef.current = null
      setReadingLiveStateBlock(null)
      if (record) emit(record)
    }
  }, [path, attending, hasForeground])
}
