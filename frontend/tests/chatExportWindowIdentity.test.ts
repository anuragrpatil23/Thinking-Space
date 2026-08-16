import { describe, expect, it } from 'vitest'
import { parseVaultSessionsBlock } from '@/services/lego_blocks/units/aiActivityParserBlock'

/**
 * Chat-export windows are named for their content, like native ones.
 *
 * `nativeAiSessionParserBlock` stopped using ordinals for window ids on
 * 2026-08-14; the chat-export parser in `aiActivityParserBlock` was missed and
 * kept `::w1`, `::w2`. A ChatGPT/Grok conversation is re-exported wholesale, so
 * one added message in an earlier gap renumbers every later window — and a
 * window id is the session digest's address and the assignment ledger's key.
 * The model-derived half regenerates; the human `undertaking` silently moves.
 *
 * Chat exports carry no per-message id, so the anchor is the window's first
 * message timestamp: content rather than order, which is what the rule asks
 * for.
 */

const CONV = '67d86e34-37f8-800e-bbe9-f74960cba938'

function exportMd(times: string[]): string {
  const head = [
    '---',
    'title: "Fine-tuning Debugging Guide"',
    `conversation_id: ${CONV}`,
    'provider: chatgpt',
    'model: gpt-4o',
    `created: ${times[0]}`,
    'user_messages: 2',
    '---',
    '',
  ]
  const body = times.flatMap((t, i) => [
    `## ${i % 2 === 0 ? 'User' : 'Assistant'}`,
    `*${t}*`,
    '',
    `turn ${i} body text`,
    '',
  ])
  return [...head, ...body].join('\n')
}

function parse(times: string[]) {
  return parseVaultSessionsBlock({
    path: 'ai-activity/raw-sessions/chatgpt/2025/03/fine-tuning-debugging-guide.md',
    text: exportMd(times),
    mtime: 0,
  })
}

describe('chat-export window ids', () => {
  it('names a later window after its first message, not its index', () => {
    const sessions = parse([
      '2025-03-17 13:47',
      '2025-03-17 13:50',
      // >1h gap → new sitting
      '2025-03-17 18:00',
      '2025-03-17 18:05',
    ])

    expect(sessions).toHaveLength(2)
    // Window 0 keeps the bare conversation id — it is the conversation's own
    // address, and dedup elsewhere compares full ids.
    expect(sessions[0].sessionId).toBe(CONV)
    expect(sessions[1].sessionId).toMatch(/^67d86e34-.*::\d+$/)
    expect(sessions[1].sessionId).not.toContain('::w')
  })

  it('keeps a window id stable when an earlier sitting splits in two', () => {
    // The renumbering case: under `::wN` the final sitting is w1 before and w2
    // after, so anything keyed to it moves to different work.
    const before = parse([
      '2025-03-17 13:47',
      '2025-03-17 13:50',
      '2025-03-17 18:00',
    ])
    const after = parse([
      '2025-03-17 13:47',
      // the middle message drifted late enough to open a gap
      '2025-03-17 15:30',
      '2025-03-17 18:00',
    ])

    expect(before).toHaveLength(2)
    expect(after).toHaveLength(3)
    expect(after[after.length - 1].sessionId).toBe(before[before.length - 1].sessionId)
  })

  it('gives every window of one conversation a distinct id', () => {
    const sessions = parse([
      '2025-03-17 09:00',
      '2025-03-17 12:00',
      '2025-03-17 15:00',
      '2025-03-17 18:00',
    ])
    const ids = sessions.map(s => s.sessionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('still roots every window at the conversation, so a parked answer matches', () => {
    // `sessionRootBlock` splits on `::`; a timestamp contains none.
    const sessions = parse(['2025-03-17 09:00', '2025-03-17 18:00'])
    for (const s of sessions) {
      expect(s.sessionId!.split('::', 1)[0]).toBe(CONV)
    }
  })
})
