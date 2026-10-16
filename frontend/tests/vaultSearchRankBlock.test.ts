import { describe, expect, it } from 'vitest'
import {
  buildVaultSearchTreeBlock,
  rankVaultSearchBlock,
  type VaultSearchDoc,
} from '@/services/lego_blocks/units/vaultSearchRankBlock'

function file(path: string, extra: Partial<VaultSearchDoc> = {}): VaultSearchDoc {
  const cut = path.lastIndexOf('/')
  const base = path.slice(cut + 1)
  return {
    path, kind: 'file',
    name: base.replace(/\.[^.]+$/, '').toLowerCase(),
    title: '', tags: '', content: '',
    folder: cut > 0 ? path.slice(0, cut).toLowerCase() : '',
    mtime: 0,
    ...extra,
  }
}
function folder(path: string): VaultSearchDoc {
  const cut = path.lastIndexOf('/')
  return { ...file(path), kind: 'folder', name: path.slice(cut + 1).toLowerCase() }
}

const docs: VaultSearchDoc[] = [
  file('reading/idea-factory.md'),
  file('lifeblood_systems/sfbooks/to-read.md', { content: 'notes on the idea factory review' }),
  file('archive/i-did-eat-a-lot.md'),
  file('lifeblood_systems/sfbooks/scan.pdf'),
  folder('lifeblood_systems/sfbooks'),
]

describe('rankVaultSearchBlock', () => {
  it('ranks a name hit above a content hit, and both above nothing', () => {
    const { hits } = rankVaultSearchBlock(docs, 'idea factory')
    expect(hits.map(h => h.path)).toEqual([
      'reading/idea-factory.md',
      'lifeblood_systems/sfbooks/to-read.md',
    ])
    expect(hits[0].reason).toBe('name')
    expect(hits[1].reason).toBe('content')
  })

  it('does not match letters scattered across a name', () => {
    const paths = rankVaultSearchBlock(docs, 'idea').hits.map(h => h.path)
    expect(paths).not.toContain('archive/i-did-eat-a-lot.md')
  })

  it('allows a compact abbreviation of a name', () => {
    expect(rankVaultSearchBlock(docs, 'ideafac').hits[0]?.path).toBe('reading/idea-factory.md')
  })

  it('combines a folder token with a name token', () => {
    const { hits } = rankVaultSearchBlock(docs, 'sfbooks read')
    expect(hits[0].path).toBe('lifeblood_systems/sfbooks/to-read.md')
  })

  it('finds non-markdown files and folders by name, within a scope', () => {
    expect(rankVaultSearchBlock(docs, 'scan').hits[0].path).toBe('lifeblood_systems/sfbooks/scan.pdf')
    const scoped = rankVaultSearchBlock(docs, 'idea', { scope: 'reading' })
    expect(scoped.hits.map(h => h.path)).toEqual(['reading/idea-factory.md'])
  })

  it('can return files only', () => {
    const { hits } = rankVaultSearchBlock(docs, 'sfbooks', { kind: 'file' })
    expect(hits.every(h => h.kind === 'file')).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('reports the total before the limit', () => {
    const ranking = rankVaultSearchBlock(docs, 'sfbooks', { limit: 1 })
    expect(ranking.hits).toHaveLength(1)
    expect(ranking.total).toBeGreaterThan(1)
  })
})

describe('buildVaultSearchTreeBlock', () => {
  it('lists only the branches that lead to hits, and marks folder hits', () => {
    const tree = buildVaultSearchTreeBlock([
      { path: 'reading/idea-factory.md', kind: 'file', score: 1, reason: 'name' },
      { path: 'lifeblood_systems/sfbooks', kind: 'folder', score: 1, reason: 'name' },
    ])
    expect(tree.nodes.get('')).toEqual({ folders: ['lifeblood_systems', 'reading'], files: [] })
    expect(tree.nodes.get('reading')).toEqual({ folders: [], files: ['idea-factory.md'] })
    expect(tree.nodes.get('lifeblood_systems')).toEqual({ folders: ['sfbooks'], files: [] })
    expect(tree.matchedFolders.has('lifeblood_systems/sfbooks')).toBe(true)
  })
})
