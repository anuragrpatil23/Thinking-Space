import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAllRunningJobsBlock,
  cancelRunningJobBlock,
  listRunningJobsBlock,
  registerRunningJobBlock,
} from '@/services/lego_blocks/units/intelligence/runningJobsBlock'

// The request timeout is 30 minutes because reasoning is unbounded and local
// inference is slow. That is only safe if a stuck job can be killed — with two
// concurrency slots, two wedged jobs would otherwise stall every digest for
// half an hour.

function job(taskId: string, cancel = vi.fn()) {
  return { dispose: registerRunningJobBlock({ taskId, model: 'm', providerId: 'openai-compat', cancel }), cancel }
}

describe('running jobs registry', () => {
  beforeEach(() => { cancelAllRunningJobsBlock(); for (const j of listRunningJobsBlock()) void j })

  it('starts empty once everything has unwound', () => {
    const a = job('one')
    a.dispose()
    expect(listRunningJobsBlock()).toHaveLength(0)
  })

  it('lists an in-flight job and forgets it on dispose', () => {
    const a = job('chain-digest')
    expect(listRunningJobsBlock().map(j => j.taskId)).toContain('chain-digest')
    a.dispose()
    expect(listRunningJobsBlock().map(j => j.taskId)).not.toContain('chain-digest')
  })

  it('cancelling invokes the abort hook', () => {
    const a = job('day-atom')
    const id = listRunningJobsBlock().find(j => j.taskId === 'day-atom')!.id
    expect(cancelRunningJobBlock(id)).toBe(true)
    expect(a.cancel).toHaveBeenCalledTimes(1)
    a.dispose()
  })

  it('keeps the entry until the run actually unwinds', () => {
    // Removing on cancel would hide a job that is still holding a queue slot,
    // which is exactly the state the user needs to see.
    const a = job('range-narrate')
    const id = listRunningJobsBlock().find(j => j.taskId === 'range-narrate')!.id
    cancelRunningJobBlock(id)
    expect(listRunningJobsBlock().some(j => j.id === id)).toBe(true)
    a.dispose()
    expect(listRunningJobsBlock().some(j => j.id === id)).toBe(false)
  })

  it('cancel-all hits every in-flight job', () => {
    const a = job('a'); const b = job('b')
    expect(cancelAllRunningJobsBlock()).toBe(2)
    expect(a.cancel).toHaveBeenCalled()
    expect(b.cancel).toHaveBeenCalled()
    a.dispose(); b.dispose()
  })

  it('cancelling an unknown id is a no-op, not a throw', () => {
    expect(cancelRunningJobBlock(999_999)).toBe(false)
  })
})
