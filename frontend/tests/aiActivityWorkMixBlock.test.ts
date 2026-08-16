import { describe, expect, it } from 'vitest'
import {
  WORK_MIX_MIN_ARC_BLOCK,
  foldWorkMixDayBlock,
} from '@/services/lego_blocks/units/aiActivityWorkMixBlock'
import { buildProjectKindMapBlock } from '@/services/lego_blocks/units/projectKindBlock'

const H = 3_600_000

const kinds = buildProjectKindMapBlock([
  { key: 'F9', name: 'F9', kind: 'thinking' },
  { key: 'TS', name: 'Thinking-Space', aliases: ['thinking-space'], kind: 'building' },
  { key: 'SFW', name: 'Day job', kind: 'maintenance' },
  { key: 'RSS', name: 'Reading', kind: 'conditioning' },
])

describe('foldWorkMixDayBlock', () => {
  it('scales the fill against the pool, not against the day', () => {
    // 2h thinking beside 6h building is half a pool of thinking — not a sliver.
    const cell = foldWorkMixDayBlock({ F9: 2 * H, 'Thinking-Space': 6 * H }, kinds, 4)
    expect(cell.fill).toBeCloseTo(0.5)
    expect(cell.fillOvershoot).toBe(false)
  })

  it('clamps the fill at a full pool but records the overshoot', () => {
    const cell = foldWorkMixDayBlock({ F9: 6 * H }, kinds, 4)
    expect(cell.fill).toBe(1)
    expect(cell.fillOvershoot).toBe(true)
  })

  it('maps aliases to the same kind as the project key', () => {
    const viaAlias = foldWorkMixDayBlock({ 'thinking-space': 2 * H }, kinds, 4)
    expect(viaAlias.hoursByKind.building).toBeCloseTo(2)
  })

  it('gives each kind its own ring against the pool, not a shared perimeter', () => {
    // 1h building and 1h maintenance against a 4h pool → each ring a quarter,
    // independently. They do not divide one circle between them.
    const cell = foldWorkMixDayBlock({ 'Thinking-Space': H, 'Day job': H }, kinds, 4)
    expect(cell.segments.map(s => s.kind)).toEqual(['building', 'maintenance'])
    expect(cell.segments.map(s => s.sweep)).toEqual([0.25, 0.25])
  })

  it('closes a ring and steps its tone once that kind exceeds the pool', () => {
    const cell = foldWorkMixDayBlock({ 'Day job': 9 * H }, kinds, 4)
    const maint = cell.segments.find(s => s.kind === 'maintenance')!
    expect(maint.sweep).toBe(1)
    expect(maint.overshoot).toBe(2)
  })

  it('tracks overshoot per ring, not per cell', () => {
    // Maintenance blows past two pools; building is a modest half.
    const cell = foldWorkMixDayBlock({ 'Day job': 9 * H, 'Thinking-Space': 2 * H }, kinds, 4)
    expect(cell.segments.find(s => s.kind === 'building')!.overshoot).toBe(0)
    expect(cell.segments.find(s => s.kind === 'maintenance')!.overshoot).toBe(2)
  })

  it('keeps a fixed ring order so cells stay comparable', () => {
    const maintHeavy = foldWorkMixDayBlock({ 'Day job': 3 * H, 'Thinking-Space': H }, kinds, 4)
    expect(maintHeavy.segments.map(s => s.kind)).toEqual(['building', 'maintenance'])
  })

  it('floors a tiny arc so presence survives, leaving the hours honest', () => {
    const cell = foldWorkMixDayBlock({ 'Thinking-Space': 3 * H, 'Day job': 0.1 * H }, kinds, 4)
    const maint = cell.segments.find(s => s.kind === 'maintenance')!
    const build = cell.segments.find(s => s.kind === 'building')!
    expect(maint.sweep).toBeCloseTo(WORK_MIX_MIN_ARC_BLOCK)
    expect(maint.hours).toBeCloseTo(0.1) // the honest number is untouched
    // Independent rings, so the floor costs its sibling nothing.
    expect(build.sweep).toBeCloseTo(0.75)
  })

  it('names the top project per kind so each mark can wear its color', () => {
    const cell = foldWorkMixDayBlock(
      { F9: 2 * H, 'Thinking-Space': 3 * H, 'thinking-space': H, 'Day job': H },
      kinds,
      4,
    )
    expect(cell.thinkingProject).toBe('F9')
    expect(cell.segments.find(s => s.kind === 'building')!.topProject).toBe('Thinking-Space')
    expect(cell.segments.find(s => s.kind === 'maintenance')!.topProject).toBe('Day job')
  })

  it('counts unclassified projects as other, which draws nothing', () => {
    const cell = foldWorkMixDayBlock({ 'Some-Repo': 5 * H }, kinds, 4)
    expect(cell.hoursByKind.other).toBeCloseTo(5)
    expect(cell.segments).toHaveLength(0)
    expect(cell.fill).toBe(0)
    // Still activity — a cell with no marks is not the same as a day with no data.
    expect(cell.hasActivity).toBe(true)
  })

  it('keeps conditioning out of the ring but still reports its hours', () => {
    const cell = foldWorkMixDayBlock({ Reading: 2 * H }, kinds, 4)
    expect(cell.hoursByKind.conditioning).toBeCloseTo(2)
    expect(cell.segments).toHaveLength(0)
  })

  it('reports an empty day as no activity', () => {
    const cell = foldWorkMixDayBlock({}, kinds, 4)
    expect(cell.hasActivity).toBe(false)
    expect(cell.fill).toBe(0)
    expect(cell.segments).toHaveLength(0)
  })

  it('ignores negative and non-finite durations', () => {
    const cell = foldWorkMixDayBlock({ F9: -5 * H, 'Day job': Number.NaN }, kinds, 4)
    expect(cell.hasActivity).toBe(false)
  })

  it('honours a custom pool', () => {
    const cell = foldWorkMixDayBlock({ F9: 3 * H }, kinds, 6)
    expect(cell.fill).toBeCloseTo(0.5)
  })

  it('falls back to a sane pool when handed a bad one', () => {
    const cell = foldWorkMixDayBlock({ F9: 2 * H }, kinds, 0)
    expect(cell.fill).toBeCloseTo(0.5)
  })
})

