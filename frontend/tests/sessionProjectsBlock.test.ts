import { describe, expect, it } from 'vitest'
import { sessionProjectsBlock, sessionProjectsLabelBlock } from '@/services/lego_blocks/units/sessionProjectsBlock'

describe('sessionProjectsBlock', () => {
  it('uses each session\'s own project, weighted by files touched', () => {
    expect(sessionProjectsBlock([
      { project: 'sfresearch', fileCount: 8 },
      { project: 'sfresearch', fileCount: 1 },
      { project: 'Thinking-Space', fileCount: 2 },
    ])).toEqual([{ name: 'sfresearch', count: 9 }, { name: 'Thinking-Space', count: 2 }])
  })

  it('skips bracketed buckets and empty names', () => {
    expect(sessionProjectsBlock([{ project: '[auto-commit]', fileCount: 3 }, { project: ' ', fileCount: 1 }])).toEqual([])
  })

  it('labels one project by name and several by the main one plus a count', () => {
    expect(sessionProjectsLabelBlock([{ name: 'sfresearch', count: 9 }])).toBe('sfresearch')
    expect(sessionProjectsLabelBlock([{ name: 'sfresearch', count: 8 }, { name: 'sfai', count: 1 }])).toBe('sfresearch +1')
    expect(sessionProjectsLabelBlock([])).toBeNull()
  })
})
