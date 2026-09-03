import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ThinkingspaceReadingRecord } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
})

const { readingRecordToSession } = await import(
  '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'
)
const { setCachedProjectRegistryBlock } = await import(
  '@/services/lego_blocks/units/projectRegistryBlock'
)
const { resolveCanonicalProjectBlock } = await import(
  '@/services/lego_blocks/units/aiActivityMappingBlock'
)

const VAULT = '/Users/x/Vault'

function span(filePath: string): ThinkingspaceReadingRecord {
  return {
    key: `reading-pdf|${filePath}|1`,
    source: 'reading-pdf',
    filePath,
    title: 'doc',
    method: 'measured',
    startMs: 1_756_500_000_000,
    endMs: 1_756_500_600_000,
    activeMs: 600_000,
    recordedAt: 1_756_500_600_000,
  }
}

/** What the panel actually shows: the parse, then the canonical ladder that
 *  useAiActivityBlock runs over every session. */
function projectOf(filePath: string): string {
  const s = readingRecordToSession(span(filePath))!
  return resolveCanonicalProjectBlock(s.project, s.path, s.cwd)
}

describe('reading sessions join the project dimension', () => {
  beforeEach(() => {
    store.clear()
    store.set('ltm-vault-root', VAULT)
    // The user's real registry, trimmed.
    setCachedProjectRegistryBlock([
      { project: 'sfbooks', paths: [`${VAULT}/lifeblood_systems/sfbooks`] },
      { project: 'sfdl', paths: [`${VAULT}/lifeblood_systems/sfdl`] },
      { project: 'Thinking-Space', paths: [`${VAULT}/lifeblood_systems/thinkingspace.ai`] },
      { project: 'F9', paths: [`${VAULT}/acceleration_core/F9`] },
    ])
  })

  // The defect this fixes: `project` was the document's own title, so every
  // file ever opened minted a project of its own beside F9 and Thinking-Space.
  it('files a book under the project that owns its folder', () => {
    expect(projectOf(
      'lifeblood_systems/sfbooks/Teachings/Current Reads/The Idea Factory - Jon Gertner/book.pdf',
    )).toBe('sfbooks')
  })

  it('files a note under its own project, not its leaf folder', () => {
    expect(projectOf('lifeblood_systems/sfdl/thoughts/some-note.md')).toBe('sfdl')
  })

  it('files a code-adjacent doc under the code project', () => {
    expect(projectOf('acceleration_core/F9/Synthesis/notes.md')).toBe('F9')
  })

  // Two different books, one project — the whole point. Previously these were
  // two separate "projects" that existed only because they were opened.
  it('collapses different books in one root to one project', () => {
    const a = projectOf('lifeblood_systems/sfbooks/A - Author/a.pdf')
    const b = projectOf('lifeblood_systems/sfbooks/B - Author/b.excalidraw.md')
    expect(a).toBe('sfbooks')
    expect(b).toBe('sfbooks')
  })

  it('falls back to the folder name when no registered root matches', () => {
    expect(projectOf('operations/sfw/airms/meetings/notes.md')).toBe('meetings')
  })

  it('keeps the document title as the topic, whatever the project', () => {
    const s = readingRecordToSession(span('lifeblood_systems/sfbooks/X/The Idea Factory.pdf'))!
    expect(s.topic).toBe('doc')
    expect(s.project).not.toBe('doc')
  })

  it('survives a file at the vault root', () => {
    expect(() => projectOf('loose.pdf')).not.toThrow()
  })
})
