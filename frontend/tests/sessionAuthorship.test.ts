import { describe, it, expect } from 'vitest'
import {
  classifyUserTurnBlock,
  extractAutomationIdBlock,
  resolveAuthorshipBlock,
} from '@/services/lego_blocks/units/sessionAuthorshipBlock'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

const HB = (id: string, iso: string) =>
  `<heartbeat>\n  <automation_id>${id}</automation_id>\n  <current_time_iso>${iso}</current_time_iso>\n</heartbeat>`

describe('classifyUserTurnBlock', () => {
  it('reads Codex heartbeats and Claude task-notifications as automation', () => {
    expect(classifyUserTurnBlock(HB('cdmdeid-delta-pull-monitor', '2026-08-27T20:55:38Z'))).toBe(
      'automation',
    )
    expect(classifyUserTurnBlock('<task-notification>agent finished</task-notification>')).toBe(
      'automation',
    )
  })

  it('treats an empty body as a continuation, never as the human speaking', () => {
    // THE regression that matters: Claude Code files every tool_result as a
    // `type:"user"` event, and `flattenContent` drops the tool_result block —
    // so 81% of its user events arrive here empty. A `human` answer would reset
    // authorship ~25,000 times and re-credit every automated turn to the user.
    expect(classifyUserTurnBlock('')).toBe('continuation')
    expect(classifyUserTurnBlock('   \n  ')).toBe('continuation')
  })

  it('treats system-injected wrappers as continuations', () => {
    expect(classifyUserTurnBlock('<environment_context>\n <cwd>/x</cwd>')).toBe('continuation')
    expect(classifyUserTurnBlock('<local-command-stdout>ok</local-command-stdout>')).toBe(
      'continuation',
    )
    expect(classifyUserTurnBlock('anything at all', { isMeta: true })).toBe('continuation')
  })

  it('treats a sidechain turn as delegated work, not as automation', () => {
    // 73 transcripts in this vault are subagent-only. Calling these
    // continuations deleted all of them during development.
    expect(classifyUserTurnBlock('Search the vault for X', { isSidechain: true })).toBe('agent')
  })

  it('counts an interrupt as human presence', () => {
    expect(classifyUserTurnBlock('[Request interrupted by user]')).toBe('human')
  })

  it('extracts the automation id when the turn names one', () => {
    expect(extractAutomationIdBlock(HB('delta-merge-monitor', '2026-08-28T02:16:00Z'))).toBe(
      'delta-merge-monitor',
    )
    expect(extractAutomationIdBlock('<task-notification>done</task-notification>')).toBeUndefined()
  })
})

describe('resolveAuthorshipBlock', () => {
  it('propagates authorship to assistant turns from the turn that drove them', () => {
    const ev = [
      { isUser: true, body: 'do the thing' },
      { isUser: false, body: '' },
      { isUser: true, body: HB('mon', '2026-08-28T02:16:00Z') },
      { isUser: false, body: '' },
    ]
    resolveAuthorshipBlock(ev)
    expect(ev.map(e => (e as { author?: string }).author)).toEqual([
      'human',
      'human',
      'automation',
      'automation',
    ])
  })

  it('does not let a tool result reset an automated run back to human', () => {
    const ev = [
      { isUser: true, body: HB('mon', '2026-08-28T02:16:00Z') },
      { isUser: true, body: '' }, // tool_result
      { isUser: false, body: '' }, // assistant continuing the automated turn
    ]
    resolveAuthorshipBlock(ev)
    expect(ev.map(e => (e as { author?: string }).author)).toEqual([
      'automation',
      'automation',
      'automation',
    ])
  })

  it('flips back to human when the human actually speaks again', () => {
    const ev = [
      { isUser: true, body: HB('mon', '2026-08-28T02:16:00Z') },
      { isUser: false, body: '' },
      { isUser: true, body: 'hey whats going on' },
      { isUser: false, body: '' },
      { isUser: true, body: HB('mon', '2026-08-28T02:26:00Z') },
    ]
    resolveAuthorshipBlock(ev)
    expect(ev.map(e => (e as { author?: string }).author)).toEqual([
      'automation',
      'automation',
      'human',
      'human',
      'automation',
    ])
  })
})

// ── the behaviour the whole change exists for ──────────────────────────────

function codexLine(iso: string, role: 'user' | 'assistant', text: string) {
  return JSON.stringify({
    timestamp: iso,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: {
        type: role === 'user' ? 'UserMessage' : 'AgentMessage',
        content: [{ type: 'text', text }],
      },
    },
  })
}

function codexFile(lines: string[]) {
  const meta = JSON.stringify({
    timestamp: '2026-08-27T17:37:02.600Z',
    type: 'session_meta',
    payload: {
      id: '01a0444b-ee70-7721-b36b-544aa431b636',
      cwd: '/Users/x/MountSinaiGit',
      timestamp: '2026-08-27T17:37:02.064Z',
    },
  })
  return {
    source: 'codex' as const,
    relPath: '2026/08/27/rollout-2026-08-27T12-37-02-01a0444b-ee70-7721-b36b-544aa431b636.jsonl',
    mtime: 1,
    text: [meta, ...lines].join('\n'),
  }
}

