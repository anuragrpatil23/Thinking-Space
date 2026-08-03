import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { findSimilarNodesBlock, type SimilarityQuery } from '@/services/lego_blocks/integrations/similarityBlock'
import { findSimilarGroupedMatchesOrch } from '@/services/orchestrators/similarityOrch'

const getAllNodesMock = vi.fn<() => Promise<NodeRecord[]>>()

vi.mock('@/services/lego_blocks/integrations/dbBlock', async () => {
  const actual = await vi.importActual<typeof import('@/services/lego_blocks/integrations/dbBlock')>('@/services/lego_blocks/integrations/dbBlock')
  return {
    ...actual,
    getAllNodes: () => getAllNodesMock(),
  }
})

function makeNode(overrides: Partial<NodeRecord>): NodeRecord {
  return {
    uuid: overrides.uuid ?? crypto.randomUUID(),
    key: overrides.key ?? 'node-key',
    title: overrides.title ?? 'Node Title',
    type: overrides.type ?? 'thought',
    level: overrides.level ?? 5,
    filePath: overrides.filePath ?? 'notes/default.md',
    tags: overrides.tags ?? [],
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? '2026-02-17T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-02-17T00:00:00.000Z',
    description: overrides.description,
    aiSummary: overrides.aiSummary,
    bodyExcerpt: overrides.bodyExcerpt,
    parent: overrides.parent,
    metadataText: overrides.metadataText,
  }
}

describe('similarity lexical foundation', () => {
  beforeEach(() => {
    getAllNodesMock.mockReset()
  })

  it('ranks strong lexical matches above weak matches deterministically', () => {
    const nodes: NodeRecord[] = [
      makeNode({
        uuid: 'epic-1',
        key: 'cell-evolution-core',
        title: 'Cell Evolution Core Principles',
        type: 'epic',
        level: 1,
        tags: ['biology/cell-evolution'],
        filePath: 'biology/cell-evolution/epic.md',
        aiSummary: 'Mitochondria and ATP origin in early cellular systems.',
      }),
      makeNode({
        uuid: 'idea-1',
        key: 'weekly-planning',
        title: 'Weekly Planning',
        type: 'idea',
        level: 3,
        tags: ['productivity'],
        filePath: 'planning/weekly.md',
      }),
      makeNode({
        uuid: 'thought-1',
        key: 'mitochondria-note',
        title: 'Mitochondria note',
        type: 'thought',
        level: 5,
        tags: ['biology/mitochondria'],
        filePath: 'biology/cell-evolution/mitochondria.md',
      }),
    ]

    const query: SimilarityQuery = {
      text: 'cell evolution mitochondria atp',
      sourceFilePath: 'biology/cell-evolution/source.md',
      preferredTypes: ['epic', 'idea', 'thought'],
      limit: 10,
    }

    const first = findSimilarNodesBlock(nodes, query)
    const second = findSimilarNodesBlock(nodes, query)

    expect(first.map(item => item.node.uuid)).toEqual(second.map(item => item.node.uuid))
    expect(first[0]?.node.uuid).toBe('epic-1')
    expect(first[1]?.node.uuid).toBe('thought-1')
    expect(first.some(item => item.node.uuid === 'idea-1')).toBe(false)
  })

  it('groups matches by type for steward surfacing', async () => {
    getAllNodesMock.mockResolvedValue([
      makeNode({
        uuid: 'epic-1',
        key: 'tp-da-e-111-cell-evolution',
        title: 'Cell Evolution',
        type: 'epic',
        level: 1,
        tags: ['biology/cell-evolution'],
        filePath: 'epics/cell-evolution.md',
      }),
      makeNode({
        uuid: 'idea-1',
        key: 'tp-da-i-222-mitochondria',
        title: 'Mitochondria Origin',
        type: 'idea',
        level: 3,
        parent: 'tp-da-e-111-cell-evolution',
        tags: ['biology/mitochondria'],
        filePath: 'ideas/mitochondria-origin.md',
      }),
      makeNode({
        uuid: 'thought-1',
        key: 'tp-da-t-333-vital-question-note',
        title: 'Vital Question Note',
        type: 'thought',
        level: 5,
        tags: ['biology/cell-evolution'],
        filePath: 'thoughts/vital-question-note.md',
        bodyExcerpt: 'Life, ATP gradients, and proto-cell evolution context.',
      }),
    ])

    const grouped = await findSimilarGroupedMatchesOrch({
      text: 'cell evolution mitochondria atp',
      sourceFilePath: 'biology/cell-evolution/source.md',
      perTypeLimit: 3,
    })

    expect(grouped.engine).toBe('lexical-v1')
    expect(grouped.epics.map(item => item.node.uuid)).toEqual(['epic-1'])
    expect(grouped.ideas.map(item => item.node.uuid)).toEqual(['idea-1'])
    expect(grouped.thoughts.map(item => item.node.uuid)).toEqual(['thought-1'])
  })
})
