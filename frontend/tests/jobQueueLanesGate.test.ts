import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueueModule = typeof import('@/services/lego_blocks/integrations/intelligence/jobQueueBlock')
let q: QueueModule

// Fresh module per test: the queue is module-level state.
beforeEach(async () => {
  vi.resetModules()
  q = await import('@/services/lego_blocks/integrations/intelligence/jobQueueBlock')
})

function hold() {
  let release!: () => void
  const opened = new Promise<void>(res => { release = res })
  return { opened, release }
}

describe('intelligence queue lanes', () => {
  it('runs interactive work before any background work, whatever the dates', async () => {
    const h = hold()
    const job = (key: string, opts: { dateIso?: string; priority?: 'interactive' | 'background' } = {}) =>
      q.enqueueIntelligenceJobBlock(key, async () => { await h.opened; return key }, { taskId: key, ...opts })
    job('a'); job('b'); job('c'); job('d')
    job('digest-today', { dateIso: '2026-10-30' })
    job('settings-test', { priority: 'interactive' })
    expect(q.listQueuedIntelligenceJobsBlock().map(j => j.key)).toEqual(['settings-test', 'digest-today'])
    h.release()
  })

  it('promotes a waiting job when it is asked for again as interactive', async () => {
    const h = hold()
    const job = (key: string, priority?: 'interactive') =>
      q.enqueueIntelligenceJobBlock(key, async () => { await h.opened; return key }, { taskId: key, dateIso: key === 'old' ? '2026-01-01' : '2026-10-30', priority })
    job('a'); job('b'); job('c'); job('d'); job('new'); job('old')
    job('old', 'interactive')
    expect(q.listQueuedIntelligenceJobsBlock().map(j => j.key)).toEqual(['old', 'new'])
    h.release()
  })
})

describe('intelligence queue dispatch gate', () => {
  it('holds jobs for a closed provider, runs others, and resumes on pump', async () => {
    let open = false
    q.setIntelligenceDispatchGateBlock(p => p !== 'openai-compat' || open)
    const started: string[] = []
    const job = (key: string, providerId: string) =>
      q.enqueueIntelligenceJobBlock(key, async () => { started.push(key); return key }, { taskId: key, providerId })
    const local = job('local', 'openai-compat')
    const cloud = job('cloud', 'anthropic')
    await cloud
    expect(started).toEqual(['cloud'])
    expect(q.hasIntelligenceWorkForProviderBlock('openai-compat')).toBe(true)
    open = true
    q.pumpIntelligenceQueueBlock()
    await local
    await new Promise(res => setTimeout(res, 0))
    expect(started).toEqual(['cloud', 'local'])
    expect(q.hasIntelligenceWorkForProviderBlock('openai-compat')).toBe(false)
  })
})
