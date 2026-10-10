import { describe, expect, it } from 'vitest'
import {
  buildPlanUsageDaysBlock,
  formatPlanUsagePctBlock,
  planUsageProviderIdsBlock,
  providersWithPlanUsageHistoryBlock,
  type PlanUsageMoveBlock,
} from '@/services/lego_blocks/units/aiPlanUsageHistoryBlock'

/**
 * The weekly limit by day and project.
 *
 * The ledger has already decided who moved the meter; what is tested here is
 * only that a movement lands on the right day, under the right project, and
 * that movement nobody can be tied to is never handed to a project.
 */

/** Noon local time on a given day, so no timezone can push it across midnight. */
const noon = (iso: string): number => Math.floor(new Date(`${iso}T12:00:00`).getTime() / 1000)

const PROJECTS = new Map([
  ['sid-a', 'alpha'],
  ['sid-b', 'beta'],
])
const DATES = ['2026-10-05', '2026-10-06', '2026-10-07']

const move = (
  iso: string,
  baseSid: string | null,
  pct: number,
  provider: PlanUsageMoveBlock['provider'] = 'claude',
): PlanUsageMoveBlock => ({ t: noon(iso), provider, baseSid, pct })

describe('buildPlanUsageDaysBlock', () => {
  it('returns one row per requested date, in order, zeros included', () => {
    const days = buildPlanUsageDaysBlock([move('2026-10-06', 'sid-a', 4)], PROJECTS, DATES, 'claude')
    expect(days.map(d => d.date)).toEqual(DATES)
    expect(days[0]).toEqual({ date: '2026-10-05', byProject: {}, unattributed: 0 })
    expect(days[1].byProject).toEqual({ alpha: 4 })
  })

  it('sums a project across sessions and movements on the same day', () => {
    const projects = new Map([...PROJECTS, ['sid-c', 'alpha']])
    const days = buildPlanUsageDaysBlock(
      [move('2026-10-05', 'sid-a', 2), move('2026-10-05', 'sid-c', 3), move('2026-10-05', 'sid-b', 1)],
      projects,
      DATES,
      'claude',
    )
    expect(days[0].byProject).toEqual({ alpha: 5, beta: 1 })
  })

  it('keeps movement with no known session out of every project', () => {
    const days = buildPlanUsageDaysBlock(
      [move('2026-10-07', null, 6), move('2026-10-07', 'sid-from-another-machine', 2)],
      PROJECTS,
      DATES,
      'claude',
    )
    expect(days[2]).toEqual({ date: '2026-10-07', byProject: {}, unattributed: 8 })
  })

  it('reads one provider at a time and ignores days outside the range', () => {
    const moves = [
      move('2026-10-06', 'sid-a', 4),
      move('2026-10-06', 'sid-b', 9, 'codex'),
      move('2026-09-30', 'sid-a', 50),
    ]
    const claude = buildPlanUsageDaysBlock(moves, PROJECTS, DATES, 'claude')
    const codex = buildPlanUsageDaysBlock(moves, PROJECTS, DATES, 'codex')
    expect(claude[1].byProject).toEqual({ alpha: 4 })
    expect(codex[1].byProject).toEqual({ beta: 9 })
  })
})

describe('providersWithPlanUsageHistoryBlock', () => {
  it('lists only providers whose meter actually moved, Claude first', () => {
    expect(providersWithPlanUsageHistoryBlock([])).toEqual([])
    expect(
      providersWithPlanUsageHistoryBlock([
        move('2026-10-06', 'sid-b', 1, 'codex'),
        move('2026-10-06', 'sid-a', 0),
      ]),
    ).toEqual(['codex'])
    expect(
      providersWithPlanUsageHistoryBlock([
        move('2026-10-06', 'sid-b', 1, 'codex'),
        move('2026-10-06', 'sid-a', 2),
      ]),
    ).toEqual(['claude', 'codex'])
  })
})

describe('planUsageProviderIdsBlock', () => {
  const live = (id: 'claude' | 'codex', detected: boolean) => ({
    id,
    label: id,
    plan: null,
    state: 'ready' as const,
    detected,
    hasPlan: true,
    session: null,
    weekly: null,
  })

  it('offers a provider with a live meter, a history, or both, Claude first', () => {
    expect(planUsageProviderIdsBlock([], [])).toEqual([])
    // History only — a browser or a phone, where nothing can be read live.
    expect(planUsageProviderIdsBlock([], [move('2026-10-06', 'sid-b', 1, 'codex')])).toEqual(['codex'])
    // A live meter only — the day the status line is first connected.
    expect(
      planUsageProviderIdsBlock([live('claude', true)], [move('2026-10-06', 'sid-b', 1, 'codex')]),
    ).toEqual(['claude', 'codex'])
    // A provider that is not used on this machine never earns a slot.
    expect(planUsageProviderIdsBlock([live('codex', false)], [])).toEqual([])
  })
})

describe('formatPlanUsagePctBlock', () => {
  it('shows a sliver as less than a point rather than zero', () => {
    expect(formatPlanUsagePctBlock(0)).toBe('0%')
    expect(formatPlanUsagePctBlock(0.2)).toBe('<1%')
    expect(formatPlanUsagePctBlock(12.4)).toBe('12%')
  })
})
