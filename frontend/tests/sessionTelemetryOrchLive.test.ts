import { beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const nowSec = NOW / 1000

const state = vi.hoisted(() => ({
  snapshot: [] as unknown[],
  native: [] as { source: string; relPath: string; mtime: number; size: number }[],
  parsed: new Map<string, unknown[]>(),
  parseCalls: 0,
}))

vi.mock('@/services/lego_blocks/units/storageKeyBlock', () => ({ getStoredVaultRoot: () => '/vault' }))
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({ stat: async () => ({ isDirectory: false, ctime: nowSec - 30 }) }),
  isElectron: () => true,
}))
vi.mock('@/services/lego_blocks/integrations/aiActivityCacheBlock', () => ({
  loadAiActivity: async () => ({ sessions: state.snapshot }),
}))
vi.mock('@/services/lego_blocks/integrations/nativeAiSessionsBlock', () => ({
  nativeAiSourcesAvailable: () => true,
  listNativeAiSessions: async () => state.native,
  loadAndParseNativeAiSession: async (e: { relPath: string }) => {
    state.parseCalls++
    return state.parsed.get(e.relPath) ?? []
  },
}))
vi.mock('@/services/lego_blocks/integrations/vaultExternalChangeBlock', () => ({
  subscribeExternalVaultChangesBlock: () => () => undefined,
}))

import { loadSessionTelemetry } from '@/services/orchestrators/sessionTelemetryOrch'

const iso = (sec: number) => new Date(sec * 1000).toISOString()
const row = (relPath: string, mtime: number, touched: string[]) => ({
  path: `native/claude/${relPath}`, mtime, topic: relPath, source: 'claude',
  startedIso: iso(nowSec - 600), endedIso: iso(mtime), touchedPaths: touched,
})

describe('session telemetry live overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    state.parseCalls = 0
    state.parsed.clear()
  })

  it('re-parses only transcripts newer than the AI Activity snapshot', async () => {
    state.snapshot = [row('a.jsonl', nowSec - 300, ['/vault/a.md']), row('b.jsonl', nowSec - 200, ['/vault/b.md'])]
    state.native = [
      { source: 'claude', relPath: 'a.jsonl', mtime: nowSec - 300, size: 1 },
      { source: 'claude', relPath: 'b.jsonl', mtime: nowSec - 5, size: 1 },
    ]
    state.parsed.set('b.jsonl', [row('b.jsonl', nowSec - 5, ['/vault/b.md', '/vault/new.md'])])

    const t = await loadSessionTelemetry({ force: true })
    expect(state.parseCalls).toBe(1)
    expect(t?.sessions.map(s => s.sessionKey)).toEqual(['native/claude/b.jsonl', 'native/claude/a.jsonl'])
    expect([...t!.all.files.keys()].sort()).toEqual(['a.md', 'b.md', 'new.md'])

    // Unchanged transcript: no second parse.
    await loadSessionTelemetry({ force: true })
    expect(state.parseCalls).toBe(1)
  })
})
