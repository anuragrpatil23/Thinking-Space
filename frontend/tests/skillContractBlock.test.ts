import { describe, expect, it } from 'vitest'
import { parseCsvBlock, validateSkillFolderBlock, type SkillContractBlock } from '@/services/lego_blocks/units/skillContractBlock'

const contract: SkillContractBlock = {
  name: 'demo', title: 'Demo', summary: '', version: 1, folder: 'x',
  rules: [
    { kind: 'onlyFiles', label: 'layout', patterns: ['^README\\.md$', '^values\\.csv$', '^pdfs/\\d{4}-\\d{2}\\.pdf$'] },
    { kind: 'files', label: 'pdfs', pattern: '^pdfs/\\d{4}-\\d{2}\\.pdf$', min: 2 },
    { kind: 'csv', label: 'values', file: 'values.csv', columns: ['month', 'total'], types: { month: 'month', total: 'number' }, minRows: 1 },
    { kind: 'monthsContiguous', label: 'months', file: 'values.csv', column: 'month' },
  ],
}

describe('a skill contract', () => {
  it('passes a folder that matches it', () => {
    const files = ['README.md', 'values.csv', 'pdfs/2026-01.pdf', 'pdfs/2026-02.pdf']
    const checks = validateSkillFolderBlock(contract, files, () => 'month,total\n2026-01,10\n2026-02,"1,5"\n'.replace('"1,5"', '15'))
    expect(checks.every(c => c.ok)).toBe(true)
  })

  it('names what is wrong: a stray file, too few files, a bad value, a missing month', () => {
    const files = ['values.csv', 'pdfs/2026-01.pdf', 'pdfs/January.pdf']
    const checks = validateSkillFolderBlock(contract, files, () => 'month,total\n2026-01,10\n2026-03,abc\n')
    const byLabel = Object.fromEntries(checks.map(c => [c.label, c]))
    expect(byLabel.layout.ok).toBe(false)
    expect(byLabel.layout.detail).toContain('pdfs/January.pdf')
    expect(byLabel.pdfs.ok).toBe(false)
    expect(byLabel.values.detail).toContain('total "abc" is not a number')
    expect(byLabel.months.detail).toContain('2026-02')
  })

  it('reports a missing CSV and wrong columns', () => {
    expect(validateSkillFolderBlock(contract, [], () => null).find(c => c.label === 'values')?.detail).toBe('Missing')
    const wrong = validateSkillFolderBlock(contract, ['values.csv'], () => 'month,value\n2026-01,1\n').find(c => c.label === 'values')
    expect(wrong?.detail).toContain('expected "month,total"')
  })

  it('reads quoted CSV fields', () => {
    expect(parseCsvBlock('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  })
})
