import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

/**
 * A Codex transcript is readable, and a sitting renders only its own window.
 *
 * The reader spoke one dialect. Claude writes
 * `{type: 'user'|'assistant', message: {content}}`; Codex writes
 * `{type: 'response_item', payload: {role, content}}` with its text blocks
 * named `input_text`/`output_text`. Every Codex line therefore matched nothing
 * and the drawer said "the source file was read but contained no renderable
 * turns" — which reads as data loss when the file is intact and the reader
 * simply doesn't speak its dialect.
 *
 * The same file also rendered the WHOLE transcript for every `#wN` sitting,
 * the bug already fixed once in the digest extractor and still live here.
 */

const readNativeAiSession = vi.fn()
vi.mock('@/services/lego_blocks/integrations/nativeAiSessionsBlock', () => ({
  readNativeAiSession: (...a: unknown[]) => readNativeAiSession(...(a as [])),
}))
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({ read: async () => '' }),
}))

const { getChainSessionTranscriptsBlock } = await import(
  '@/services/lego_blocks/units/getChainTranscriptBlock'
)

const T0 = Date.parse('2026-08-03T15:18:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()

function codexTurn(offset: number, role: 'user' | 'assistant', text: string) {
  return JSON.stringify({
    type: 'response_item',
    timestamp: at(offset),
    payload: {
      type: 'message',
      role,
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    },
  })
}

function session(over: Partial<ParsedSession> & { path: string }): ParsedSession {
  return {
    source: 'codex',
    startedIso: at(0),
    endedIso: at(60 * 60_000),
    project: 'MountSinaiGit',
    userMsgCount: 3,
    topic: 'how is it going',
    hadClear: false,
    mtime: 0,
    ...over,
  }
}

function chain(sessions: ParsedSession[]): ActivityChain {
  return {
    key: 'MountSinaiGit::x',
    project: 'MountSinaiGit',
    sessions,
    startedIso: sessions[0].startedIso,
    endedIso: sessions[sessions.length - 1].endedIso ?? sessions[0].startedIso,
    msgCount: 3,
    topic: sessions[0].topic,
  } as ActivityChain
}

beforeEach(() => {
  readNativeAiSession.mockReset()
})

describe('a codex transcript renders', () => {
  it('reads response_item turns instead of reporting the file as empty', async () => {
    readNativeAiSession.mockResolvedValue(
      [
        codexTurn(0, 'user', 'how is it going'),
        codexTurn(60_000, 'assistant', 'Going well — here is the plan.'),
      ].join('\n'),
    )

    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'native/codex/2026/08/03/rollout-abc.jsonl' })]),
    )

    // The regression: this was 'empty', with "contained no renderable turns".
    expect(part.status).toBe('ok')
    expect(part.markdown).toContain('how is it going')
    expect(part.markdown).toContain('Going well')
    expect(part.markdown).toContain('### User')
    expect(part.markdown).toContain('### Assistant')
  })

  it('still reports a genuinely empty file as empty', async () => {
    // The message was wrong for Codex, not wrong in general — a file with no
    // turns must still say so rather than render a blank pane.
    readNativeAiSession.mockResolvedValue(
      JSON.stringify({ type: 'event_msg', timestamp: at(0), payload: { type: 'token_count' } }),
    )

    const [part] = await getChainSessionTranscriptsBlock(
      chain([session({ path: 'native/codex/2026/08/03/rollout-abc.jsonl' })]),
    )
    expect(part.status).toBe('empty')
  })
})

describe('a sitting renders only its own window', () => {
  const TRANSCRIPT = [
    codexTurn(0, 'user', 'MORNING_TURN about the first thing'),
    codexTurn(60_000, 'assistant', 'MORNING_REPLY'),
    codexTurn(5 * 60 * 60_000, 'user', 'EVENING_TURN about something else'),
    codexTurn(5 * 60 * 60_000 + 60_000, 'assistant', 'EVENING_REPLY'),
  ].join('\n')

  it('excludes turns outside the window, so `#wN` slices differ', async () => {
    readNativeAiSession.mockResolvedValue(TRANSCRIPT)
    const [morning] = await getChainSessionTranscriptsBlock(
      chain([
        session({
          path: 'native/codex/2026/08/03/rollout-abc.jsonl',
          startedIso: at(0),
          endedIso: at(60_000),
        }),
      ]),
    )

    expect(morning.markdown).toContain('MORNING_TURN')
    // Without the clip the `#wN` suffix is stripped, the whole file is read,
    // and every sitting of a long session renders identically.
    expect(morning.markdown).not.toContain('EVENING_TURN')
  })

  it('renders the later window from the same file', async () => {
    readNativeAiSession.mockResolvedValue(TRANSCRIPT)
    const [evening] = await getChainSessionTranscriptsBlock(
      chain([
        session({
          path: 'native/codex/2026/08/03/rollout-abc.jsonl#w6',
          startedIso: at(5 * 60 * 60_000),
          endedIso: at(5 * 60 * 60_000 + 60_000),
        }),
      ]),
    )

    expect(evening.markdown).toContain('EVENING_TURN')
    expect(evening.markdown).not.toContain('MORNING_TURN')
  })
})
