import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import type { ProjectSessionDigest } from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'

// THE REPLACEMENT RULE: an automatic run may CREATE a session digest; it may
// never REPLACE one. Only an explicit refresh overwrites what is already there.
//
// This exists because the failure is silent and expensive. `promptVersion` and
// every other hash input are global levers over a ~4,800-record corpus, so a
// one-line bump used to mean "re-derive the archive" — a five-figure token bill
// arriving as a side effect of a correctness fix, with no prompt and no way to
// notice until it had happened. The rule decouples *identifying* a stale record
// from *paying* to rebuild it.

const stored = new Map<string, ProjectSessionDigest>()
const runContract = vi.fn()

vi.mock('@/services/lego_blocks/integrations/aiActivitySessionDigestStoreBlock', () => ({
  getProjectSessionDigestBlock: vi.fn(async (p: string, s: string) => stored.get(`${p}/${s}`) ?? null),
  putProjectSessionDigestBlock: vi.fn(async () => {}),
}))

vi.mock('@/services/orchestrators/intelligenceOrch', () => ({
  runContract,
  contractReasoningWillRunOrch: vi.fn(async () => false),
  availability: vi.fn(async () => ({ available: true })),
  currentGenerationSourceBlock: vi.fn(() => 'local'),
}))

function session(over: Partial<ParsedSession> = {}): ParsedSession {
  return {
    path: 'native/codex/a.jsonl',
    source: 'codex',
    startedIso: '2026-08-27T17:40:00.000Z',
    endedIso: '2026-08-27T17:52:00.000Z',
    project: 'MountSinaiGit',
    userMsgCount: 2,
    topic: 'lets work on the delta pull',
    hadClear: false,
    mtime: 1,
    sessionId: '01a0444b-ee70-7721-b36b-544aa431b636',
    ...over,
  } as ParsedSession
}

describe('session digest · replacement rule', () => {
  beforeEach(() => {
    stored.clear()
    runContract.mockReset()
  })

  it('does not call the model when a stored digest exists but its hash moved', async () => {
    const { ensureSessionDigestOrch, computeSessionInputHashBlock } = await import(
      '@/services/orchestrators/aiActivitySessionDigestOrch'
    )
    const s = session()
    // A digest whose hash belongs to the PRE-authorship shape: the sitting used
    // to have 30 user messages (28 of them heartbeats) and ran until 21:00.
    const oldShape = session({ userMsgCount: 30, endedIso: '2026-08-27T21:00:00.000Z' })
    stored.set(`MountSinaiGit/${s.sessionId}`, {
      sessionId: s.sessionId!,
      projectId: 'MountSinaiGit',
      title: 'CDMDEID delta update kickoff',
      summary: 'Kicked off the delta pull.',
      inputHash: computeSessionInputHashBlock(oldShape),
      generator: 'local',
      thinking: true,
    } as ProjectSessionDigest)

    const res = await ensureSessionDigestOrch(s)

    expect(runContract).not.toHaveBeenCalled()
    expect(res?.digest.title).toBe('CDMDEID delta update kickoff')
    // Served, and flagged — the user is told, and decides.
    expect(res?.stale).toBe(true)
  })

  it('reports a matching digest as not stale', async () => {
    const { ensureSessionDigestOrch, computeSessionInputHashBlock } = await import(
      '@/services/orchestrators/aiActivitySessionDigestOrch'
    )
    const s = session()
    stored.set(`MountSinaiGit/${s.sessionId}`, {
      sessionId: s.sessionId!,
      projectId: 'MountSinaiGit',
      title: 'CDMDEID delta update kickoff',
      summary: 'Kicked off the delta pull.',
      inputHash: computeSessionInputHashBlock(s),
      generator: 'local',
      thinking: true,
    } as ProjectSessionDigest)

    const res = await ensureSessionDigestOrch(s)

    expect(runContract).not.toHaveBeenCalled()
    expect(res?.stale).toBeFalsy()
  })
})
