import { describe, expect, it } from 'vitest'
import {
  buildVaultGraphBlock,
  buildVaultSessionWindowsBlock,
  selectGraphNodesForChainsBlock,
  type VaultGraphNode,
} from '@/services/lego_blocks/integrations/vaultGraphBlock'
import type { VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import type { LinkRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

const NOW = Date.parse('2026-07-11T12:00:00Z')
const VAULT = 'Long-Term-Memory-iCloud'

function entry(path: string, mtimeSec: number, ctimeSec = mtimeSec): VaultEntry {
  return { path, size: 100, mtime: mtimeSec, ctime: ctimeSec }
}

function link(source: string, target: string): LinkRecord {
  return { sourceFilePath: source, targetFilePath: target, linkType: 'wikilink', rawText: '' }
}

function session(startIso: string, endIso: string, overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    path: 'history/claude/x',
    source: 'claude-code' as ParsedSession['source'],
    startedIso: startIso,
    endedIso: endIso,
    project: VAULT,
    userMsgCount: 3,
    topic: 't',
    hadClear: false,
    mtime: 0,
    ...overrides,
  }
}

function graphNode(id: string, aiTouchMs = 0): VaultGraphNode {
  return {
    id,
    title: id.split('/').pop()!.replace(/\.md$/, ''),
    project: 'p',
    degree: 0,
    birthMs: 0,
    heat: 0,
    aiTouchMs,
    aiBorn: false,
  }
}

function chain(overrides: Partial<ActivityChain> = {}): ActivityChain {
  return {
    key: 'k',
    project: VAULT,
    source: 'claude-code',
    startedIso: '2026-07-01T10:00:00Z',
    endedIso: '2026-07-01T10:30:00Z',
    msgCount: 3,
    topic: 't',
    sessions: [],
    ...overrides,
  }
}

describe('selectGraphNodesForChainsBlock', () => {
  const ROOT = '/Users/x/Vault'
  const nodes = [
    graphNode('acceleration_core/F9/a.md'),
    graphNode('lifeblood_systems/b.md'),
    graphNode('untouched.md', Date.parse('2026-01-01T00:00:00Z')),
  ]

  it('maps file-edit provenance to exact node ids (not approximate)', () => {
    const sel = selectGraphNodesForChainsBlock(
      [chain({ touchedPaths: [`${ROOT}/acceleration_core/F9/a.md`, `${ROOT}/lifeblood_systems/b.md`] })],
      nodes,
      ROOT,
    )
    expect([...sel.ids].sort()).toEqual(['acceleration_core/F9/a.md', 'lifeblood_systems/b.md'])
    expect(sel.approximate).toBe(false)
  })

  it('drops provenance paths outside the vault or missing from the graph', () => {
    const sel = selectGraphNodesForChainsBlock(
      [
        chain({
          touchedPaths: [
            `${ROOT}/acceleration_core/F9/a.md`, // in graph
            '/some/other/repo/code.ts', // outside vault + not .md
            `${ROOT}/deleted-note.md`, // under vault but not a node
          ],
        }),
      ],
      nodes,
      ROOT,
    )
    expect([...sel.ids]).toEqual(['acceleration_core/F9/a.md'])
    expect(sel.approximate).toBe(false)
  })

  it('lights nothing (not the time window) when a chain has provenance but none in the vault', () => {
    // A session that worked entirely outside the vault (a code repo). A note was
    // AI-touched inside the chain's span, so the time-window fallback WOULD light
    // it — but provenance tells us this session touched no vault notes, so it
    // must stay dark and the selection must not be marked approximate.
    const overlapping = graphNode('overlapping.md', Date.parse('2026-07-01T10:15:00Z'))
    const sel = selectGraphNodesForChainsBlock(
      [chain({ touchedPaths: ['/some/other/repo/code.ts', '/some/other/repo/main.rs'] })],
      [overlapping],
      ROOT,
    )
    expect([...sel.ids]).toEqual([])
    expect(sel.approximate).toBe(false)
  })

  it('falls back to the time window when a chain has no provenance', () => {
    const touchedNode = graphNode('touched.md', Date.parse('2026-07-01T10:15:00Z'))
    const sel = selectGraphNodesForChainsBlock(
      [chain()], // no touchedPaths
      [touchedNode, graphNode('untouched.md', Date.parse('2026-01-01T00:00:00Z'))],
      ROOT,
    )
    expect([...sel.ids]).toEqual(['touched.md'])
    expect(sel.approximate).toBe(true)
  })
})

describe('buildVaultSessionWindowsBlock', () => {
  it('keeps only vault sessions and merges overlapping windows', () => {
    const windows = buildVaultSessionWindowsBlock(
      [
        session('2026-07-01T10:00:00Z', '2026-07-01T10:30:00Z'),
        session('2026-07-01T10:32:00Z', '2026-07-01T11:00:00Z'), // merges via slack
        session('2026-07-02T10:00:00Z', '2026-07-02T10:10:00Z', { project: 'Other-Repo', cwd: '/x/Other-Repo' }),
      ],
      VAULT,
    )
    expect(windows).toHaveLength(1)
    expect(windows[0][0]).toBeLessThan(Date.parse('2026-07-01T10:00:00Z'))
    expect(windows[0][1]).toBeGreaterThan(Date.parse('2026-07-01T11:00:00Z'))
  })
})

describe('buildVaultGraphBlock', () => {
  const sec = (iso: string) => Date.parse(iso) / 1000

  it('builds nodes/links, dedupes edges, and excludes transcript archives', () => {
    const result = buildVaultGraphBlock({
      entries: [
        entry('acceleration_core/F9/a.md', sec('2026-06-01T00:00:00Z')),
        entry('lifeblood_systems/b.md', sec('2026-06-02T00:00:00Z')),
        entry('root-note.md', sec('2026-06-03T00:00:00Z')),
        entry('ai-raw/raw/codex/skip-me.md', sec('2026-06-03T00:00:00Z')),
        entry('history/claude/skip-me-too.md', sec('2026-06-03T00:00:00Z')),
        entry('ai-activity/chains/x/session.jsonl.md', sec('2026-06-03T00:00:00Z')),
        entry('.thinking-space/profile.md', sec('2026-06-03T00:00:00Z')),
        entry('lifeblood_systems/.trash/gone.md', sec('2026-06-03T00:00:00Z')),
      ],
      links: [
        link('acceleration_core/F9/a.md', 'lifeblood_systems/b.md'),
        link('lifeblood_systems/b.md', 'acceleration_core/F9/a.md'), // reverse duplicate
        link('acceleration_core/F9/a.md', 'acceleration_core/F9/a.md'), // self
        link('acceleration_core/F9/a.md', 'missing.md'), // dangling
      ],
      births: new Map(),
      sessions: [],
      vaultFolderName: VAULT,
      nowMs: NOW,
    })

    expect(result.nodes.map(n => n.id).sort()).toEqual([
      'acceleration_core/F9/a.md',
      'lifeblood_systems/b.md',
      'root-note.md',
    ])
    expect(result.links).toHaveLength(1)
    const a = result.nodes.find(n => n.id === 'acceleration_core/F9/a.md')!
    expect(a.degree).toBe(1)
    // Container roots resolve to their second segment (the project).
    expect(a.project).toBe('F9')
    expect(a.title).toBe('a')
    expect(result.nodes.find(n => n.id === 'lifeblood_systems/b.md')!.project).toBe(
      'lifeblood_systems',
    )
    expect(result.nodes.find(n => n.id === 'root-note.md')!.project).toBe('vault')
  })

  it('routes project names through the injected canonical resolver', () => {
    const result = buildVaultGraphBlock({
      entries: [entry('acceleration_core/F9/a.md', sec('2026-06-01T00:00:00Z'))],
      links: [],
      births: new Map(),
      sessions: [],
      vaultFolderName: VAULT,
      nowMs: NOW,
      resolveProject: (raw, path) => (path.includes('F9') ? 'F9 (canonical)' : raw),
    })
    expect(result.nodes[0].project).toBe('F9 (canonical)')
    expect(result.projects).toEqual(['F9 (canonical)'])
  })

  it('prefers git birth over ctime and falls back to ctime', () => {
    const gitBirth = Date.parse('2025-01-01T00:00:00Z')
    const result = buildVaultGraphBlock({
      entries: [
        entry('a.md', sec('2026-06-01T00:00:00Z'), sec('2026-05-01T00:00:00Z')),
        entry('b.md', sec('2026-06-02T00:00:00Z'), sec('2026-05-02T00:00:00Z')),
      ],
      links: [],
      births: new Map([['a.md', gitBirth]]),
      sessions: [],
      vaultFolderName: VAULT,
      nowMs: NOW,
    })
    expect(result.nodes.find(n => n.id === 'a.md')!.birthMs).toBe(gitBirth)
    expect(result.nodes.find(n => n.id === 'b.md')!.birthMs).toBe(Date.parse('2026-05-02T00:00:00Z'))
    expect(result.minBirthMs).toBe(gitBirth)
  })

  it('assigns heat only to files modified inside a vault AI session window', () => {
    const result = buildVaultGraphBlock({
      entries: [
        entry('touched.md', sec('2026-07-01T10:15:00Z')),
        entry('untouched.md', sec('2026-07-01T09:00:00Z')),
        entry('old-touch.md', sec('2026-01-01T10:15:00Z')),
      ],
      links: [],
      births: new Map(),
      sessions: [
        session('2026-07-01T10:00:00Z', '2026-07-01T10:30:00Z'),
        session('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z'),
      ],
      vaultFolderName: VAULT,
      nowMs: NOW,
    })
    const touched = result.nodes.find(n => n.id === 'touched.md')!
    const untouched = result.nodes.find(n => n.id === 'untouched.md')!
    const oldTouch = result.nodes.find(n => n.id === 'old-touch.md')!
    expect(touched.heat).toBeGreaterThan(0.5)
    expect(untouched.heat).toBe(0)
    // Touched long ago: technically attributed, but decayed to near-cold.
    expect(oldTouch.heat).toBeGreaterThan(0)
    expect(oldTouch.heat).toBeLessThan(0.01)
  })
})
