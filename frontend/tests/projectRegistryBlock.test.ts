import { describe, expect, it } from 'vitest'
import {
  parseProjectRegistryMarkdownBlock,
  resolveProjectByCwdBlock,
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

  it('ignores headings and prose', () => {
    const entries = parseProjectRegistryMarkdownBlock(md, VAULT)
    expect(entries).toHaveLength(3)
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
