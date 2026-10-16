import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

// Claude Code writes its own session title into the transcript as untimestamped
// `{"type":"ai-title"}` records. It is a better label than the first prompt
// ("Starting local Qwen" vs "hey can you please start local qwen new one").

const HOUR = 3_600_000
const T0 = Date.parse('2026-10-16T09:00:00.000Z')

function ev(offsetMs: number, uuid: string, content: string) {
  return JSON.stringify({
    type: 'user',
    uuid,
    sessionId: 'sess-1',
    cwd: '/Users/me/code/F9',
    timestamp: new Date(T0 + offsetMs).toISOString(),
    message: { content },
  })
}

const title = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: 'sess-1' })

function parse(lines: string[], source: 'claude' | 'codex' = 'claude') {
  return parseNativeAiSession({ source, relPath: 'sess-1.jsonl', mtime: 0, text: lines.join('\n') })
}

describe('ai-title', () => {
  it('becomes the topic, ahead of the first prompt', () => {
    const [s] = parse([ev(0, 'a', 'hey can you please start local qwen new one'), title('Starting local Qwen')])
    expect(s.topic).toBe('Starting local Qwen')
    expect(s.aiTitle).toBe('Starting local Qwen')
  })

  it('last record wins (a /rename lands as a later ai-title)', () => {
    const [s] = parse([title('Add arrow keys'), ev(0, 'a', 'some long enough prompt text here'), title('rss-read-state')])
    expect(s.topic).toBe('rss-read-state')
  })

  it('labels every window of the file', () => {
    const sessions = parse([title('One title'), ev(0, 'a', 'first prompt body text'), ev(3 * HOUR, 'b', 'later prompt body text')])
    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.topic)).toEqual(['One title', 'One title'])
  })

  it('is written as null when absent, so the cache can tell old rows from untitled ones', () => {
    const [s] = parse([ev(0, 'a', 'hey there, a prompt with no title record')])
    expect(s.aiTitle).toBeNull()
    expect(s.topic).toBe('hey there, a prompt with no title record')
  })
})
