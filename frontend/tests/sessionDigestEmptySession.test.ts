import { describe, it, expect } from 'vitest'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { sessionDigestContract } from '@/services/lego_blocks/units/intelligence/contracts/sessionDigestContractBlock'

// The loop this prevents: the system prompt instructs the model to write
// "TITLE: (empty session)" for a session with nothing in it, and the title
// sanitizer rejected anything under three words. The model obeyed, the contract
// discarded the output as empty, nothing was persisted, and the next view queued
// the same session again — forever, two concurrency slots at a time.

const session = {
  path: 'native/claude/empty.jsonl',
  source: 'claude-code',
  project: 'Thinking-Space',
  userMsgCount: 0,
  startedIso: '2026-08-16T09:00:00.000Z',
  endedIso: '2026-08-16T09:00:30.000Z',
  topic: '',
  mtime: 1_770_000_000,
} as ParsedSession

describe('session digest contract · empty sessions', () => {
  it('accepts the empty-session title its own prompt asks for', () => {
    const out = sessionDigestContract.finalize!(
      'TITLE: (empty session)\n\n1. No substantive turns or tool calls occurred.',
      session,
    )
    expect(out).not.toBeNull()
    expect(out!.value.title).toBe('(empty session)')
  })

  it('accepts it without the TITLE: lead, and unparenthesised', () => {
    expect(sessionDigestContract.finalize!('empty session', session)?.value.title).toBe(
      '(empty session)',
    )
  })

  it('still rejects a genuinely unusable title', () => {
    expect(sessionDigestContract.finalize!('ok', session)).toBeNull()
  })

  it('keeps the summary that came with the empty title', () => {
    const out = sessionDigestContract.finalize!(
      'TITLE: (empty session)\n\n1. Session contained no user message.',
      session,
    )
    expect(out!.value.summary).toContain('no user message')
  })
})
