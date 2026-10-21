import { describe, expect, it } from 'vitest'
import { sessionProjectsBlock, sessionProjectsLabelBlock } from '@/services/lego_blocks/units/sessionProjectsBlock'

const projects = [
  { name: 'sfresearch', roots: ['lifeblood_systems/sfresearch'] },
  { name: 'sfai', roots: ['lifeblood_systems/sfresearch/projects/sfai', 'lifeblood_systems/sfai'] },
  { name: 'Thinking-Space', roots: ['lifeblood_systems/thinkingspace.ai', '/Volumes/Code/Thinking-Space'] },
  { name: 'Vault', roots: [''] },
]

describe('sessionProjectsBlock', () => {
  it('counts files by the most specific project root', () => {
    const result = sessionProjectsBlock([
      'lifeblood_systems/sfresearch/People/a.md',
      'lifeblood_systems/sfresearch/People/b.md',
      'lifeblood_systems/sfresearch/projects/sfai/plan.md',
    ], projects)
    expect(result).toEqual([{ name: 'sfresearch', count: 2 }, { name: 'sfai', count: 1 }])
  })

  it('ignores absolute and whole-vault roots and unmatched files', () => {
    expect(sessionProjectsBlock(['notes/loose.md', 'Volumes/Code/Thinking-Space/x.md'], projects)).toEqual([])
  })

  it('labels one project by name and several by the main one plus a count', () => {
    expect(sessionProjectsLabelBlock([{ name: 'sfresearch', count: 9 }])).toBe('sfresearch')
    expect(sessionProjectsLabelBlock([{ name: 'sfresearch', count: 8 }, { name: 'sfai', count: 1 }])).toBe('sfresearch +1')
    expect(sessionProjectsLabelBlock([])).toBeNull()
  })
})
