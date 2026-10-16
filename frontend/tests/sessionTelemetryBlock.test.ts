import { describe, expect, it } from 'vitest'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { selectRecentVaultSessionsBlock } from '@/services/lego_blocks/integrations/sessionTelemetryBlock'

const ROOT = '/vault'
const NOW = Date.parse('2026-10-15T12:00:00Z')

function session(path: string, startedIso: string, endedIso: string, touched: string[]): ParsedSession {
  return { path, startedIso, endedIso, topic: path, source: 'claude', touchedPaths: touched } as unknown as ParsedSession
}

describe('selectRecentVaultSessionsBlock', () => {
  it('keeps every concurrent session, most recently active first', () => {
    const recent = selectRecentVaultSessionsBlock([
      session('native/a', '2026-10-15T10:00:00Z', '2026-10-15T11:00:00Z', ['/vault/a.md']),
      session('native/b', '2026-10-15T10:30:00Z', '2026-10-15T11:50:00Z', ['/vault/b.md']),
    ], ROOT, NOW)
    expect(recent.map(s => s.sessionKey)).toEqual(['native/b', 'native/a'])
  })

  it('regroups idle-gap windows and drops stale or out-of-vault sessions', () => {
    const recent = selectRecentVaultSessionsBlock([
      session('native/a', '2026-10-15T09:00:00Z', '2026-10-15T09:30:00Z', ['/vault/x/one.md']),
      session('native/a#w1', '2026-10-15T11:00:00Z', '2026-10-15T11:30:00Z', ['/vault/two.md']),
      session('native/old', '2026-10-14T08:00:00Z', '2026-10-14T09:00:00Z', ['/vault/old.md']),
      session('native/out', '2026-10-15T11:00:00Z', '2026-10-15T11:10:00Z', ['/elsewhere/c.md']),
    ], ROOT, NOW)
    expect(recent).toHaveLength(1)
    expect(recent[0].relPaths.sort()).toEqual(['two.md', 'x/one.md'])
    expect(recent[0].startedMs).toBe(Date.parse('2026-10-15T09:00:00Z'))
  })
})
