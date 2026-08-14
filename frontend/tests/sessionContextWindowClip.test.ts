import { describe, expect, it, vi } from 'vitest'

/**
 * A sitting's transcript must contain that sitting, and nothing else.
 *
 * One JSONL file can hold several sittings: the parser splits it at idle gaps
 * into `<uuid>`, `<uuid>::w1`, `<uuid>::w2`, with `startedIso`/`endedIso` set to
 * each window's first and last event. Finding the file means stripping the
 * `#wN` suffix — so unless the reader clips by timestamp, every window reads the
 * WHOLE file and each one summarizes the entire day.
 *
 * That shipped. Two windows of one file produced near-identical summaries: a
 * 14-minute sitting was described as though it contained the 1h45m one that
 * followed it. It was survivable while a digest covered a whole chain and became
 * plainly wrong once each sitting got its own.
 *
 * The clip is not a new idea in this codebase — the chat-export reader has
 * always done it, and the parser attributes file edits the same way. These tests
 * pin that the native-JSONL reader does it too.
 */

const TRANSCRIPT = [
  // Morning sitting — 10:18–10:32.
  { type: 'user', timestamp: '2026-08-14T10:18:00.000Z', message: { content: 'MORNING_QUESTION about commodity pricing and how it works' } },
  { type: 'assistant', timestamp: '2026-08-14T10:20:00.000Z', message: { content: 'MORNING_ANSWER '.repeat(40) } },
  { type: 'user', timestamp: '2026-08-14T10:32:00.000Z', message: { content: 'MORNING_FOLLOWUP on the same pricing question please' } },
  // Afternoon sitting — 13:15–15:00. Same file, different window.
  { type: 'user', timestamp: '2026-08-14T13:15:00.000Z', message: { content: 'AFTERNOON_QUESTION about the physical grid and towers' } },
  { type: 'assistant', timestamp: '2026-08-14T14:00:00.000Z', message: { content: 'AFTERNOON_ANSWER '.repeat(40) } },
  { type: 'user', timestamp: '2026-08-14T15:00:00.000Z', message: { content: 'AFTERNOON_FOLLOWUP about the merit order slider' } },
]
  .map(e => JSON.stringify(e))
  .join('\n')

vi.mock('@/services/lego_blocks/integrations/nativeAiSessionsBlock', () => ({
  readNativeAiSession: async () => TRANSCRIPT,
}))
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({ read: async () => '' }),
}))
vi.mock('@/services/lego_blocks/units/storageKeyBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/storageKeyBlock')>()),
  getAiInputBudgetTokens: () => 5_000,
}))

const { extractSessionContextBlock } = await import(
  '@/services/lego_blocks/units/intelligence/contracts/chainContextExtractionBlock'
)
type ParsedSession = Parameters<typeof extractSessionContextBlock>[0]

function window(over: Partial<ParsedSession> & { path: string }): ParsedSession {
  return {
    source: 'claude-code',
    project: 'F9',
    userMsgCount: 2,
    topic: 'a topic',
    hadClear: false,
    mtime: 0,
    ...over,
  } as ParsedSession
}

const morning = window({
  path: 'native/claude/abc.jsonl',
  startedIso: '2026-08-14T10:18:00.000Z',
  endedIso: '2026-08-14T10:32:00.000Z',
})

const afternoon = window({
  // The `#w1` suffix is what makes this a second sitting off the same file.
  path: 'native/claude/abc.jsonl#w1',
  startedIso: '2026-08-14T13:15:00.000Z',
  endedIso: '2026-08-14T15:00:00.000Z',
})

describe('a sitting reads only its own window of a shared transcript', () => {
  it('keeps the morning window and excludes the afternoon entirely', async () => {
    const text = (await extractSessionContextBlock(morning)).turns.map(t => t.text).join('\n')

    expect(text).toContain('MORNING_QUESTION')
    expect(text).toContain('MORNING_FOLLOWUP')
    // The regression: without the clip this file's afternoon turns arrive here
    // too, and the 14-minute sitting gets summarized as the whole day.
    expect(text).not.toContain('AFTERNOON_QUESTION')
    expect(text).not.toContain('AFTERNOON_ANSWER')
  })

  it('keeps the afternoon window and excludes the morning entirely', async () => {
    const text = (await extractSessionContextBlock(afternoon)).turns.map(t => t.text).join('\n')

    expect(text).toContain('AFTERNOON_QUESTION')
    expect(text).toContain('AFTERNOON_FOLLOWUP')
    expect(text).not.toContain('MORNING_QUESTION')
    expect(text).not.toContain('MORNING_ANSWER')
  })

  it('gives the two windows different content, which is the whole point', async () => {
    const a = (await extractSessionContextBlock(morning)).turns.map(t => t.text).join('\n')
    const b = (await extractSessionContextBlock(afternoon)).turns.map(t => t.text).join('\n')

    expect(a).not.toEqual(b)
  })

  it('counts turns per window rather than for the whole file', async () => {
    const a = await extractSessionContextBlock(morning)
    const b = await extractSessionContextBlock(afternoon)

    // Three events each, and the assistant turn in each is long enough to
    // survive the mid-loop-stub filter.
    expect(a.meta.turnCount).toBe(3)
    expect(b.meta.turnCount).toBe(3)
  })

  it('is inclusive at both bounds, since the bounds ARE real events', async () => {
    // `startedIso`/`endedIso` are the window's first and last event timestamps,
    // so an exclusive comparison would drop the opening and closing turn of
    // every sitting — the two that say what it set out to do and how it ended.
    const text = (await extractSessionContextBlock(morning)).turns.map(t => t.text).join('\n')

    expect(text).toContain('MORNING_QUESTION') // exactly at startedIso
    expect(text).toContain('MORNING_FOLLOWUP') // exactly at endedIso
  })
})

describe('an event with no usable timestamp', () => {
  it('is kept, because absence of evidence is not evidence of exclusion', async () => {
    const undated = [
      JSON.stringify({ type: 'user', message: { content: 'UNDATED_TURN with no timestamp field at all' } }),
      JSON.stringify({ type: 'user', timestamp: 'not-a-date', message: { content: 'UNPARSEABLE_TURN timestamp' } }),
    ].join('\n')

    vi.doMock('@/services/lego_blocks/integrations/nativeAiSessionsBlock', () => ({
      readNativeAiSession: async () => undated,
    }))
    vi.resetModules()
    const { extractSessionContextBlock: extract } = await import(
      '@/services/lego_blocks/units/intelligence/contracts/chainContextExtractionBlock'
    )

    const text = (await extract(morning)).turns.map(t => t.text).join('\n')
    expect(text).toContain('UNDATED_TURN')
    expect(text).toContain('UNPARSEABLE_TURN')
  })
})
