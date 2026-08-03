import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What these guard is the boundary between a proposal and a commit.
 *
 * The draft is allowed to be wrong — a human reads it before anything is
 * written. What it is not allowed to do is name an undertaking that does not
 * exist, because "file into this" pointing at an invented key would create a
 * record nobody named, which is the one thing ASSIGNMENT.md never lets an AI
 * path do.
 */

const chains = [
  {
    projectId: 'F9',
    chainId: 'c-2',
    chainKey: 'c-2',
    date: '2026-06-03',
    title: 'HBM supply notes',
    summary: 'Read two supplier filings.',
    sessions: ['s2'],
  },
  {
    projectId: 'F9',
    chainId: 'c-1',
    chainKey: 'c-1',
    date: '2026-06-01',
    title: 'Micron read',
    summary: 'Read the 10-K.',
    sessions: ['s1'],
  },
]

const undertakings = [
  { key: 'f9-und-micron', title: 'Micron memory cycle', head: 'HBM is the thesis.' },
]

const sections = [{ key: 'f9-sec-semis', title: 'Semis' }]

vi.mock('@/services/lego_blocks/integrations/aiActivityChainIndexBlock', () => ({
  listChainsBlock: async () => chains,
}))

vi.mock('@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock', () => ({
  listUndertakingsBlock: async () => undertakings,
  listSectionsBlock: async () => sections,
}))

const selection = vi.fn(async () => ({ provider: 'claude', model: 'test-model' }))
vi.mock('@/services/orchestrators/aiSettingsOrch', () => ({
  resolveAiSelectionOrch: (...args: unknown[]) => selection(...(args as [])),
  resolveAiThinkingForScopeProviderOrch: () => false,
}))

const reply = vi.fn(async () => ({ response: { content: '{}', provider: 'claude', model: 'test-model' } }))
vi.mock('@/services/orchestrators/chatOrch', () => ({
  sendChatWithTelemetryOrch: (...args: unknown[]) => reply(...(args as [])),
}))

const { draftUndertakingForChainsOrch } = await import('@/services/orchestrators/assignmentDraftOrch')

function replyWith(payload: unknown): void {
  reply.mockResolvedValueOnce({
    response: { content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, provider: 'claude', model: 'test-model' },
  } as never)
}

describe('draftUndertakingForChainsOrch', () => {
  beforeEach(() => {
    reply.mockClear()
    selection.mockClear()
    selection.mockResolvedValue({ provider: 'claude', model: 'test-model' })
  })

  it('matches an undertaking the project actually has', async () => {
    replyWith({
      existing_key: 'f9-und-micron',
      title: 'Micron memory cycle',
      head: 'More of the same read.',
      section_key: 'f9-sec-semis',
      rationale: 'Same filings, same thesis.',
    })

    const draft = await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-1', 'c-2'] })

    expect(draft.kind).toBe('existing')
    expect(draft.existingKey).toBe('f9-und-micron')
    expect(draft.existingTitle).toBe('Micron memory cycle')
    expect(draft.sectionKey).toBe('f9-sec-semis')
    expect(draft.usedAi).toBe(true)
  })

  it('downgrades an invented key to a mint rather than filing into nothing', async () => {
    replyWith({
      existing_key: 'f9-und-invented',
      title: 'HBM supply',
      head: 'Two supplier filings.',
      section_key: '',
      rationale: 'New thread.',
    })

    const draft = await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-2'] })

    expect(draft.kind).toBe('new')
    expect(draft.existingKey).toBeUndefined()
    expect(draft.title).toBe('HBM supply')
  })

  it('drops a section key the project does not have', async () => {
    replyWith({ existing_key: '', title: 'T', head: 'H', section_key: 'nope', rationale: 'R' })

    const draft = await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-1'] })

    expect(draft.sectionKey).toBeUndefined()
  })

  it('falls back to the digests when no provider is configured, and asks nothing', async () => {
    selection.mockResolvedValue(null as never)

    const draft = await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-1', 'c-2'] })

    expect(reply).not.toHaveBeenCalled()
    expect(draft.usedAi).toBe(false)
    expect(draft.kind).toBe('new')
    // Oldest chain first: the draft describes where the work started.
    expect(draft.title).toBe('Micron read')
    expect(draft.head).toContain('Read the 10-K.')
  })

  it('keeps the heuristic draft when the reply is not JSON', async () => {
    reply.mockResolvedValueOnce({
      response: { content: 'I think this is about memory.', provider: 'claude', model: 'test-model' },
    } as never)

    const draft = await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-1'] })

    expect(draft.kind).toBe('new')
    expect(draft.title).toBe('Micron read')
  })

  it('sends only the selected chains', async () => {
    replyWith({ existing_key: '', title: 'T', head: 'H', section_key: '', rationale: 'R' })

    await draftUndertakingForChainsOrch({ projectId: 'F9', chainIds: ['c-2'] })

    const prompt = (reply.mock.calls[0] as unknown as [string, Array<{ content: string }>])[1][0].content
    expect(prompt).toContain('HBM supply notes')
    expect(prompt).not.toContain('Micron read')
  })
})
