import { describe, expect, it } from 'vitest'
import { overlappingModelDiagramLabelsBlock, placeModelDiagramLabelsBlock, type ModelDiagramLabelBoxBlock } from '../src/services/lego_blocks/units/modelDiagramLabelsBlock'

const box = (x: number, y: number, more: Partial<ModelDiagramLabelBoxBlock> = {}): ModelDiagramLabelBoxBlock => ({ x, y, w: 100, h: 20, rank: 50, ...more })
const rects = (boxes: ModelDiagramLabelBoxBlock[]) => {
  const place = placeModelDiagramLabelsBlock(boxes)
  return boxes.flatMap((b, i) => {
    const p = place[i]
    if (p.fate === 'hidden') return []
    const w = p.fate === 'short' ? b.shortW! : b.w, h = p.fate === 'short' ? b.shortH! : b.h
    return [{ x0: b.x + p.dx - w / 2, y0: b.y + p.dy - h / 2, x1: b.x + p.dx + w / 2, y1: b.y + p.dy + h / 2 }]
  })
}

describe('placeModelDiagramLabelsBlock', () => {
  it('shows both of two labels that do not touch', () => {
    expect(placeModelDiagramLabelsBlock([box(0, 0), box(300, 0)]).map((p) => p.fate)).toEqual(['full', 'full'])
  })

  it('hides the lower-ranked of two that overlap, whatever their order', () => {
    expect(placeModelDiagramLabelsBlock([box(0, 0, { rank: 30 }), box(50, 5, { rank: 90 })]).map((p) => p.fate)).toEqual(['hidden', 'full'])
  })

  it('slides a title a line away instead of hiding it', () => {
    const place = placeModelDiagramLabelsBlock([box(0, 0, { mode: 'slide', rank: 100 }), box(40, 0, { mode: 'slide', rank: 100 })])
    expect(place.map((p) => p.fate)).toEqual(['full', 'full'])
    expect(place[1].dy).toBe(-23)
  })

  it('moves a title half its width sideways when no line above or below is free', () => {
    const wall = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((k) => box(0, k * 23, { mode: 'fixed', w: 60 }))
    const place = placeModelDiagramLabelsBlock([...wall, box(75, 0, { mode: 'slide', shortW: 20, shortH: 20 })])
    expect(place[wall.length].fate).toBe('full')
    expect(place[wall.length].dx).toBeGreaterThan(0)
  })

  it('shrinks a title to its number only when no place is free, and never lays it over another label', () => {
    const wall = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6].map((k) => box(0, k * 23, { mode: 'fixed', w: 600 }))
    wall.push(box(-170, 0, { mode: 'fixed', w: 300 }), box(170, 0, { mode: 'fixed', w: 300 }))
    const boxes = [...wall, box(0, 0, { mode: 'slide', shortW: 20, shortH: 20 })]
    const place = placeModelDiagramLabelsBlock(boxes)
    expect(place[wall.length].fate).toBe('short')
  })

  it('always shows fixed labels where the layout put them', () => {
    const place = placeModelDiagramLabelsBlock([box(0, 0, { mode: 'fixed' }), box(10, 5, { mode: 'fixed' }), box(5, 2, { rank: 99 })])
    expect(place).toEqual([{ fate: 'full', dx: 0, dy: 0 }, { fate: 'full', dx: 0, dy: 0 }, { fate: 'hidden', dx: 0, dy: 0 }])
  })

  it('moves a nudged label by the smallest step that clears a fixed one, and never hides it', () => {
    const place = placeModelDiagramLabelsBlock([box(0, 0, { mode: 'fixed' }), box(0, 12, { mode: 'nudge' }), box(0, 0, { mode: 'nudge', w: 2000, h: 2000 })])
    expect(place[1]).toEqual({ fate: 'full', dx: 0, dy: 14 })
    expect(place[2].fate).toBe('full')
  })

  it('leaves no two shown labels overlapping in a crowd, fixed ones aside', () => {
    const boxes: ModelDiagramLabelBoxBlock[] = []
    for (let i = 0; i < 200; i++) boxes.push(box((i * 37) % 900, (i * 53) % 500, { rank: i % 7, mode: i % 9 === 0 ? 'slide' : undefined, shortW: 20, shortH: 20 }))
    const shown = rects(boxes)
    expect(shown.length).toBeGreaterThan(20)
    expect(overlappingModelDiagramLabelsBlock(shown)).toEqual([])
  })
})
