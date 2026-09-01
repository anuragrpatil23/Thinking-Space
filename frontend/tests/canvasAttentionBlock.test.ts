import { describe, it, expect } from 'vitest'
import {
  STATION_OVERLAP_THRESHOLD,
  createCanvasAttentionBlock,
  creditCanvasAttentionBlock,
  finishCanvasAttentionBlock,
  observeCanvasViewportBlock,
  viewportOverlapBlock,
} from '@/services/lego_blocks/units/canvasAttentionBlock'
import {
  IDLE_CEILING_MS,
  createReadingAttentionBlock,
  creditReadingAttentionBlock,
} from '@/services/lego_blocks/units/readingAttentionBlock'

const T0 = 1_756_500_000_000
const RECT = { x: 0, y: 0, w: 1000, h: 800 }
const SAME = { x: 20, y: 10, w: 1000, h: 800 }        // nudged; still the same place
const FAR = { x: 5000, y: 5000, w: 1000, h: 800 }     // somewhere else entirely

describe('viewportOverlapBlock', () => {
  it('is 1 for an identical rect and 0 for a disjoint one', () => {
    expect(viewportOverlapBlock(RECT, RECT)).toBe(1)
    expect(viewportOverlapBlock(RECT, FAR)).toBe(0)
  })

  // Measured against the smaller rect so zooming in and back out are the same
  // amount of movement. Dividing by the first rect would make one a total
  // change and the other a no-op.
  it('is symmetric under zoom', () => {
    const wide = { x: 0, y: 0, w: 4000, h: 3200 }
    const tight = { x: 100, y: 100, w: 500, h: 400 }
    expect(viewportOverlapBlock(wide, tight)).toBeCloseTo(viewportOverlapBlock(tight, wide), 10)
  })

  it('reports full overlap when one rect contains the other', () => {
    const inner = { x: 100, y: 100, w: 200, h: 200 }
    expect(viewportOverlapBlock(RECT, inner)).toBe(1)
  })

  it('treats a degenerate rect as no overlap rather than dividing by zero', () => {
    expect(viewportOverlapBlock(RECT, { x: 0, y: 0, w: 0, h: 0 })).toBe(0)
  })
})

describe('canvasAttentionBlock', () => {
  it('opens a station on the first viewport it sees', () => {
    const s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    expect(s.current?.rect).toEqual(RECT)
    expect(s.closed).toHaveLength(0)
  })

  it('keeps one station while the viewport only drifts', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    s = observeCanvasViewportBlock(s, SAME, T0 + 60_000)
    expect(s.closed).toHaveLength(0)
    expect(s.current?.rect).toEqual(RECT)
    expect(finishCanvasAttentionBlock(s, T0 + 60_000)).toHaveLength(1)
  })

  it('closes the station and opens another when the viewport moves away', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    s = observeCanvasViewportBlock(s, FAR, T0 + 120_000)
    expect(s.closed).toHaveLength(1)
    expect(s.closed[0].activeMs).toBe(120_000)
    expect(s.current?.rect).toEqual(FAR)
  })

  // The invariant that makes stations trustworthy: they partition the
  // document's attention rather than duplicating or losing part of it.
  it('partitions exactly the attention the document total credits', () => {
    const signals = [0, 30_000, 90_000, 91_000, 200_000, 260_000].map(d => T0 + d)
    const rects = [RECT, RECT, FAR, FAR, RECT, RECT]

    let doc = createReadingAttentionBlock(T0)
    let canvas = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), rects[0], signals[0])
    for (let i = 1; i < signals.length; i += 1) {
      doc = creditReadingAttentionBlock(doc, signals[i])
      canvas = observeCanvasViewportBlock(canvas, rects[i], signals[i])
    }
    const stations = finishCanvasAttentionBlock(canvas, signals[signals.length - 1])
    const summed = stations.reduce((acc, s) => acc + s.activeMs, 0)
    expect(summed).toBe(doc.creditedMs)
  })

  it('holds the invariant across a walk-away, ceiling and all', () => {
    let doc = createReadingAttentionBlock(T0)
    let canvas = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    const away = T0 + 40 * 60_000
    doc = creditReadingAttentionBlock(doc, away)
    canvas = observeCanvasViewportBlock(canvas, RECT, away)
    const stations = finishCanvasAttentionBlock(canvas, away)
    expect(doc.creditedMs).toBe(IDLE_CEILING_MS)
    expect(stations.reduce((a, s) => a + s.activeMs, 0)).toBe(IDLE_CEILING_MS)
  })

  it('credits presence that is not a viewport change', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    s = creditCanvasAttentionBlock(s, T0 + 45_000)
    expect(finishCanvasAttentionBlock(s, T0 + 45_000)[0].activeMs).toBe(45_000)
  })

  it('drops stations the viewport merely passed through', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    // Three moves in the same instant — panning across, resting nowhere.
    s = observeCanvasViewportBlock(s, FAR, T0)
    s = observeCanvasViewportBlock(s, { x: -9000, y: 0, w: 1000, h: 800 }, T0)
    s = creditCanvasAttentionBlock(s, T0 + 90_000)
    const stations = finishCanvasAttentionBlock(s, T0 + 90_000)
    expect(stations).toHaveLength(1)
    expect(stations[0].activeMs).toBe(90_000)
  })

  it('samples element ids once, only when a station closes', () => {
    const seen: Array<{ x: number }> = []
    const sampler = (rect: { x: number }) => { seen.push(rect); return ['a', 'b'] }
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0, sampler)
    s = observeCanvasViewportBlock(s, SAME, T0 + 10_000, sampler)   // no close
    expect(seen).toHaveLength(0)
    s = observeCanvasViewportBlock(s, FAR, T0 + 20_000, sampler)    // closes RECT
    expect(seen).toHaveLength(1)
    expect(s.closed[0].elementIds).toEqual(['a', 'b'])
  })

  it('omits elementIds when the sampler finds nothing', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0, () => [])
    s = observeCanvasViewportBlock(s, FAR, T0 + 20_000, () => [])
    expect(s.closed[0].elementIds).toBeUndefined()
  })

  it('ignores a null viewport rather than losing the current station', () => {
    let s = observeCanvasViewportBlock(createCanvasAttentionBlock(T0), RECT, T0)
    s = observeCanvasViewportBlock(s, null, T0 + 30_000)
    expect(s.current?.rect).toEqual(RECT)
  })

  it('pins the overlap threshold that decides what one place means', () => {
    expect(STATION_OVERLAP_THRESHOLD).toBe(0.5)
  })

  // The invariant broke in production the first time it ran: the canvas is not
  // ready when a sitting starts, so the first station opened seconds late and
  // those seconds belonged to no station. 237s of stations against 240s of
  // document attention.
  it('covers the canvas load time in the first station', () => {
    const started = T0
    const canvasReady = T0 + 3_000
    let doc = createReadingAttentionBlock(started)
    let canvas = createCanvasAttentionBlock(started)

    // Nothing to sample until the scene loads.
    canvas = observeCanvasViewportBlock(canvas, null, T0 + 1_000)
    doc = creditReadingAttentionBlock(doc, T0 + 1_000)
    canvas = observeCanvasViewportBlock(canvas, RECT, canvasReady)
    doc = creditReadingAttentionBlock(doc, canvasReady)
    canvas = observeCanvasViewportBlock(canvas, RECT, T0 + 120_000)
    doc = creditReadingAttentionBlock(doc, T0 + 120_000)

    const stations = finishCanvasAttentionBlock(canvas, T0 + 120_000)
    expect(stations.reduce((a, s) => a + s.activeMs, 0)).toBe(doc.creditedMs)
  })
})
