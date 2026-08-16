import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

// A chain is routinely part-readable, and the old block folded every session
// into one markdown blob with failures rendered as an inline italic line. A
// chain missing two of three sessions was indistinguishable from a complete
// one — which is how a deleted session that wrote 220 assignment proposals went
// unnoticed for ten days. These tests pin the per-session statuses that make
// the gap countable.

const readNativeAiSession = vi.fn<(source: string, relPath: string) => Promise<string>>()
const read = vi.fn<(path: string) => Promise<string>>()

vi.mock('@/services/lego_blocks/integrations/nativeAiSessionsBlock', () => ({
  readNativeAiSession: (source: string, relPath: string) => readNativeAiSession(source, relPath),
}))
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({ read: (path: string) => read(path) }),
}))

const {
  getChainSessionTranscriptsBlock,
  countReadableSessionsBlock,
  getChainTranscriptBlock,
} = await import('@/services/lego_blocks/units/getChainTranscriptBlock')

function session(over: Partial<ParsedSession> & { path: string }): ParsedSession {
  return {
    source: 'claude-code',
    startedIso: '2026-08-02T18:35:00.000Z',
    // A real parse sets the window to its own first and last event, so a
    // fixture whose events fall outside its window cannot occur — and the
    // renderer now clips to the window (a `#wN` sitting must not render the
    // whole file). Span the day so a test can move `startedIso` without
    // accidentally excluding the transcript it is asserting on.
    endedIso: '2026-08-02T23:59:00.000Z',
    project: 'Thinking-Space',
    userMsgCount: 3,
    topic: 'a topic',
    hadClear: false,
    mtime: 0,
    ...over,
  }
}

function chain(sessions: ParsedSession[]): ActivityChain {
  return {
    key: 'Thinking-Space::x',
    project: 'Thinking-Space',
    sessions,
    startedIso: sessions[0].startedIso,
    endedIso: sessions[sessions.length - 1].endedIso ?? sessions[0].startedIso,
    msgCount: sessions.reduce((n, s) => n + s.userMsgCount, 0),
    topic: sessions[0].topic,
  } as ActivityChain
}

// Call counts are load-bearing here — "reconstructed never attempts a read" is
// only meaningful against a clean slate.
beforeEach(() => {
  vi.clearAllMocks()
})

const NATIVE_JSONL = JSON.stringify({
  type: 'user',
  timestamp: '2026-08-02T18:35:00.000Z',
  message: { content: [{ type: 'text', text: 'hello' }] },
})

describe('getChainSessionTranscriptsBlock', () => {
  it('reports a readable native session as ok', async () => {
    readNativeAiSession.mockResolvedValueOnce(NATIVE_JSONL)
    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'native/claude/enc/abc.jsonl' })]),
    )
    expect(part.status).toBe('ok')
    expect(part.markdown).toContain('hello')
  })

  it('reports a deleted transcript as unavailable, keeping the reason', async () => {
    readNativeAiSession.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'native/claude/enc/gone.jsonl#w3' })]),
    )
    expect(part.status).toBe('unavailable')
    expect(part.note).toContain('ENOENT')
  })

  // A prompt-log rebuild never had a transcript. Reading it would surface a
  // permanent property of the source as a file error, which reads as data loss.
  it('reports a prompt-log rebuild as reconstructed without attempting a read', async () => {
    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'history/claude/1e356017', reconstructed: true })]),
    )
    expect(part.status).toBe('reconstructed')
    expect(read).not.toHaveBeenCalled()
    expect(readNativeAiSession).not.toHaveBeenCalled()
  })

  it('treats a history path as reconstructed even without the flag', async () => {
    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'history/claude/abc#w2' })]),
    )
    expect(part.status).toBe('reconstructed')
  })

  it('distinguishes an empty file from an unreadable one', async () => {
    readNativeAiSession.mockResolvedValueOnce('')
    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'native/claude/enc/empty.jsonl' })]),
    )
    expect(part.status).toBe('empty')
  })

  // The failure that started this: one session readable, the rest not.
  it('keeps readable sessions when a sibling fails, and counts the gap', async () => {
    readNativeAiSession
      .mockResolvedValueOnce(NATIVE_JSONL)
      .mockRejectedValueOnce(new Error('gone'))
    const parts = await getChainSessionTranscriptsBlock(
      chain([
        session({ path: 'native/claude/enc/ok.jsonl', startedIso: '2026-08-02T18:00:00.000Z' }),
        session({ path: 'native/claude/enc/gone.jsonl', startedIso: '2026-08-02T19:00:00.000Z' }),
        session({ path: 'history/claude/rebuilt', startedIso: '2026-08-02T20:00:00.000Z' }),
      ]),
    )
    expect(parts.map(p => p.status)).toEqual(['ok', 'unavailable', 'reconstructed'])
    expect(countReadableSessionsBlock(parts)).toBe(1)
  })

  it('orders sessions chronologically and numbers them from 1', async () => {
    readNativeAiSession.mockResolvedValue(NATIVE_JSONL)
    const parts = await getChainSessionTranscriptsBlock(
      chain([
        session({ path: 'native/claude/enc/late.jsonl', startedIso: '2026-08-02T22:00:00.000Z' }),
        session({ path: 'native/claude/enc/early.jsonl', startedIso: '2026-08-02T18:00:00.000Z' }),
      ]),
    )
    expect(parts.map(p => p.index)).toEqual([1, 2])
    expect(parts[0].session.path).toContain('early')
  })
})

describe('getChainTranscriptBlock', () => {
  it('states the shortfall up front instead of burying it mid-scroll', async () => {
    readNativeAiSession
      .mockResolvedValueOnce(NATIVE_JSONL)
      .mockRejectedValueOnce(new Error('gone'))
    const md = await getChainTranscriptBlock(
      chain([
        session({ path: 'native/claude/enc/ok.jsonl', startedIso: '2026-08-02T18:00:00.000Z' }),
        session({ path: 'native/claude/enc/gone.jsonl', startedIso: '2026-08-02T19:00:00.000Z' }),
      ]),
    )
    const banner = md.indexOf('1 of 2 sessions could not be read')
    expect(banner).toBeGreaterThan(-1)
    expect(banner).toBeLessThan(md.indexOf('## Session 1'))
  })

  it('says nothing about gaps when every session read', async () => {
    readNativeAiSession.mockResolvedValue(NATIVE_JSONL)
    const md = await getChainTranscriptBlock(chain([session({ path: 'native/claude/enc/a.jsonl' })]))
    expect(md).not.toContain('could not be read')
  })
})
