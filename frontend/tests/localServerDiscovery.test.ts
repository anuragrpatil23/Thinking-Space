import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverLocalServersBlock } from '@/services/lego_blocks/units/intelligence/localServerDiscoveryBlock'

// Discovery replaces having to know and type a base URL. It probes a fixed
// list of loopback ports, so the contract worth pinning is: only 127.0.0.1 is
// ever contacted, a dead port is a normal empty result rather than a throw,
// and a server answering with no models doesn't get offered as a choice.

const realFetch = globalThis.fetch

function mockServers(byPort: Record<number, unknown>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const port = Number(/:(\d+)\//.exec(url)?.[1])
    const body = byPort[port]
    if (body === undefined) throw new Error('ECONNREFUSED')
    return { ok: true, json: async () => body } as Response
  }) as typeof fetch
}

describe('discoverLocalServersBlock', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { globalThis.fetch = realFetch })

  it('returns nothing when no port answers', async () => {
    mockServers({})
    await expect(discoverLocalServersBlock()).resolves.toEqual([])
  })

  it('finds a server and labels it with the runtime that owns the port', async () => {
    mockServers({ 1234: { data: [{ id: 'some-local-model' }] } })
    const found = await discoverLocalServersBlock()
    expect(found).toHaveLength(1)
    expect(found[0].baseUrl).toBe('http://127.0.0.1:1234/v1')
    expect(found[0].runtime).toBe('LM Studio')
    expect(found[0].models).toEqual(['some-local-model'])
  })

  it('finds several servers at once', async () => {
    mockServers({
      1234: { data: [{ id: 'a' }] },
      11434: { data: [{ id: 'b' }] },
    })
    const found = await discoverLocalServersBlock()
    expect(found.map(s => s.baseUrl).sort()).toEqual([
      'http://127.0.0.1:11434/v1',
      'http://127.0.0.1:1234/v1',
    ])
  })

  it('skips a server that reports no models', async () => {
    mockServers({ 1234: { data: [] } })
    await expect(discoverLocalServersBlock()).resolves.toEqual([])
  })

  it('tolerates malformed entries in the model list', async () => {
    mockServers({ 1234: { data: [{ id: 42 }, { id: 'real-model' }, {}] } })
    const found = await discoverLocalServersBlock()
    expect(found[0].models).toEqual(['real-model'])
  })

  it('only ever contacts loopback', async () => {
    mockServers({ 1234: { data: [{ id: 'a' }] } })
    await discoverLocalServersBlock()
    for (const call of (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/models$/)
    }
  })
})
