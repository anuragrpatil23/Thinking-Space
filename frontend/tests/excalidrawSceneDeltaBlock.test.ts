// See docs/contracts/DURABILITY.md.
//
// The property that matters: baseline + delta must reproduce the current scene
// exactly. If it does not, recovery hands back a drawing that is subtly not the
// one that was lost — which is worse than admitting the loss.

import { describe, it, expect } from 'vitest'

import {
  computeExcalidrawDeltaBlock,
  applyExcalidrawDeltaBlock,
  excalidrawDeltaHasWorkBlock,
  excalidrawDeltaSizeBlock,
  type ExcalidrawElementLikeBlock,
} from '@/services/lego_blocks/units/excalidrawSceneDeltaBlock'

const el = (id: string, version = 1, extra: Record<string, unknown> = {}):
  ExcalidrawElementLikeBlock => ({ id, version, type: 'freedraw', ...extra })

const roundTrip = (
  baseline: ExcalidrawElementLikeBlock[],
  current: ExcalidrawElementLikeBlock[],
) => applyExcalidrawDeltaBlock(baseline, computeExcalidrawDeltaBlock(baseline, current))

describe('baseline + delta reproduces the scene', () => {
  const baseline = [el('a'), el('b'), el('c')]

  it('when nothing changed', () => {
    expect(roundTrip(baseline, baseline)).toEqual(baseline)
  })

  // The annotation case: freedraw strokes added on top of a generated mindmap.
  it('when elements are added', () => {
    const current = [...baseline, el('ann1'), el('ann2')]
    expect(roundTrip(baseline, current)).toEqual(current)
  })

  it('when an element is mutated', () => {
    const current = [el('a'), el('b', 7, { strokeColor: '#f00' }), el('c')]
    expect(roundTrip(baseline, current)).toEqual(current)
  })

  it('when elements are deleted', () => {
    const current = [el('a'), el('c')]
    expect(roundTrip(baseline, current)).toEqual(current)
  })

  it('when elements are reordered', () => {
    // z-order is real information; a changed-elements-only delta loses it.
    const current = [el('c'), el('a'), el('b')]
    expect(roundTrip(baseline, current)).toEqual(current)
  })

  it('when everything is deleted', () => {
    expect(roundTrip(baseline, [])).toEqual([])
  })

  it('when starting from an empty file', () => {
    const current = [el('x'), el('y')]
    expect(roundTrip([], current)).toEqual(current)
  })

  it('under add, mutate, delete and reorder at once', () => {
    const current = [el('new'), el('c'), el('a', 9, { x: 40 })]
    expect(roundTrip(baseline, current)).toEqual(current)
  })
})

describe('the delta stays small', () => {
  it('carries only what changed, not the whole scene', () => {
    // Stand-in for the real file: 248 text elements averaging 8,852 bytes.
    const heavy = Array.from({ length: 248 }, (_, i) =>
      el(`text-${i}`, 1, { type: 'text', text: 'x'.repeat(8_000) }))
    const annotated = [...heavy, el('stroke-1', 1, { points: [[0, 0], [1, 1]] })]

    const delta = computeExcalidrawDeltaBlock(heavy, annotated)
    expect(delta.changed).toHaveLength(1)

    // The delta is dominated by the id list, not by the book text.
    const sceneSize = JSON.stringify(annotated).length
    expect(excalidrawDeltaSizeBlock(delta)).toBeLessThan(sceneSize / 50)
    expect(roundTrip(heavy, annotated)).toEqual(annotated)
  })

  it('does not re-send an untouched element with the same version', () => {
    const baseline = [el('a', 3), el('b', 3)]
    // A different object identity, same version — Excalidraw hands back fresh
    // arrays constantly, so identity alone would make every element "changed".
    const current = [{ ...baseline[0] }, { ...baseline[1] }]
    expect(computeExcalidrawDeltaBlock(baseline, current).changed).toHaveLength(0)
  })
})

describe('excalidrawDeltaHasWorkBlock', () => {
  const baseline = [el('a'), el('b')]

  it('is false when nothing happened', () => {
    const delta = computeExcalidrawDeltaBlock(baseline, baseline)
    expect(excalidrawDeltaHasWorkBlock(baseline, delta)).toBe(false)
  })

  it('is true for an addition, a mutation, a deletion and a reorder', () => {
    for (const current of [
      [...baseline, el('c')],
      [el('a', 5), el('b')],
      [el('a')],
      [el('b'), el('a')],
    ]) {
      const delta = computeExcalidrawDeltaBlock(baseline, current)
      expect(excalidrawDeltaHasWorkBlock(baseline, delta)).toBe(true)
    }
  })
})

describe('recovery is forgiving', () => {
  it('drops an id it cannot resolve rather than failing outright', () => {
    // A delta written before the file changed underneath it. Producing what we
    // can beats refusing to produce anything.
    const recovered = applyExcalidrawDeltaBlock([el('a')], { order: ['a', 'ghost'], changed: [] })
    expect(recovered.map(e => e.id)).toEqual(['a'])
  })

  it('ignores malformed elements without throwing', () => {
    const current = [el('a'), null as unknown as ExcalidrawElementLikeBlock, el('b')]
    expect(() => computeExcalidrawDeltaBlock([], current)).not.toThrow()
    expect(computeExcalidrawDeltaBlock([], current).order).toEqual(['a', 'b'])
  })
})
