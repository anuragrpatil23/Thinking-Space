import { describe, expect, it } from 'vitest'
import {
  buildHtmlPageOutlineMarkdownBlock,
  buildHtmlPageScrollToHeadingScriptBlock,
  parseHtmlPageHeadingsBlock,
} from '../src/services/lego_blocks/units/htmlPageGuestBlock'
import { parseMarkdownTableOfContentsBlock } from '../src/services/lego_blocks/units/markdownTableOfContentsBlock'

describe('htmlPageGuestBlock', () => {
  it('keeps only well-formed headings from whatever the page returns', () => {
    expect(parseHtmlPageHeadingsBlock('nope')).toEqual([])
    expect(parseHtmlPageHeadingsBlock([
      { level: 1, title: ' Differentiation\n basics ' },
      { level: 7, title: 'too deep' },
      { level: 2, title: '' },
      null,
      { level: 3, title: 'The definition' },
    ])).toEqual([
      { level: 1, title: 'Differentiation basics' },
      { level: 3, title: 'The definition' },
    ])
  })

  it('gives the Contents control one item per heading, on its own line', () => {
    const headings = [
      { level: 1, title: 'Differentiation basics' },
      { level: 3, title: 'Two ways of looking at the same thing' },
      { level: 3, title: 'The slope of a straight line' },
    ]
    const items = parseMarkdownTableOfContentsBlock(buildHtmlPageOutlineMarkdownBlock(headings))
    expect(items.map((item) => item.title)).toEqual(headings.map((heading) => heading.title))
    expect(items.map((item) => item.line - 1)).toEqual([0, 1, 2])
  })

  it('never lets a bad index into the jump script', () => {
    expect(buildHtmlPageScrollToHeadingScriptBlock(2)).toContain('[2]')
    expect(buildHtmlPageScrollToHeadingScriptBlock(-5)).toContain('[0]')
    expect(buildHtmlPageScrollToHeadingScriptBlock(Number.NaN)).toContain('[0]')
  })
})
