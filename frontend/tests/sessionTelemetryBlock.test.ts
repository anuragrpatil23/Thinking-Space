import { describe, expect, it } from 'vitest'
import {
  selectLatestVaultSessionBlock,
  SESSION_TELEMETRY_MAX_AGE_MS,
} from '../src/services/lego_blocks/integrations/sessionTelemetryBlock'
import type { ParsedSession } from '../src/services/lego_blocks/units/aiActivityParserBlock'

const VAULT = '/Users/me/vault'
const NOW = Date.parse('2026-07-17T12:00:00Z')

function session(overrides: Partial<ParsedSession> & { path: string }): ParsedSession {
  return {
    source: 'claude',
    startedIso: '2026-07-17T10:00:00Z',
    endedIso: '2026-07-17T10:30:00Z',
    project: 'vault',
    userMsgCount: 3,
    topic: 'a topic',
    hadClear: false,
    mtime: 0,
    ...overrides,
  } as ParsedSession
}

describe('selectLatestVaultSessionBlock', () => {
  it('picks the most recently ended vault-touching session and maps paths vault-relative', () => {
    const result = selectLatestVaultSessionBlock(
      [
        session({
          path: 'native/claude/old.jsonl',
          startedIso: '2026-07-17T08:00:00Z',
          endedIso: '2026-07-17T08:30:00Z',
          touchedPaths: [`${VAULT}/notes/old.md`],
        }),
        session({
          path: 'native/claude/new.jsonl',
          touchedPaths: [`${VAULT}/notes/a.md`, `${VAULT}/deep/nested/b.md`],
        }),
      ],
      VAULT,
      NOW,
    )
    expect(result?.sessionKey).toBe('native/claude/new.jsonl')
    expect(result?.relPaths.sort()).toEqual(['deep/nested/b.md', 'notes/a.md'])
  })

  it('ignores sessions without provenance and edits outside the vault', () => {
    const result = selectLatestVaultSessionBlock(
      [
        // Chat session — no provenance at all: never produces dots.
        session({ path: 'ai-raw/chatgpt/x.md', touchedPaths: undefined }),
        // Code-repo session — provenance, but nothing inside the vault.
        session({ path: 'native/claude/repo.jsonl', touchedPaths: ['/Users/me/code/app.ts'] }),
      ],
      VAULT,
      NOW,
    )
    expect(result).toBeNull()
  })

  it('regroups a transcript split into idle-gap windows and unions their edits', () => {
    const result = selectLatestVaultSessionBlock(
      [
        session({
          path: 'native/claude/s.jsonl',
          startedIso: '2026-07-17T09:00:00Z',
          endedIso: '2026-07-17T09:20:00Z',
          topic: 'first window topic',
          touchedPaths: [`${VAULT}/a.md`],
        }),
        session({
          path: 'native/claude/s.jsonl#w1',
          startedIso: '2026-07-17T11:00:00Z',
          endedIso: '2026-07-17T11:20:00Z',
          topic: 'second window topic',
          touchedPaths: [`${VAULT}/b.md`, `${VAULT}/a.md`],
        }),
      ],
      VAULT,
      NOW,
    )
    expect(result?.sessionKey).toBe('native/claude/s.jsonl')
    expect(result?.relPaths.sort()).toEqual(['a.md', 'b.md'])
    expect(result?.topic).toBe('first window topic')
    expect(result?.startedMs).toBe(Date.parse('2026-07-17T09:00:00Z'))
    expect(result?.endedMs).toBe(Date.parse('2026-07-17T11:20:00Z'))
  })

  it('ages sessions out — telemetry is live, not an inbox', () => {
    const endedMs = NOW - SESSION_TELEMETRY_MAX_AGE_MS - 60_000
    const result = selectLatestVaultSessionBlock(
      [
        session({
          path: 'native/claude/stale.jsonl',
          startedIso: new Date(endedMs - 600_000).toISOString(),
          endedIso: new Date(endedMs).toISOString(),
          touchedPaths: [`${VAULT}/a.md`],
        }),
      ],
      VAULT,
      NOW,
    )
    expect(result).toBeNull()
  })
})
