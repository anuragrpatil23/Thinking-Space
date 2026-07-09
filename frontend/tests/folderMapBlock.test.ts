import { describe, expect, it } from 'vitest'
import {
  applyFolderMapBlock,
  parseFolderMapBlock,
} from '@/services/lego_blocks/units/folderMapBlock'

describe('folderMapBlock — parser', () => {
  it('returns no sections for empty input', () => {
    expect(parseFolderMapBlock('').sections).toEqual([])
  })

  it('ignores prose, H1, and frontmatter', () => {
    const src = [
      '---',
      'type: ai_synthesis',
      '---',
      '',
      '# Worldly understanding',
      '',
      'Reading order is top-to-bottom.',
      '',
      '- [[money-as-ruler]] — the ruler vs the height',
      '- [[banks-create-money]] — where money comes from',
    ].join('\n')
    const { sections } = parseFolderMapBlock(src)
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('')
    expect(sections[0].entries.map(e => e.key)).toEqual(['money-as-ruler', 'banks-create-money'])
  })

  it('splits sections at ## headings, in order', () => {
    const src = [
      '## Money',
      '- [[a]] — one',
      '- [[b]] — two',
      '## Growth',
      '- [[c]] — three',
    ].join('\n')
    const { sections } = parseFolderMapBlock(src)
    expect(sections.map(s => s.title)).toEqual(['Money', 'Growth'])
    expect(sections[0].entries.map(e => e.key)).toEqual(['a', 'b'])
    expect(sections[1].entries.map(e => e.key)).toEqual(['c'])
  })

  it('tolerates -, en-dash, and em-dash separators, plus no separator at all', () => {
    const src = [
      '- [[a]] — em-dash',
      '- [[b]] – en-dash',
      '- [[c]] - hyphen',
      '- [[d]]: colon',
      '- [[e]]',
    ].join('\n')
    const entries = parseFolderMapBlock(src).sections[0].entries
    expect(entries).toEqual([
      { key: 'a', description: 'em-dash' },
      { key: 'b', description: 'en-dash' },
      { key: 'c', description: 'hyphen' },
      { key: 'd', description: 'colon' },
      { key: 'e', description: '' },
    ])
  })

  it('handles wikilinks with aliases, anchors, and .md extension', () => {
    const src = [
      '- [[money-as-ruler|the ruler]] — alias form',
      '- [[banks#lending]] — anchor',
      '- [[some/path/nested.md]] — nested path',
    ].join('\n')
    const keys = parseFolderMapBlock(src).sections[0].entries.map(e => e.key)
    expect(keys).toEqual(['money-as-ruler', 'banks', 'nested'])
  })

  it('marks duplicates; first occurrence keeps position', () => {
    const src = ['- [[a]] — first', '- [[b]] — other', '- [[a]] — repeat'].join('\n')
    const entries = parseFolderMapBlock(src).sections[0].entries
    expect(entries.map(e => e.key)).toEqual(['a', 'b', 'a'])
    expect(entries[0].duplicate).toBeUndefined()
    expect(entries[2].duplicate).toBe(true)
  })

  it('skips bullets without wikilinks and non-bullet lines', () => {
    const src = ['- plain bullet no link', 'not a bullet', '- [[a]] — kept'].join('\n')
    expect(parseFolderMapBlock(src).sections[0].entries.map(e => e.key)).toEqual(['a'])
  })

  it('accepts sub-bullets (flattened into their section)', () => {
    const src = ['- [[parent]] — top', '  - [[child]] — nested'].join('\n')
    const keys = parseFolderMapBlock(src).sections[0].entries.map(e => e.key)
    expect(keys).toEqual(['parent', 'child'])
  })
})

describe('folderMapBlock — apply against folder', () => {
  it('no map → empty sections, all files unmapped alphabetical', () => {
    const parsed = parseFolderMapBlock('')
    const out = applyFolderMapBlock(parsed, ['c', 'a', 'b'])
    expect(out.sections).toEqual([])
    expect(out.unmapped).toEqual(['a', 'b', 'c'])
  })

  it('appends unmapped files after mapped entries, alphabetical', () => {
    const parsed = parseFolderMapBlock('- [[b]] — mapped\n- [[a]] — mapped')
    const out = applyFolderMapBlock(parsed, ['a', 'b', 'z', 'm'])
    expect(out.sections[0].entries.map(e => e.key)).toEqual(['b', 'a'])
    expect(out.unmapped).toEqual(['m', 'z'])
  })

  it('flags map entries whose target is not in the folder', () => {
    const parsed = parseFolderMapBlock('- [[ghost]] — missing\n- [[real]] — here')
    const out = applyFolderMapBlock(parsed, ['real'])
    expect(out.sections[0].entries[0]).toMatchObject({ key: 'ghost', missing: true })
    expect(out.sections[0].entries[1].missing).toBeUndefined()
    expect(out.unmapped).toEqual([])
  })

  it('does not treat a missing target as "claimed" — the real file with same name stays unmapped', () => {
    // Regression check for the "folder is truth" invariant.
    const parsed = parseFolderMapBlock('- [[a]] — first ref')
    const out = applyFolderMapBlock(parsed, ['a', 'b'])
    expect(out.unmapped).toEqual(['b'])
  })

  it('handles the F9 worldly-understanding shape end-to-end', () => {
    const src = [
      '---',
      'type: ai_synthesis',
      '---',
      '# Worldly understanding — reading map',
      '',
      'Reading order is top-to-bottom.',
      '',
      '## Money and the machine',
      '- [[money-as-ruler-stuff-as-height]] — the ruler vs the height',
      '- [[banks-create-money-when-they-lend]] — where money comes from',
      '',
      '## Growth and technology',
      '- [[the-red-queen-treadmill]] — ideas get harder',
    ].join('\n')
    const parsed = parseFolderMapBlock(src)
    const out = applyFolderMapBlock(parsed, [
      'money-as-ruler-stuff-as-height',
      'banks-create-money-when-they-lend',
      'the-red-queen-treadmill',
      'orphan-note',
    ])
    expect(out.sections.map(s => s.title)).toEqual([
      'Money and the machine',
      'Growth and technology',
    ])
    expect(out.unmapped).toEqual(['orphan-note'])
  })
})
