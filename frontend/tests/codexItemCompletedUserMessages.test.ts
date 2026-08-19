import { describe, expect, it } from 'vitest'
import { parseNativeAiSession } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'

/**
 * Codex user turns come in two event_msg shapes, and the parser has to read
 * both.
 *
 * Codex ~0.147 dropped the flat `{type: 'user_message', message: '...'}` event
 * in favour of `{type: 'item_completed', item: {type: 'UserMessage', ...}}`.
 * The parser only knew the old one, so every session recorded by a current CLI
 * parsed as zero user messages, took `(no user message)` as its topic, and was
 * skipped by the digest — which deliberately spends no model call on a session
 * whose own message count says there is nothing to summarise. The transcript
 * viewer showed the messages the whole time (it reads `response_item`), which
 * is what made the failure look like a digest bug rather than a parse bug.
 */

const T0 = Date.parse('2026-08-18T14:35:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()

function meta() {
  return JSON.stringify({
    type: 'session_meta',
    timestamp: at(0),
    payload: {
      id: '01a0154a-04e7-7370-82cf-16b2aaab2bde',
      cwd: '/Users/me/code/MountSinaiGit',
      timestamp: at(0),
    },
  })
}

/** The env-context wrapper Codex sends as a real `response_item` user turn. */
function envContextResponseItem(offset: number) {
  return JSON.stringify({
    type: 'response_item',
    timestamp: at(offset),
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/Users/me/code/MountSinaiGit</cwd>\n</environment_context>' }],
    },
  })
}

function itemCompletedUser(offset: number, text: string) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at(offset),
    payload: {
      type: 'item_completed',
      item: { type: 'UserMessage', id: `u-${offset}`, content: [{ type: 'text', text }] },
    },
  })
}

function itemCompletedAgent(offset: number, text: string) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at(offset),
    payload: {
      type: 'item_completed',
      item: { type: 'AgentMessage', id: `a-${offset}`, content: [{ type: 'Text', text }] },
    },
  })
}

function legacyUserEventMsg(offset: number, message: string) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at(offset),
    payload: { type: 'user_message', message },
  })
}

const env = (text: string) => ({
  source: 'codex' as const,
  relPath: '2026/08/18/rollout-2026-08-18T09-32-47-01a0154a-04e7-7370-82cf-16b2aaab2bde.jsonl',
  mtime: 1_787_000_000,
  text,
})

describe('codex item_completed user messages', () => {
  it('counts item_completed UserMessage turns and titles the session from the first', () => {
    const out = parseNativeAiSession(env([
      meta(),
      envContextResponseItem(1_000),
      itemCompletedUser(2_000, 'hey there! so we are trying to debug some missing mrns in msm dataset.\nmore detail'),
      itemCompletedAgent(3_000, 'Looking at the ETL now.'),
      itemCompletedUser(4_000, 'second question'),
    ].join('\n')))

    expect(out).toHaveLength(1)
    expect(out[0].userMsgCount).toBe(2)
    expect(out[0].topic).toBe(
      'hey there! so we are trying to debug some missing mrns in msm dataset.',
    )
  })

  it('still reads the legacy flat user_message shape', () => {
    const out = parseNativeAiSession(env([
      meta(),
      legacyUserEventMsg(1_000, 'an older transcript still parses'),
      itemCompletedAgent(2_000, 'ok'),
    ].join('\n')))

    expect(out[0].userMsgCount).toBe(1)
    expect(out[0].topic).toBe('an older transcript still parses')
  })

  it('does not double-count when a build emits both shapes for one turn', () => {
    const out = parseNativeAiSession(env([
      meta(),
      legacyUserEventMsg(1_000, 'the one and only user turn'),
      itemCompletedUser(1_000, 'the one and only user turn'),
      itemCompletedAgent(2_000, 'ok'),
    ].join('\n')))

    expect(out[0].userMsgCount).toBe(1)
    expect(out[0].topic).toBe('the one and only user turn')
  })
})
