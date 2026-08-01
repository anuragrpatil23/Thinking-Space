import { afterEach, describe, expect, it } from 'vitest'
import {
  parseProjectRegistryMarkdownBlock,
  projectLabelBlock,
  projectAliasesFromProjectsBlock,
  projectRegistryFromProjectsBlock,
  renderProjectsMarkdownBlock,
  PROJECTS_MARKDOWN_BANNER_BLOCK,
  resolveProjectByAliasBlock,
  resolveProjectByCwdBlock,
  setCachedProjectNamesBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'

const VAULT = '/Users/x/Vault'

const md = `
# Projects

## acceleration_core/ — capital

- **F9** · \`acceleration_core/F9/\` — worldly understanding

## lifeblood_systems/

- **sfvisa** · \`lifeblood_systems/sfvisa/\` — visa work
- **thinkingspace.ai** · \`lifeblood_systems/thinkingspace.ai/\` \`/Volumes/Code/Thinking-Space\` — the app

Not a project line, just prose.
`

describe('parseProjectRegistryMarkdownBlock', () => {
  it('anchors vault-relative paths to the vault root and keeps absolute paths', () => {
    const entries = parseProjectRegistryMarkdownBlock(md, VAULT)
    const byName = Object.fromEntries(entries.map(e => [e.project, e.paths]))
    expect(byName['F9']).toEqual([`${VAULT}/acceleration_core/F9`])
    expect(byName['sfvisa']).toEqual([`${VAULT}/lifeblood_systems/sfvisa`])
    // A code-repo line carries a second, absolute path kept as-is.
    expect(byName['thinkingspace.ai']).toEqual([
      `${VAULT}/lifeblood_systems/thinkingspace.ai`,
      '/Volumes/Code/Thinking-Space',
    ])
  })

  // The real line explains the fragmentation it fixes, in backticks. Those are
  // examples, not roots — anchoring them would add folders that don't exist.
  it('ignores backticks in the prose after the em dash', () => {
    const entries = parseProjectRegistryMarkdownBlock(
      '- **ts** · `lifeblood_systems/ts/` — sessions from `Thinking-Space`/`frontend` land here',
      VAULT,
    )
    expect(entries).toEqual([{ project: 'ts', paths: [`${VAULT}/lifeblood_systems/ts`] }])
  })

  it('ignores headings and prose', () => {
    const entries = parseProjectRegistryMarkdownBlock(md, VAULT)
    expect(entries).toHaveLength(3)
  })
})

describe('projectRegistryFromProjectsBlock', () => {
  it('produces the same entries markdown did, from defined projects', () => {
    const entries = projectRegistryFromProjectsBlock(
      [
        { key: 'F9', roots: ['acceleration_core/F9/'] },
        {
          key: 'thinkingspace.ai',
          roots: ['lifeblood_systems/thinkingspace.ai', '/Volumes/Code/Thinking-Space'],
        },
      ],
      VAULT,
    )
    expect(entries).toEqual([
      { project: 'F9', paths: [`${VAULT}/acceleration_core/F9`] },
      {
        project: 'thinkingspace.ai',
        paths: [`${VAULT}/lifeblood_systems/thinkingspace.ai`, '/Volumes/Code/Thinking-Space'],
      },
    ])
  })

  // The key is the address on disk. A project that has none has no home to file
  // work under, so it is skipped rather than guessed at from `name`.
  it('skips a project with no key and one with no roots', () => {
    expect(
      projectRegistryFromProjectsBlock(
        [
          { key: '', roots: ['acceleration_core/F9'] },
          { key: 'Empty', roots: [] },
        ],
        VAULT,
      ),
    ).toEqual([])
  })

  it('resolves a cwd through the derived entries', () => {
    const entries = projectRegistryFromProjectsBlock([{ key: 'F9', roots: ['acceleration_core/F9'] }], VAULT)
    expect(resolveProjectByCwdBlock(`${VAULT}/acceleration_core/F9/notes`, entries)).toBe('F9')
  })
})

describe('project aliases', () => {
  const projects = [
    { key: 'thinkingspace.ai', aliases: ['Thinking-Space', 'frontend', 'backend'] },
    { key: 'F9', aliases: [] },
  ]

  it('folds a detected name onto the canonical key, case-insensitively', () => {
    const aliases = projectAliasesFromProjectsBlock(projects)
    expect(resolveProjectByAliasBlock('Thinking-Space', aliases)).toBe('thinkingspace.ai')
    expect(resolveProjectByAliasBlock('thinking-space', aliases)).toBe('thinkingspace.ai')
    expect(resolveProjectByAliasBlock('sfdl', aliases)).toBeNull()
  })

  // Otherwise a careless alias silently steals another project's own sessions.
  it("refuses an alias that is another project's key", () => {
    const aliases = projectAliasesFromProjectsBlock([
      { key: 'thinkingspace.ai', aliases: ['F9'] },
      { key: 'F9', aliases: [] },
    ])
    expect(resolveProjectByAliasBlock('F9', aliases)).toBeNull()
  })

  it('gives the first claim on a contested alias, not the last', () => {
    const aliases = projectAliasesFromProjectsBlock([
      { key: 'a', aliases: ['shared'] },
      { key: 'b', aliases: ['shared'] },
    ])
    expect(resolveProjectByAliasBlock('shared', aliases)).toBe('a')
  })

  it('ignores aliases on a project with no key', () => {
    const aliases = projectAliasesFromProjectsBlock([{ key: '', aliases: ['orphan'] }])
    expect(resolveProjectByAliasBlock('orphan', aliases)).toBeNull()
  })
})

describe('resolveProjectByCwdBlock', () => {
  const entries = parseProjectRegistryMarkdownBlock(md, VAULT)

  it('maps a cwd inside a project path to that project', () => {
    expect(resolveProjectByCwdBlock(`${VAULT}/acceleration_core/F9/notes`, entries)).toBe('F9')
  })

  it('collapses a code-repo checkout to the same project as its vault folder', () => {
    // The headline case: a session run from the repo, not the vault, still
    // attributes to thinkingspace.ai rather than fragmenting to "Thinking-Space".
    expect(resolveProjectByCwdBlock('/Volumes/Code/Thinking-Space/frontend', entries)).toBe('thinkingspace.ai')
  })

  it('returns null when no registered path contains the cwd', () => {
    expect(resolveProjectByCwdBlock('/Users/x/somewhere-else', entries)).toBeNull()
  })

  it('prefers the longest matching prefix', () => {
    const nested = parseProjectRegistryMarkdownBlock(
      `- **outer** · \`a/b\`\n- **inner** · \`a/b/c\``,
      '',
    )
    expect(resolveProjectByCwdBlock('a/b/c/d', nested)).toBe('inner')
  })
})

describe('project labels', () => {
  afterEach(() => setCachedProjectNamesBlock({}))

  it('renders the display name while the key stays the address', () => {
    // A rename must not move `ai-activity/chains/F9/` or split the project's
    // history: grouping, colors, and every on-disk path stay on the key.
    setCachedProjectNamesBlock({ F9: 'Acceleration Core' })
    expect(projectLabelBlock('F9')).toBe('Acceleration Core')
  })

  it('falls back to the key when a project has no name', () => {
    setCachedProjectNamesBlock({ F9: 'Acceleration Core' })
    expect(projectLabelBlock('thinkingspace.ai')).toBe('thinkingspace.ai')
  })
})

describe('renderProjectsMarkdownBlock', () => {
  const projects = [
    {
      key: 'Thinking-Space',
      name: 'Thinking Space',
      mission: 'The app that orchestrates\nthe other projects.',
      roots: ['lifeblood_systems/thinkingspace.ai', '/Volumes/Code/Thinking-Space'],
      group: 'lifeblood_systems',
      aliases: ['thinkingspace.ai'],
    },
    { key: 'F9', name: 'F9', mission: '', roots: ['acceleration_core/F9'], group: 'acceleration_core', aliases: [] },
    { key: '', name: 'Unaddressed', mission: '', roots: ['somewhere'], group: '', aliases: [] },
  ]

  it('marks itself generated so nobody hand-edits a mirror', () => {
    expect(renderProjectsMarkdownBlock(projects).startsWith(PROJECTS_MARKDOWN_BANNER_BLOCK)).toBe(true)
  })

  it('heads each line with the key, not the name', () => {
    const md = renderProjectsMarkdownBlock(projects)
    expect(md).toContain('- **Thinking-Space** (Thinking Space)')
    // A key that equals the name is not repeated in parentheses.
    expect(md).toContain('- **F9** `acceleration_core/F9`')
  })

  it('omits projects with no key — they have no address to publish', () => {
    expect(renderProjectsMarkdownBlock(projects)).not.toContain('Unaddressed')
  })

  it('round-trips through the parser, so the mirror can serve as a fallback', () => {
    const entries = parseProjectRegistryMarkdownBlock(renderProjectsMarkdownBlock(projects), VAULT)
    expect(entries).toEqual([
      { project: 'F9', paths: [`${VAULT}/acceleration_core/F9`] },
      {
        project: 'Thinking-Space',
        paths: [`${VAULT}/lifeblood_systems/thinkingspace.ai`, '/Volumes/Code/Thinking-Space'],
      },
    ])
  })

  it('is stable across calls so the mirror is only rewritten on real changes', () => {
    expect(renderProjectsMarkdownBlock(projects)).toBe(renderProjectsMarkdownBlock(projects))
  })
})
