import { describe, expect, it } from 'vitest'
import {
  parseTranscriptEventsBlock,
  splitUserTextBlock,
} from '@/services/lego_blocks/units/parseTranscriptEventsBlock'

/**
 * The chain drawer reads structured items, not a markdown blob. The blob is
 * what rendered a pasted letter as 40 heading-sized paragraphs, showed
 * `<system-reminder>` as if the user typed it, and dropped every tool call —
 * so which files a session changed was the one thing the drawer could not say.
 */

const CWD = '/repo'
const at = (s: number) => new Date(Date.UTC(2026, 9, 15, 14, 0, s)).toISOString()

const user = (s: number, content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', timestamp: at(s), cwd: CWD, message: { role: 'user', content }, ...extra })
const assistant = (s: number, content: unknown[]) =>
  JSON.stringify({ type: 'assistant', timestamp: at(s), cwd: CWD, message: { role: 'assistant', content } })
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })
const result = (s: number, id: string, content: string, rich?: unknown, isError = false) =>
  user(s, [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }], rich ? { toolUseResult: rich } : {})

describe('user text', () => {
  it('turns pastes into numbered chips and keeps the words around them', () => {
    const segs = splitUserTextBlock(
      'please read this\n<pasted_content id="47ae">line one\nline two</pasted_content id="47ae">\nthanks',
    )
    expect(segs).toEqual([
      { kind: 'text', text: 'please read this' },
      { kind: 'paste', paste: { n: 1, body: 'line one\nline two', lines: 2 } },
      { kind: 'text', text: 'thanks' },
    ])
  })

  it('strips harness wrappers the user never typed', () => {
    const segs = splitUserTextBlock('<system-reminder>\nrules\n</system-reminder>\nfix the bug')
    expect(segs).toEqual([{ kind: 'text', text: 'fix the bug' }])
  })

  it('drops a turn that was nothing but harness noise', () => {
    const { items } = parseTranscriptEventsBlock(
      user(0, '<task-notification><task-id>x</task-id></task-notification>'),
      null,
    )
    expect(items).toEqual([])
  })
})

describe('tool calls', () => {
  const jsonl = [
    user(0, 'make the view nicer'),
    assistant(1, [
      { type: 'text', text: 'Looking.' },
      toolUse('r1', 'Read', { file_path: '/repo/a.ts' }),
      toolUse('w1', 'Write', { file_path: '/repo/new.ts', content: 'x\ny\nz' }),
      toolUse('e1', 'Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }),
      toolUse('b1', 'Bash', { command: 'npm test' }),
    ]),
    result(2, 'r1', 'one\ntwo\nthree'),
    result(2, 'w1', 'ok', { type: 'create', filePath: '/repo/new.ts', content: 'x\ny\nz', structuredPatch: [] }),
    result(2, 'e1', 'ok', { filePath: '/repo/a.ts', structuredPatch: [{ lines: [' k', '-a', '+b', '+c'] }] }),
    result(2, 'b1', 'FAIL 2 tests', undefined, true),
  ].join('\n')

  it('keeps each call as a row with a relative target and a one-line result', () => {
    const { items } = parseTranscriptEventsBlock(jsonl, null)
    const tools = items.flatMap(i => (i.kind === 'tool' ? [i.tool] : []))
    expect(tools.map(t => `${t.name}(${t.target})`)).toEqual([
      'Read(a.ts)', 'Write(new.ts)', 'Edit(a.ts)', 'Bash(npm test)',
    ])
    expect(tools[0].result).toBe('Read 3 lines')
    expect(tools[1].verb).toBe('create')
    expect(tools[2]).toMatchObject({ added: 2, removed: 1 })
    expect(tools[3]).toMatchObject({ isError: true, result: 'FAIL 2 tests' })
  })

  it('summarises files: created over edited over read, with line counts', () => {
    const { summary } = parseTranscriptEventsBlock(jsonl, null)
    expect(summary.files.map(f => [f.path, f.change, f.added, f.removed])).toEqual([
      ['new.ts', 'created', 3, 0],
      ['a.ts', 'edited', 2, 1],
    ])
    // The jump target for a read-then-edited file is the edit, not the read.
    const a = summary.files.find(f => f.path === 'a.ts')!
    expect(a.firstItem).toBe(4)
    expect(summary).toMatchObject({ prompts: 1, toolCalls: 4, commands: 1, errors: 1 })
  })

  it('never keeps a tool payload — only the target', () => {
    const { items } = parseTranscriptEventsBlock(jsonl, null)
    expect(JSON.stringify(items)).not.toContain('old_string')
  })
})

describe('codex', () => {
  it('reads apply_patch as per-file creates and edits', () => {
    const patch = '*** Begin Patch\n*** Add File: /repo/n.py\n+a\n+b\n*** Update File: /repo/o.py\n-x\n+y\n*** End Patch'
    const jsonl = [
      JSON.stringify({ type: 'turn_context', payload: { cwd: CWD } }),
      JSON.stringify({ type: 'response_item', timestamp: at(0), payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: patch } }),
    ].join('\n')
    const { summary } = parseTranscriptEventsBlock(jsonl, null)
    expect(summary.files.map(f => [f.path, f.change])).toEqual([['n.py', 'created'], ['o.py', 'edited']])
  })
})

describe('window', () => {
  it('drops events outside the sitting', () => {
    const { items } = parseTranscriptEventsBlock(
      [user(0, 'EARLY'), user(100, 'LATE')].join('\n'),
      { startMs: Date.parse(at(50)), endMs: Date.parse(at(200)) },
    )
    expect(items).toHaveLength(1)
    expect(JSON.stringify(items)).toContain('LATE')
  })
})
