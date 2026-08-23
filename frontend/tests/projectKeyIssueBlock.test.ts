import { describe, expect, it } from 'vitest'
import {
  explainProjectKeyIssueBlock,
  isValidProjectKeyBlock,
} from '@/services/lego_blocks/units/projectBlock'

describe('explainProjectKeyIssueBlock', () => {
  // The reported case: a folder whose POSIX name carries a colon. Nothing about
  // it is invalid — the colon is only special to Finder — so adoption must not
  // refuse it, and `sanitizeSegment` derives the on-disk spelling separately.
  it('accepts a colon in a detected folder name', () => {
    expect(explainProjectKeyIssueBlock('Austin house:land')).toBeNull()
    expect(isValidProjectKeyBlock('Austin house:land')).toBe(true)
  })

  it('treats surrounding whitespace as untidiness, not a rejection', () => {
    expect(explainProjectKeyIssueBlock('Austin house:land ')).toBeNull()
    // The old guard refused it outright — and blamed a path separator.
    expect(isValidProjectKeyBlock('Austin house:land ')).toBe(false)
  })

  it('names the rule that actually fired', () => {
    expect(explainProjectKeyIssueBlock('a/b')).toBe('separator')
    expect(explainProjectKeyIssueBlock('a\\b')).toBe('separator')
    expect(explainProjectKeyIssueBlock('ab')).toBe('control')
    expect(explainProjectKeyIssueBlock('x'.repeat(65))).toBe('too-long')
    expect(explainProjectKeyIssueBlock('   ')).toBe('empty')
    expect(explainProjectKeyIssueBlock('..')).toBe('empty')
  })

  it('reports a key another project already owns', () => {
    const taken = new Set(['insights', 'Austin house:land'])
    expect(explainProjectKeyIssueBlock('Austin house:land', taken)).toBe('taken')
    expect(explainProjectKeyIssueBlock('Austin house:land ', taken)).toBe('taken')
    expect(explainProjectKeyIssueBlock('relationship', taken)).toBeNull()
  })
})
