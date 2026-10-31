import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A big job's prompt read freezes every job decoding beside it, so the queue
// keeps big and small jobs from overlapping where it hurts — without letting a
// trickle of small jobs starve a big one.

type QueueModule = typeof import('@/services/lego_blocks/integrations/intelligence/jobQueueBlock')
let q: QueueModule

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  q = await import('@/services/lego_blocks/integrations/intelligence/jobQueueBlock')
})
afterEach(() => vi.useRealTimers())

function controlled() {
  const started: string[] = []
  const releases = new Map<string, () => void>()
  const job = (key: string, promptTokens: number, opts: { priority?: 'interactive'; dateIso?: string } = {}) =>
    q.enqueueIntelligenceJobBlock(
      key,
      () => new Promise<string>(res => { started.push(key); releases.set(key, () => res(key)) }),
      { taskId: key, providerId: 'openai-compat', promptTokens, ...opts },
    )
  const finish = async (key: string) => {
    releases.get(key)!()
    await vi.advanceTimersByTimeAsync(0)
  }
  return { started, job, finish }
}

const BIG = 20_000 // ~67s prefill window at 300 tok/s, +2s margin
const SMALL = 500

describe('big and small job pairing', () => {
  it('does not start a small job while a big one is still reading its prompt', async () => {
    const { started, job } = controlled()
    job('digest', BIG, { dateIso: '2026-10-30' })
    job('label', SMALL)
    expect(started).toEqual(['digest'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(started).toEqual(['digest'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started).toEqual(['digest', 'label'])
  })

  it('holds a big job until the small one beside it finishes, and keeps the slot for it', async () => {
    const { started, job, finish } = controlled()
    job('label-1', SMALL, { dateIso: '2026-10-31' })
    job('digest', BIG, { dateIso: '2026-10-30' })
    job('label-2', SMALL)
    // label-1 runs; digest is next in line but must not start beside it, and
    // label-2 must not take the free slot ahead of it.
    expect(started).toEqual(['label-1'])
    await finish('label-1')
    expect(started).toEqual(['label-1', 'digest'])
  })

  it('lets two big jobs run together', () => {
    const { started, job } = controlled()
    job('digest-a', BIG, { dateIso: '2026-10-30' })
    job('digest-b', BIG, { dateIso: '2026-10-29' })
    expect(started).toEqual(['digest-a', 'digest-b'])
  })

  it('lets interactive work through regardless', () => {
    const { started, job } = controlled()
    job('digest', BIG, { dateIso: '2026-10-30' })
    job('settings-test', SMALL, { priority: 'interactive' })
    expect(started).toEqual(['digest', 'settings-test'])
  })

  it('runs up to four small jobs together', () => {
    const { started, job } = controlled()
    for (const k of ['a', 'b', 'c', 'd', 'e']) job(k, SMALL)
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops back to two once a big job is involved', async () => {
    const { started, job, finish } = controlled()
    job('digest-a', BIG, { dateIso: '2026-10-30' })
    job('digest-b', BIG, { dateIso: '2026-10-29' })
    job('digest-c', BIG, { dateIso: '2026-10-28' })
    expect(started).toEqual(['digest-a', 'digest-b'])
    await finish('digest-a')
    expect(started).toEqual(['digest-a', 'digest-b', 'digest-c'])
  })

  it('waits for all small neighbours before starting a big job', async () => {
    const { started, job, finish } = controlled()
    for (const k of ['a', 'b', 'c']) job(k, SMALL, { dateIso: '2026-10-31' })
    job('digest', BIG, { dateIso: '2026-10-30' })
    expect(started).toEqual(['a', 'b', 'c'])
    await finish('a')
    await finish('b')
    expect(started).toEqual(['a', 'b', 'c'])
    await finish('c')
    expect(started).toEqual(['a', 'b', 'c', 'digest'])
  })
})
