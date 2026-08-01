import { beforeEach, describe, expect, it } from 'vitest'
import {
  explainCanonicalProjectBlock,
  resolveCanonicalProjectBlock,
} from '@/services/lego_blocks/units/aiActivityMappingBlock'
import {
  projectAliasesFromProjectsBlock,
  projectRegistryFromProjectsBlock,
  setCachedProjectAliasesBlock,
  setCachedProjectRegistryBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'

// The precedence ladder in one place, because each rung exists for a different
// reason and getting the order wrong is silent: sessions just land in the wrong
// project and nothing on screen says why.

const VAULT = '/Users/x/Vault'
const REPO = '/Volumes/Code/Thinking-Space'

const PROJECTS = [
  { key: 'thinkingspace.ai', roots: ['lifeblood_systems/thinkingspace.ai', REPO], aliases: ['backend', 'App'] },
  { key: 'F9', roots: ['acceleration_core/F9'], aliases: [] },
]

const NO_RULES = { rules: [], colors: {} }

beforeEach(() => {
  setCachedProjectRegistryBlock(projectRegistryFromProjectsBlock(PROJECTS, VAULT))
  setCachedProjectAliasesBlock(projectAliasesFromProjectsBlock(PROJECTS))
})

describe('resolveCanonicalProjectBlock', () => {
  it('resolves by cwd when the session ran inside a registered root', () => {
    expect(resolveCanonicalProjectBlock('frontend', null, `${REPO}/frontend`, NO_RULES))
      .toBe('thinkingspace.ai')
  })

  // The case roots cannot reach: cwd was the vault root, which belongs to no
  // project, so no prefix will ever match and only the name can fold it in.
  it('falls back to an alias when no root contains the cwd', () => {
    expect(resolveCanonicalProjectBlock('backend', null, VAULT, NO_RULES)).toBe('thinkingspace.ai')
  })

  it('matches an alias case-insensitively and with no cwd at all', () => {
    expect(resolveCanonicalProjectBlock('app', null, null, NO_RULES)).toBe('thinkingspace.ai')
  })

  // Path beats name. A folder called `backend` inside F9 is F9's, whatever
  // another project claimed that word for.
  it('lets a matching root outrank an alias on the same name', () => {
    expect(
      resolveCanonicalProjectBlock('backend', null, `${VAULT}/acceleration_core/F9/backend`, NO_RULES),
    ).toBe('F9')
  })

  // A rule is a deliberate override typed by the user; it outranks both.
  it('lets an explicit rule outrank the registry', () => {
    const settings = {
      rules: [{ id: 'r1', mode: 'exact' as const, match: 'frontend', output: 'Elsewhere', enabled: true }],
      colors: {},
    }
    expect(resolveCanonicalProjectBlock('frontend', null, `${REPO}/frontend`, settings)).toBe('Elsewhere')
  })

  it('falls back to the detected name when nothing matches', () => {
    expect(resolveCanonicalProjectBlock('Reps', null, '/Volumes/Code/Reps', NO_RULES)).toBe('Reps')
  })
})

describe('explainCanonicalProjectBlock', () => {
  // The settings page shows *why* a session landed where it did. That reason
  // has to come from the same walk that decided it — a second copy of the
  // ladder would explain one thing while the views group by another.
  it('names the registered root that claimed a cwd', () => {
    expect(explainCanonicalProjectBlock('frontend', null, `${REPO}/frontend`, NO_RULES)).toEqual({
      canonical: 'thinkingspace.ai',
      source: 'root',
      via: REPO,
    })
  })

  it('names the alias when no root contains the cwd', () => {
    expect(explainCanonicalProjectBlock('backend', null, VAULT, NO_RULES)).toEqual({
      canonical: 'thinkingspace.ai',
      source: 'alias',
      via: 'backend',
    })
  })

  it('names the rule when one fires, and the rule still outranks the root', () => {
    const rules = {
      rules: [{ id: 'r1', mode: 'exact' as const, match: 'frontend', output: 'Elsewhere', enabled: true }],
      colors: {},
    }
    expect(explainCanonicalProjectBlock('frontend', null, `${REPO}/frontend`, rules)).toEqual({
      canonical: 'Elsewhere',
      source: 'rule',
      via: 'frontend',
    })
  })

  it('reports an unclaimed project as detected, so the page can offer to adopt it', () => {
    expect(explainCanonicalProjectBlock('Stranger', null, '/tmp/Stranger', NO_RULES)).toEqual({
      canonical: 'Stranger',
      source: 'detected',
      via: '',
    })
  })
})
