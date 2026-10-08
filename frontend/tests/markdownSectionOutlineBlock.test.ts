import { describe, expect, it } from 'vitest'
import { parseMarkdownTableOfContentsBlock } from '../src/services/lego_blocks/units/markdownTableOfContentsBlock'
import {
  buildMarkdownSectionRowsBlock,
  resolveMarkdownSectionLocationBlock,
  shouldNumberMarkdownHeadingsBlock,
} from '../src/services/lego_blocks/units/markdownSectionOutlineBlock'

const NOTE = [
  '# Scan spec',
  'intro',
  '## What the reader can do',
  '### See the network',
  '### Run text',
  '#### Details',
  '## The contract',
  '### Requests',
  '## Open questions',
].join('\n')

const rowsOf = (markdown: string) => buildMarkdownSectionRowsBlock(parseMarkdownTableOfContentsBlock(markdown))
const idOf = (rows: ReturnType<typeof rowsOf>, title: string) => rows.find((row) => row.title === title)!.id

describe('markdownSectionOutlineBlock', () => {
  it('labels headings exactly as the Contents list does, leaving the title unnumbered', () => {
    const rows = rowsOf(NOTE)
    expect(rows.map((row) => `${row.label}|${row.title}`)).toEqual([
      '|Scan spec',
      '1|What the reader can do',
      'a|See the network',
      'b|Run text',
      'i|Details',
      '2|The contract',
      'a|Requests',
      '3|Open questions',
    ])
    expect(rows[0].isTitle).toBe(true)
  })

  it('places a heading by its path and returns its whole top-level section', () => {
    const rows = rowsOf(NOTE)
    const location = resolveMarkdownSectionLocationBlock(rows, idOf(rows, 'Details'))
    expect(location.path.map((row) => row.title)).toEqual(['What the reader can do', 'Run text', 'Details'])
    expect(location.section.map((row) => row.title)).toEqual([
      'What the reader can do', 'See the network', 'Run text', 'Details',
    ])
  })

  it('shows what is still ahead in the section, not only what was passed', () => {
    const rows = rowsOf(NOTE)
    const location = resolveMarkdownSectionLocationBlock(rows, idOf(rows, 'See the network'))
    expect(location.section.map((row) => row.title)).toContain('Run text')
  })

  it('is nowhere above the first section, on the title, or for an unknown heading', () => {
    const rows = rowsOf(NOTE)
    for (const id of [null, idOf(rows, 'Scan spec'), 'missing']) {
      expect(resolveMarkdownSectionLocationBlock(rows, id)).toEqual({ path: [], section: [] })
    }
  })

  it('numbers a note with enough sections', () => {
    expect(shouldNumberMarkdownHeadingsBlock(rowsOf(NOTE))).toBe(true)
  })

  it('does not number a short note', () => {
    expect(shouldNumberMarkdownHeadingsBlock(rowsOf('# Title\n## One\n## Two'))).toBe(false)
  })

  it('does not number headings the author already numbered', () => {
    expect(shouldNumberMarkdownHeadingsBlock(rowsOf('# T\n## 1. Setup\n## 2. Run\n## 3. Verify'))).toBe(false)
    expect(shouldNumberMarkdownHeadingsBlock(rowsOf('# T\n## Step 1 install\n## Step 2 run\n## Notes'))).toBe(false)
    expect(shouldNumberMarkdownHeadingsBlock(rowsOf('# T\n## 2026 plans\n## Run\n## Verify\n## Ship'))).toBe(true)
  })
})

describe('heading titles in an outline', () => {
  const titles = (markdown: string) => parseMarkdownTableOfContentsBlock(markdown).map((item) => item.title)

  it('read as rendered text, without inline markdown', () => {
    expect(titles([
      '## `GET /scan/v1/health`',
      '## The **scanner** and the *view*',
      '## See [the spec](run-tracker-spec.md) and [[notes/plan|the plan]]',
      '## ~~Old~~ New [[Glossary]]',
      '## __init__ and _private_ names',
    ].join('\n'))).toEqual([
      'GET /scan/v1/health',
      'The scanner and the view',
      'See the spec and the plan',
      'Old New Glossary',
      'init and private names',
    ])
  })

  it('leave plain punctuation and code contents alone', () => {
    expect(titles([
      '## snake_case_name and 2 * 3 * 4',
      '## `a_b_c` uses `*args`',
      '## C# closing hashes ##',
    ].join('\n'))).toEqual([
      'snake_case_name and 2 * 3 * 4',
      'a_b_c uses *args',
      'C# closing hashes',
    ])
  })
})
