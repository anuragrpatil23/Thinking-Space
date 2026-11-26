// The person vs the agents (2026-11-26). Sessions started by a coordinator
// session or a launcher script, and turns another session caused, are the
// agents' time — never the person's. Pinned here because every one of these
// transcripts looks like typing to the fields the parser used to trust.
import { describe, it, expect } from 'vitest'
import {
  classifyUserTurnBlock,
  isSpawnedKickoffBlock,
  resolveAuthorshipBlock,
} from '@/services/lego_blocks/units/sessionAuthorshipBlock'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import { buildChains, type ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

const SID = '056389a3-e8f9-4702-afe5-f2757bf57e90'
let n = 0
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function user(ts: string, text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'user', sessionId: SID, cwd: '/w/proj', timestamp: ts, uuid: uid(), message: { role: 'user', content: text }, ...extra })
}
function assistant(ts: string, content: unknown[] = [{ type: 'text', text: 'ok' }], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'assistant', sessionId: SID, cwd: '/w/proj', timestamp: ts, uuid: (extra.uuid as string) ?? uid(), message: { role: 'assistant', model: 'claude-x', content } })
}
const peer = (from: string, text: string) =>
  `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/x.sock" from-name="${from}">\n${text}\n</cross-session-message>`
const parse = (lines: string[], spawnKickoffPatterns: string[] = []) =>
  parseNativeAiSession({ source: 'claude', relPath: `p/${SID}.jsonl`, mtime: 1, text: lines.join('\n'), spawnKickoffPatterns })

describe('classifying who caused a turn', () => {
  it("reads another session's message as delegated even though the harness marks it isMeta", () => {
    expect(classifyUserTurnBlock(peer('kai', 'report'), { isMeta: true })).toBe('delegated')
    expect(classifyUserTurnBlock('[Cross-session idle notice] "w-1", which you asked…', { isMeta: true })).toBe('delegated')
  })

  it('reads a timer-fired prompt as automation', () => {
    expect(classifyUserTurnBlock('Daily hf-runs check …', { turnOrigin: 'scheduled' })).toBe('automation')
    expect(classifyUserTurnBlock('Daily hf-runs check …', { turnOrigin: 'human' })).toBe('human')
  })

  it('reads a compaction summary as a continuation, not as the person', () => {
    expect(classifyUserTurnBlock('This session is being continued from a previous conversation…', { isCompactSummary: true })).toBe('continuation')
  })

  it('recognises the spawned-by tag always, and the user patterns as prefixes', () => {
    expect(isSpawnedKickoffBlock('[spawned-by: kai via sessions.sh]\nRead the brief at /x')).toBe(true)
    expect(isSpawnedKickoffBlock('Read the brief at /x')).toBe(false)
    expect(isSpawnedKickoffBlock('read THE brief at /x', ['Read the brief at'])).toBe(true)
    expect(isSpawnedKickoffBlock('Please read the brief at /x', ['Read the brief at'])).toBe(false)
  })

  it("keeps an agent's own job landing as agent work, but not in a person's session", () => {
    const tn = '<task-notification>\n<tool-use-id>t1</tool-use-id>\n</task-notification>'
    const agentRun = resolveAuthorshipBlock([
      { isUser: true, body: peer('kai', 'go'), flags: { isMeta: true } },
      { isUser: true, body: tn },
      { isUser: false, body: '' },
    ])
    expect(agentRun.map(e => e.author)).toEqual(['delegated', 'delegated', 'delegated'])
    const personRun = resolveAuthorshipBlock([
      { isUser: true, body: 'build it' },
      { isUser: true, body: tn },
      { isUser: false, body: '' },
    ])
    expect(personRun.map(e => e.author)).toEqual(['human', 'automation', 'automation'])
  })
})

