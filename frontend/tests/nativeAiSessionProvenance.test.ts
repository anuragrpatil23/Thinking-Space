import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

const CWD = '/Users/x/Vault'

function claudeLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

function userEvent(ts: string, text: string) {
  return claudeLine({
    type: 'user',
    timestamp: ts,
    cwd: CWD,
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    message: { content: text },
  })
}

function assistantEvent(ts: string, content: unknown[]) {
  return claudeLine({
    type: 'assistant',
    timestamp: ts,
    cwd: CWD,
    message: { model: 'claude-opus-4-8', content, usage: { input_tokens: 5, output_tokens: 5 } },
  })
}

function parse(text: string) {
  return parseNativeAiSession({ source: 'claude', relPath: 'proj/sess.jsonl', mtime: 0, text })
}

describe('parseNativeAiSession file-edit provenance', () => {
  it('extracts absolute paths from Edit/Write/MultiEdit/NotebookEdit tool calls', () => {
    const text = [
      userEvent('2026-07-01T10:00:00Z', 'do the thing'),
      assistantEvent('2026-07-01T10:01:00Z', [
        { type: 'text', text: 'working' },
        { type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}/a.md` } },
        { type: 'tool_use', name: 'Write', input: { file_path: `${CWD}/dir/b.md` } },
        { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: `${CWD}/c.ipynb` } },
      ]),
    ].join('\n')
    const sessions = parse(text)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].touchedPaths?.sort()).toEqual(
      [`${CWD}/a.md`, `${CWD}/c.ipynb`, `${CWD}/dir/b.md`].sort(),
    )
  })

  it('ignores non-mutating tools and dedupes repeated edits', () => {
    const text = [
      userEvent('2026-07-01T10:00:00Z', 'go'),
      assistantEvent('2026-07-01T10:01:00Z', [
        { type: 'tool_use', name: 'Read', input: { file_path: `${CWD}/read-only.md` } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}/a.md` } },
        { type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}/a.md` } },
      ]),
    ].join('\n')
    const sessions = parse(text)
    expect(sessions[0].touchedPaths).toEqual([`${CWD}/a.md`])
  })

  it('leaves touchedPaths undefined when the session edited nothing', () => {
    const text = [
      userEvent('2026-07-01T10:00:00Z', 'just chatting'),
      assistantEvent('2026-07-01T10:01:00Z', [{ type: 'text', text: 'sure' }]),
    ].join('\n')
    const sessions = parse(text)
    expect(sessions[0].touchedPaths).toBeUndefined()
  })

  it('resolves a relative tool path against the session cwd', () => {
    const text = [
      userEvent('2026-07-01T10:00:00Z', 'go'),
      assistantEvent('2026-07-01T10:01:00Z', [
        { type: 'tool_use', name: 'Edit', input: { file_path: 'notes/rel.md' } },
      ]),
    ].join('\n')
    const sessions = parse(text)
    expect(sessions[0].touchedPaths).toEqual([`${CWD}/notes/rel.md`])
  })
})

describe('parseNativeAiSession active duration', () => {
  it('sums inter-message gaps, clamping each to 5 minutes', () => {
    // Gaps: 2m (kept), 40m (clamped to 5m), 1m (kept). Active = 8m.
    // Wall-clock start→end is 43m — the inflation the sparkline must not show.
    const text = [
      userEvent('2026-07-01T10:00:00Z', 'a'),
      assistantEvent('2026-07-01T10:02:00Z', [{ type: 'text', text: 'b' }]),
      userEvent('2026-07-01T10:42:00Z', 'c'),
      assistantEvent('2026-07-01T10:43:00Z', [{ type: 'text', text: 'd' }]),
    ].join('\n')
    const sessions = parse(text)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activeDurationMs).toBe(8 * 60_000)
    // Wall-clock span is still the full 43 minutes.
    const span = Date.parse(sessions[0].endedIso!) - Date.parse(sessions[0].startedIso)
    expect(span).toBe(43 * 60_000)
  })

  it('is zero for a single-event window (no gaps to sum)', () => {
    const sessions = parse(userEvent('2026-07-01T10:00:00Z', 'only one'))
    expect(sessions[0].activeDurationMs).toBe(0)
  })
})
