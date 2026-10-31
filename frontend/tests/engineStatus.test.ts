import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeEngineSpeedBlock,
  describeEngineStateBlock,
  formatSecondsBlock,
  parseSupervisorStatusBlock,
  probeEngineStateBlock,
} from '@/services/lego_blocks/units/intelligence/engineStatusBlock'

const ENGINE = new URL('http://127.0.0.1:1234/v1')

describe('supervisor status parsing', () => {
  it('maps states, model and the last failure record', () => {
    const s = parseSupervisorStatusBlock({
      state: 'restarting',
      reason: 'thread_exception',
      ready: false,
      retry_after_s: 5,
      engine: { url: 'http://127.0.0.1:1234', model: 'qwen' },
      failures_last_hour: 2,
      last_failure: { id: 'f-1', at: '2026-10-30T20:21:00Z', reason: 'thread_exception', in_flight: [{ request_id: 'r1', job: 'session-digest', age_s: 40 }] },
    }, ENGINE, 1000)
    expect(s?.kind).toBe('restarting')
    expect(s?.model).toBe('qwen')
    expect(s?.retryAfterS).toBe(5)
    expect(s?.lastFailure?.id).toBe('f-1')
    expect(s?.lastFailure?.inFlight).toEqual([{ requestId: 'r1', job: 'session-digest', ageS: 40 }])
  })

  it('treats both pause reasons as paused, with a readable reason', () => {
    expect(parseSupervisorStatusBlock({ state: 'paused_memory_pressure' }, ENGINE)?.kind).toBe('paused')
    expect(parseSupervisorStatusBlock({ state: 'paused_on_battery' }, ENGINE)?.reason).toBe('On battery')
  })

  it('does not trust ready without ready:true', () => {
    expect(parseSupervisorStatusBlock({ state: 'ready', ready: false }, ENGINE)?.kind).toBe('starting')
    expect(parseSupervisorStatusBlock({ state: 'ready' }, ENGINE)?.kind).toBe('starting')
  })

  it('holds maintenance and any state it does not recognise as not ready', () => {
    const maintenance = parseSupervisorStatusBlock({ state: 'paused_maintenance', ready: false }, ENGINE)
    expect(maintenance).toMatchObject({ kind: 'paused', reason: 'Maintenance' })
    const future = parseSupervisorStatusBlock({ state: 'paused_for_reindex', ready: true }, ENGINE)
    expect(future).toMatchObject({ kind: 'paused', reason: 'Paused for reindex' })
  })

  it('ignores a supervisor that is not managing this engine', () => {
    expect(parseSupervisorStatusBlock({ state: 'external', ready: true }, ENGINE)).toBeNull()
    expect(parseSupervisorStatusBlock({ state: 'ready', ready: true, engine: { url: 'http://127.0.0.1:8080' } }, ENGINE)).toBeNull()
  })
})

describe('engine probe fallback order', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(routes: Record<string, () => Response | Promise<never>>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      for (const [prefix, respond] of Object.entries(routes)) if (url.startsWith(prefix)) return respond()
      throw new TypeError('fetch failed')
    }))
  }

  it('uses /health when no supervisor answers', async () => {
    stubFetch({ 'http://127.0.0.1:1234/health': () => new Response('{}', { status: 200 }) })
    expect((await probeEngineStateBlock('http://127.0.0.1:1234/v1', false)).kind).toBe('ready')
  })

  it('reports a 503 health as unhealthy', async () => {
    stubFetch({ 'http://127.0.0.1:1234/health': () => new Response('{"stalled":true}', { status: 503 }) })
    const s = await probeEngineStateBlock('http://127.0.0.1:1234/v1', false)
    expect(s.kind).toBe('unhealthy')
    expect(s.reason).toBe('Engine stalled')
  })

  it('falls back to /v1/models for servers without /health', async () => {
    stubFetch({
      'http://127.0.0.1:1234/health': () => new Response('', { status: 404 }),
      'http://127.0.0.1:1234/v1/models': () => new Response('{"data":[]}', { status: 200 }),
    })
    expect((await probeEngineStateBlock('http://127.0.0.1:1234/v1', false)).kind).toBe('unmanaged')
  })

  it('reads a silent supervisor as down only once one has answered', async () => {
    stubFetch({ 'http://127.0.0.1:1234/health': () => new Response('{}', { status: 200 }) })
    expect((await probeEngineStateBlock('http://127.0.0.1:1234/v1', true)).kind).toBe('down')
  })

  it('never asks the loopback supervisor about a remote server', async () => {
    stubFetch({ 'https://example.com/health': () => new Response('{}', { status: 200 }) })
    await probeEngineStateBlock('https://example.com/v1', true)
    const urls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map(c => c[0])
    expect(urls.some(u => u.includes(':1233'))).toBe(false)
  })
})

describe('engine description', () => {
  it('counts down to the supervisor retry', () => {
    const view = describeEngineStateBlock(
      { kind: 'restarting', source: 'supervisor', reason: 'thread_exception', retryAfterS: 30, checkedAt: 0 },
      10_000,
    )
    expect(view).toEqual({ tone: 'waiting', label: 'Restarting', detail: 'thread_exception · retry in 20s' })
  })

  it('formats durations people read', () => {
    expect(formatSecondsBlock(45)).toBe('45s')
    expect(formatSecondsBlock(3124.9)).toBe('52m 5s')
    expect(formatSecondsBlock(4517)).toBe('1h 15m')
  })
})

describe('engine speed', () => {
  it('reads the speed block from the supervisor and from /health', async () => {
    const speed = { window_s: 60, decode_tok_s: 38.4, avg_batch: 2.1, decode_tok_s_per_request: 18.3, prefill_tok_s: 320 }
    const s = parseSupervisorStatusBlock({ state: 'ready', ready: true, engine: { health: { speed } } }, ENGINE)
    expect(s?.speed).toEqual({ windowS: 60, decodeTokS: 38.4, avgBatch: 2.1, decodeTokSPerRequest: 18.3, prefillTokS: 320 })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://127.0.0.1:1234/health') return new Response(JSON.stringify({ speed }), { status: 200 })
      throw new TypeError('fetch failed')
    }))
    expect((await probeEngineStateBlock('http://127.0.0.1:1234/v1', false)).speed?.decodeTokS).toBe(38.4)
    vi.unstubAllGlobals()
  })

  it('prefers the engine figure and labels the fallback as end-to-end', () => {
    expect(describeEngineSpeedBlock(
      { windowS: 60, decodeTokS: 38.4, avgBatch: 2.1, decodeTokSPerRequest: 18.3, prefillTokS: 320 }, 13,
    )).toBe('38 tok/s · 18 per job · prompt 320')
    expect(describeEngineSpeedBlock(null, 13)).toBe('≈13 tok/s end-to-end')
    expect(describeEngineSpeedBlock(null, null)).toBeNull()
  })
})
