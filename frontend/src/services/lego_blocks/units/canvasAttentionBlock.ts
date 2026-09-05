// Where on a canvas the attention went.
//
// A markdown document has an extent, so "you read this for 25 minutes" is
// already a statement about the whole of it. A canvas does not: it is
// unbounded, and 25 minutes on one says almost nothing without *where*. So a
// canvas span carries stations — the places the viewport rested, and how long
// it rested there.
//
// What is stored is the viewport rect, which is an observation. Which elements
// or frames that rect covers is an interpretation, and interpretations are
// recomputed on read (docs/contracts/DERIVATION.md) rather than frozen at
// capture. Three things follow:
//
//   - Cost does not scale with the canvas. A 2,000-element scene costs the
//     same to record as a 5-element one.
//   - Zoom weighting stays a read-time policy. The rect's size *is* the zoom,
//     so a rule about what counts as "looking closely" can change later
//     without the data having been thrown away.
//   - A frame drawn tomorrow explains attention from last month, because
//     frame membership is computed against today's scene. Storing frame ids
//     could never do that.
//
// `elementIds` is the one interpretation captured at write time, and it is a
// *hint*, not the record. It is taken once when a station closes — a few dozen
// times a sitting, not once per pointer event — so it costs nothing on the hot
// path. Its job is to make scene drift detectable: the ids and the rect agreed
// when they were written, so if re-intersecting the rect today disagrees with
// them, the scene moved and a reader can say so instead of confidently
// answering the wrong question. Same shape as inkAnchorBlock's anchor text
// plus neighbour-context hash, where disagreement produces an explicit orphan.

import {
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
  type ReadingAttentionStateBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'

/** A viewport rectangle in canvas world coordinates. */
export interface CanvasViewportRectBlock {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasStationBlock extends CanvasViewportRectBlock {
  /** Attention credited while the viewport rested here, ms. */
  activeMs: number
  /** Elements intersecting the rect when the station closed. A hint for drift
   *  detection — never the authoritative answer to "what did I look at". */
  elementIds?: string[]
}

export interface CanvasAttentionStateBlock {
  /** Stations already closed, in the order they were visited. */
  closed: CanvasStationBlock[]
  /** The station being credited right now. */
  current: { rect: CanvasViewportRectBlock; attention: ReadingAttentionStateBlock } | null
  /** Sitting start, until the first station opens and inherits it. */
  pendingSinceMs: number | null
}

/**
 * Fraction of the *smaller* rect covered by the intersection. Using the
 * smaller one keeps zooming symmetric: zooming in and back out are the same
 * amount of movement, where dividing by the first rect would call one of them
 * a total change and the other a no-op.
 */
export function viewportOverlapBlock(
  a: CanvasViewportRectBlock,
  b: CanvasViewportRectBlock,
): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const areaA = a.w * a.h
  const areaB = b.w * b.h
  const smaller = Math.min(areaA, areaB)
  if (!(smaller > 0)) return 0
  return Math.min(1, (w * h) / smaller)
}

/** Below this overlap with the current station, the viewport has moved
 *  somewhere else and a new station opens. Half is deliberately loose: small
 *  adjusting pans while reading one region should not shatter it into dozens
 *  of stations, and the read side can always merge neighbours but can never
 *  un-merge them. */
export const STATION_OVERLAP_THRESHOLD = 0.5

/**
 * @param sinceMs When the sitting began. The canvas is not ready at that
 * instant — the scene has to load before a viewport means anything — so the
 * first station opens some seconds later. Anchoring it here makes it cover
 * that lead-in, which is what keeps the stations summing to the document's
 * own total. Without it the first real recording was off by 3s of 240s: time
 * the document counted and no station claimed.
 */
export function createCanvasAttentionBlock(sinceMs: number | null): CanvasAttentionStateBlock {
  return { closed: [], current: null, pendingSinceMs: sinceMs }
}

function closeCurrent(
  state: CanvasAttentionStateBlock,
  nowMs: number,
  elementIds?: string[],
): CanvasStationBlock[] {
  if (!state.current) return state.closed
  const credited = creditReadingAttentionBlock(state.current.attention, nowMs)
  const station: CanvasStationBlock = {
    ...state.current.rect,
    activeMs: credited.creditedMs,
    ...(elementIds && elementIds.length > 0 ? { elementIds } : {}),
  }
  return [...state.closed, station]
}

/**
 * Credit the current station and, if the viewport has moved far enough, close
 * it and open a new one at `rect`.
 *
 * Crediting happens before any switch, so the time up to the moment of moving
 * belongs to where the viewport actually was. That is what keeps the totals
 * consistent: every millisecond credited to the document is credited to
 * exactly one station, so the stations partition the total rather than
 * duplicating or losing part of it.
 *
 * `elementIdsAt` is called only when a station actually closes.
 */
export function observeCanvasViewportBlock(
  state: CanvasAttentionStateBlock,
  rect: CanvasViewportRectBlock | null,
  nowMs: number,
  elementIdsAt?: (rect: CanvasViewportRectBlock) => string[],
): CanvasAttentionStateBlock {
  if (!rect || !Number.isFinite(nowMs)) return state

  if (!state.current) {
    // Anchor the first station at the sitting's start, not at now, so the
    // canvas's load time is credited somewhere rather than vanishing.
    const from = state.pendingSinceMs ?? nowMs
    return {
      closed: state.closed,
      current: { rect, attention: createReadingAttentionBlock(from) },
      pendingSinceMs: null,
    }
  }

  const overlap = viewportOverlapBlock(state.current.rect, rect)
  if (overlap >= STATION_OVERLAP_THRESHOLD) {
    return {
      closed: state.closed,
      current: {
        rect: state.current.rect,
        attention: creditReadingAttentionBlock(state.current.attention, nowMs),
      },
      pendingSinceMs: null,
    }
  }

  const closed = closeCurrent(state, nowMs, elementIdsAt?.(state.current.rect))
  return {
    closed,
    current: { rect, attention: createReadingAttentionBlock(nowMs) },
    pendingSinceMs: null,
  }
}

/** Credit the current station without considering a move — for signals that
 *  are presence but not viewport changes (a keystroke, a pointer hover). */
export function creditCanvasAttentionBlock(
  state: CanvasAttentionStateBlock,
  nowMs: number,
): CanvasAttentionStateBlock {
  if (!state.current || !Number.isFinite(nowMs)) return state
  return {
    closed: state.closed,
    current: {
      rect: state.current.rect,
      attention: creditReadingAttentionBlock(state.current.attention, nowMs),
    },
    pendingSinceMs: null,
  }
}

/** Finish the sitting: close the open station and return every station.
 *  Stations carrying no attention are dropped — a viewport passed through on
 *  the way somewhere else was not a place you looked. */
export function finishCanvasAttentionBlock(
  state: CanvasAttentionStateBlock,
  nowMs: number,
  elementIdsAt?: (rect: CanvasViewportRectBlock) => string[],
): CanvasStationBlock[] {
  const all = state.current
    ? closeCurrent(state, nowMs, elementIdsAt?.(state.current.rect))
    : state.closed
  return all.filter(s => s.activeMs > 0)
}