describe('parsing: windows never mix the person and the agents', () => {
  it('ends your sitting when a peer message arrives 45 minutes after you left', () => {
    const out = parse([
      user('2026-11-26T09:00:00.000Z', 'hey, look at this'),
      assistant('2026-11-26T09:10:00.000Z'),
      user('2026-11-26T09:55:00.000Z', peer('w-worker', 'done, results attached'), { isMeta: true }),
      assistant('2026-11-26T10:20:00.000Z'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].actor).toBeUndefined()
    expect(out[0].endedIso).toBe('2026-11-26T09:10:00.000Z')
    expect(out[1].actor).toBe('agent')
    expect(out[1].startedIso).toBe('2026-11-26T09:55:00.000Z')
    // A peer's wrapper never becomes the topic; its own first line does.
    expect(out[1].topic).toBe('done, results attached')
  })

  it("makes a launcher-spawned worker the agents' from its first turn, until the person types in it", () => {
    const out = parse(
      [
        user('2026-11-26T06:00:00.000Z', 'Read your brief at /b/w.md and follow it.'),
        assistant('2026-11-26T06:30:00.000Z'),
        user('2026-11-26T06:40:00.000Z', 'how are things going?'),
        assistant('2026-11-26T06:41:00.000Z'),
      ],
      ['Read your brief at'],
    )
    expect(out.map(s => s.actor ?? 'me')).toEqual(['agent', 'me'])
    expect(out.every(s => s.spawned)).toBe(true)
    expect(out[0].openingPrompt).toBe('Read your brief at /b/w.md and follow it.')
  })

  it('records an approved prompt as a touch at the time it was asked, adding no duration', () => {
    const asker = uid()
    const out = parse([
      user('2026-11-26T06:00:00.000Z', '[spawned-by: kai via spawn.sh]\nRead your brief at /b'),
      assistant('2026-11-26T06:05:00.000Z', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'hf download x' } }], { uuid: asker }),
      user('2026-11-26T07:00:00.000Z', '', {
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
        permissionDecision: { decision: 'accept', source: 'user_temporary', grantScope: 'once' },
        sourceToolAssistantUUID: asker,
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].actor).toBe('agent')
    expect(out[0].touchIsos).toEqual(['2026-11-26T06:05:00.000Z'])
  })

  it("labels an agent's wait on its own background job, and never counts it", () => {
    const out = parse([
      user('2026-11-26T06:00:00.000Z', '[spawned-by: kai via spawn.sh]\nRun the training job'),
      assistant('2026-11-26T06:05:00.000Z', [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: { command: 'sbatch train.sh', description: 'Submit training job on cluster', run_in_background: true } }]),
      user('2026-11-26T08:05:00.000Z', '<task-notification>\n<tool-use-id>tu9</tool-use-id>\n<summary>done</summary>\n</task-notification>'),
      assistant('2026-11-26T08:20:00.000Z'),
    ])
    // The job ran two hours: the windows on either side are separate, and the
    // wait between them is a drawn span, not part of either duration.
    expect(out.map(s => s.actor)).toEqual(['agent', 'agent'])
    expect(out[0].endedIso).toBe('2026-11-26T06:05:00.000Z')
    expect(out[0].waits).toEqual([
      { startIso: '2026-11-26T06:05:00.000Z', endIso: '2026-11-26T08:05:00.000Z', label: 'Submit training job on cluster' },
    ])
    expect(out[1].startedIso).toBe('2026-11-26T08:05:00.000Z')
  })

  it('leaves a session with no agent signals exactly as before', () => {
    const out = parse([
      user('2026-07-01T09:00:00.000Z', 'plain work'),
      assistant('2026-07-01T09:30:00.000Z'),
    ])
    expect(out).toHaveLength(1)
    const s = out[0] as ParsedSession & Record<string, unknown>
    expect(s.actor).toBeUndefined()
    expect(s.spawned).toBeUndefined()
    expect(s.touchIsos).toBeUndefined()
    expect(s.waits).toBeUndefined()
    expect(s.wakeIsos).toBeUndefined()
  })
})

describe('chains keep the actors apart', () => {
  const row = (path: string, s: string, e: string, actor?: 'agent'): ParsedSession => ({
    path, source: 'claude-code', startedIso: s, endedIso: e, project: 'p', userMsgCount: 1, topic: path, hadClear: false, mtime: 1,
    ...(actor ? { actor } : {}),
  })

  it("never merges the person's sitting with an agent's in the same project", () => {
    const chains = buildChains([
      row('me1', '2026-11-26T09:00:00.000Z', '2026-11-26T09:10:00.000Z'),
      row('ag1', '2026-11-26T09:12:00.000Z', '2026-11-26T09:20:00.000Z', 'agent'),
      row('me2', '2026-11-26T09:25:00.000Z', '2026-11-26T09:30:00.000Z'),
    ])
    const byActor = Object.fromEntries(chains.map(c => [c.actor ?? 'me', c.sessions.map(s => s.path)]))
    expect(byActor).toEqual({ me: ['me1', 'me2'], agent: ['ag1'] })
  })
})