describe('parseNativeAiSession — automation does not create or extend sittings', () => {
  it('does not let heartbeats bridge an idle gap and extend a sitting', () => {
    // Human works 17:40–17:50, then leaves. An automation polls every 10
    // minutes until 21:00. Before this fix each gap stayed under the 1h idle
    // threshold, so the sitting was reported as running to 21:00.
    const lines = [
      codexLine('2026-08-27T17:40:00.000Z', 'user', 'lets work on the delta pull'),
      codexLine('2026-08-27T17:45:00.000Z', 'assistant', 'on it'),
      codexLine('2026-08-27T17:50:00.000Z', 'user', 'keep monitoring it'),
      codexLine('2026-08-27T17:52:00.000Z', 'assistant', 'will do'),
    ]
    for (let m = 0; m < 20; m++) {
      const t = new Date(Date.parse('2026-08-27T18:00:00.000Z') + m * 10 * 60_000).toISOString()
      lines.push(codexLine(t, 'user', HB('cdmdeid-delta-pull-monitor', t)))
      lines.push(codexLine(t, 'assistant', 'still running'))
    }
    const out = parseNativeAiSession(codexFile(lines))

    expect(out).toHaveLength(1)
    expect(out[0].startedIso).toBe('2026-08-27T17:40:00.000Z')
    // Ends at the last HUMAN-driven event, not at the last heartbeat.
    expect(out[0].endedIso).toBe('2026-08-27T17:52:00.000Z')
    expect(out[0].userMsgCount).toBe(2)
    expect(out[0].automationTurns).toBe(20)
    expect(out[0].automationIds).toEqual(['cdmdeid-delta-pull-monitor'])
  })

  it('emits no session at all for an automation-only window', () => {
    // The 2:16am and 6:46am-8:44am rows: nobody was awake, and each one cost a
    // paid digest to be told so.
    const lines = [
      codexLine('2026-08-27T17:40:00.000Z', 'user', 'kick it off and watch it'),
      codexLine('2026-08-27T17:41:00.000Z', 'assistant', 'watching'),
    ]
    for (const t of [
      '2026-08-28T07:16:00.000Z',
      '2026-08-28T11:46:00.000Z',
      '2026-08-28T13:44:00.000Z',
    ]) {
      lines.push(codexLine(t, 'user', HB('cdmdeid-delta-merge-monitor', t)))
      lines.push(codexLine(t, 'assistant', 'still running'))
    }
    const out = parseNativeAiSession(codexFile(lines))

    expect(out).toHaveLength(1)
    expect(out[0].endedIso).toBe('2026-08-27T17:41:00.000Z')
    expect(out.some(s => s.topic.includes('heartbeat'))).toBe(false)
  })

  it('keeps a single human turn buried in a night of automation', () => {
    // The 10:04pm-1:03am row: 29 user turns, 28 of them heartbeats and one
    // "hey whats going on". The sitting is real but nearly zero-length.
    const lines: string[] = []
    for (let m = 0; m < 10; m++) {
      const t = new Date(Date.parse('2026-08-28T03:04:00.000Z') + m * 10 * 60_000).toISOString()
      lines.push(codexLine(t, 'user', HB('cdmdeid-delta-merge-monitor', t)))
      lines.push(codexLine(t, 'assistant', 'still running'))
    }
    lines.push(codexLine('2026-08-28T04:50:00.000Z', 'user', 'hey whats going on'))
    lines.push(codexLine('2026-08-28T04:51:00.000Z', 'assistant', 'the merge is at step 3'))
    for (let m = 0; m < 10; m++) {
      const t = new Date(Date.parse('2026-08-28T05:00:00.000Z') + m * 10 * 60_000).toISOString()
      lines.push(codexLine(t, 'user', HB('cdmdeid-delta-merge-monitor', t)))
      lines.push(codexLine(t, 'assistant', 'still running'))
    }
    const out = parseNativeAiSession(codexFile(lines))

    expect(out).toHaveLength(1)
    expect(out[0].userMsgCount).toBe(1)
    expect(out[0].topic).toBe('hey whats going on')
    expect(out[0].startedIso).toBe('2026-08-28T04:50:00.000Z')
    expect(out[0].endedIso).toBe('2026-08-28T04:51:00.000Z')
    expect(out[0].automationTurns).toBe(10)
  })

  it('leaves a transcript with no automation completely unchanged', () => {
    const out = parseNativeAiSession(
      codexFile([
        codexLine('2026-08-27T17:40:00.000Z', 'user', 'first thing'),
        codexLine('2026-08-27T17:45:00.000Z', 'assistant', 'done'),
        codexLine('2026-08-27T20:00:00.000Z', 'user', 'second sitting'),
        codexLine('2026-08-27T20:05:00.000Z', 'assistant', 'done'),
      ]),
    )
    expect(out).toHaveLength(2)
    expect(out[0].topic).toBe('first thing')
    expect(out[1].topic).toBe('second sitting')
    expect(out[0].automationTurns).toBeUndefined()
  })
})
