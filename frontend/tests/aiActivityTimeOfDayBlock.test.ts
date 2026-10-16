import { describe, expect, it } from 'vitest'
import { timeOfDaySegmentsBlock } from '@/services/lego_blocks/units/aiActivityTimeOfDayBlock'

const at = (day: string, hh: number, mm = 0) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
const s = (startedIso: string, endedIso: string, project = 'F9', topic = 't') => ({ startedIso, endedIso, project, topic })

describe('timeOfDaySegmentsBlock', () => {
  const days = ['2026-10-13', '2026-10-14']

  it('places a session on its day in minutes after midnight', () => {
    const out = timeOfDaySegmentsBlock(days, [s(at('2026-10-13', 9), at('2026-10-13', 10, 30))])
    expect(out.get('2026-10-13')).toMatchObject([{ startMin: 540, endMin: 630 }])
    expect(out.get('2026-10-14')).toEqual([])
  })

  it('splits a session across midnight into both rows', () => {
    const out = timeOfDaySegmentsBlock(days, [s(at('2026-10-13', 23), at('2026-10-14', 1))])
    expect(out.get('2026-10-13')).toMatchObject([{ startMin: 1380, endMin: 1440 }])
    expect(out.get('2026-10-14')).toMatchObject([{ startMin: 0, endMin: 60 }])
  })

  it('keeps a zero-span session as a tick on its own day only', () => {
    const t = at('2026-10-14', 8)
    const out = timeOfDaySegmentsBlock(days, [s(t, t)])
    expect(out.get('2026-10-14')).toMatchObject([{ startMin: 480, endMin: 480 }])
    expect(out.get('2026-10-13')).toEqual([])
  })

  it('drops noise buckets and honours the project filter', () => {
    const out = timeOfDaySegmentsBlock(
      days,
      [s(at('2026-10-13', 9), at('2026-10-13', 10), '[auto-commit]'), s(at('2026-10-13', 11), at('2026-10-13', 12), 'sfdl')],
      'F9',
    )
    expect(out.get('2026-10-13')).toEqual([])
  })
})

import { packTimeOfDayRowBlock } from '@/services/lego_blocks/units/aiActivityTimeOfDayBlock'

const seg = (startMin: number, endMin: number, project = 'F9') => ({
  startMin, endMin, project, topic: 't', startIso: String(startMin), endIso: String(endMin),
})

describe('packTimeOfDayRowBlock', () => {
  it('fuses same-project segments separated by a short gap', () => {
    const { items, lanes } = packTimeOfDayRowBlock([seg(60, 120), seg(125, 180)])
    expect(lanes).toBe(1)
    expect(items).toMatchObject([{ startMin: 60, endMin: 180, lane: 0 }])
  })

  it('keeps a real break as two blocks', () => {
    expect(packTimeOfDayRowBlock([seg(60, 120), seg(150, 180)]).items).toHaveLength(2)
  })

  it('moves an overlapping project to a second lane instead of drawing over it', () => {
    const { items, lanes } = packTimeOfDayRowBlock([seg(60, 200, 'a'), seg(100, 150, 'b'), seg(210, 260, 'c')])
    expect(lanes).toBe(2)
    expect(items.map(i => [i.project, i.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]])
  })
})

import { timeOfDayTotalsBlock } from '@/services/lego_blocks/units/aiActivityTimeOfDayBlock'

describe('timeOfDayTotalsBlock', () => {
  it('counts overlapping time once per key and once per day', () => {
    const byDay = new Map([
      ['d1', [seg(0, 60, 'a'), seg(30, 90, 'b'), seg(120, 150, 'a')]],
      ['d2', [seg(0, 30, 'a')]],
    ])
    const kind = (p: string) => (p === 'a' ? 'building' : 'thinking')
    const totals = timeOfDayTotalsBlock(byDay, kind)
    expect(totals.byDay.get('d1')).toBe(120) // 0–90 ∪ 120–150
    expect(totals.byKey.get('building')).toBe(60 + 30 + 30)
    expect(totals.byKey.get('thinking')).toBe(60)
  })

  it('merges two parallel sessions of the same key', () => {
    const totals = timeOfDayTotalsBlock(new Map([['d', [seg(0, 60, 'a'), seg(0, 60, 'c')]]]), () => 'building')
    expect(totals.byKey.get('building')).toBe(60)
  })
})
