import { describe, it, expect } from 'vitest'
import {
  enqueueIntelligenceJobBlock,
  listQueuedIntelligenceJobsBlock,
} from '@/services/lego_blocks/integrations/intelligence/jobQueueBlock'

// The queue runs two at a time, so with a gate held shut everything past the
// first two piles up in `pending` and the ordering is observable.
function gate() {
  let release!: () => void
  const opened = new Promise<void>(res => { release = res })
  return { opened, release }
}

describe('intelligence queue orders by subject date', () => {
  it('runs newest first regardless of arrival order, and undated jobs last', async () => {
    const g = gate()
    const started: string[] = []
    const job = (key: string, dateIso?: string) =>
      enqueueIntelligenceJobBlock(
        key,
        async () => { started.push(key); await g.opened; return key },
        { taskId: key, dateIso },
      )

    // Two blockers occupy both concurrency slots so nothing else can start.
    const blockers = [job('block-a', '2026-08-20'), job('block-b', '2026-08-20')]

    // Interleaved arrival, exactly as seven range-summary blocks would produce.
    const rest = [
      job('aug-10', '2026-08-10'),
      job('aug-12', '2026-08-12'),
      job('stitch'),
      job('aug-11', '2026-08-11'),
      job('aug-12-later', '2026-08-12'),
    ]

    const queued = listQueuedIntelligenceJobsBlock().map(j => j.key)
    expect(queued).toEqual(['aug-12', 'aug-12-later', 'aug-11', 'aug-10', 'stitch'])

    g.release()
    await Promise.all([...blockers, ...rest])

    // The two blockers went first (they were already running); everything after
    // them drained newest-date-first with the undated stitch last.
    expect(started.slice(2)).toEqual(['aug-12', 'aug-12-later', 'aug-11', 'aug-10', 'stitch'])
  })

  it('dedupes by key, so a repeated enqueue does not double-queue', async () => {
    const g = gate()
    const runs: string[] = []
    const job = (key: string) =>
      enqueueIntelligenceJobBlock(key, async () => { runs.push(key); await g.opened; return key })

    const a = job('same')
    const b = job('same')
    expect(a).toBe(b)
    g.release()
    await a
    expect(runs).toEqual(['same'])
  })
})
