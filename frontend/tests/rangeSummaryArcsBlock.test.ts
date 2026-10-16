import { describe, expect, it } from 'vitest'
import { parseRangeSummaryArcsBlock } from '@/services/lego_blocks/units/rangeSummaryArcsBlock'

const BODY = `1. **Vault and Agent Infrastructure** — 1 session on Oct 16, **~1h 55m**.
   Landed realtime agent telemetry by consuming vault external-change events, and split the
   4.1 MB cache into \`per-month\` files.

2. **Thinking Space UI** — 2 sessions on Oct 16, **~1h 54m**. Reworked the transcript drawer.
3. **~5 bug fixes** across the range, **~40m combined**: null refund amount.
4. **Also worked on:** dead-code cleanup.`

describe('parseRangeSummaryArcsBlock', () => {
  it('splits arcs into title, meta and body, joining continuation lines', () => {
    const { arcs } = parseRangeSummaryArcsBlock(BODY)
    expect(arcs).toHaveLength(2)
    expect(arcs[0]).toEqual({
      title: 'Vault and Agent Infrastructure',
      meta: '1 session on Oct 16, ~1h 55m',
      body: 'Landed realtime agent telemetry by consuming vault external-change events, and split the 4.1 MB cache into `per-month` files.',
    })
    expect(arcs[1].title).toBe('Thinking Space UI')
    expect(arcs[1].body).toBe('Reworked the transcript drawer.')
  })

  it('keeps tail bullets as extras, not arcs', () => {
    const { extras } = parseRangeSummaryArcsBlock(BODY)
    expect(extras).toEqual([
      '~5 bug fixes across the range, ~40m combined: null refund amount.',
      'Also worked on: dead-code cleanup.',
    ])
  })

  it('yields no arcs for the rules-based fallback body', () => {
    const fallback = '1. hey there, so a question — 2026-10-14, 4h 30m\n2. ship it — 2026-10-16, 1h 27m'
    expect(parseRangeSummaryArcsBlock(fallback).arcs).toEqual([])
  })

  it('keeps an arc whose meta has no bold duration, with an empty meta', () => {
    const { arcs } = parseRangeSummaryArcsBlock('1. **Local LLM setup** — Initiated a new local Qwen instance.')
    expect(arcs).toEqual([{ title: 'Local LLM setup', meta: '', body: 'Initiated a new local Qwen instance.' }])
  })
})
