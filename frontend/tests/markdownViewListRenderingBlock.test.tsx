import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  preserveExtraBlankLinesInMarkdown,
  rehypeTrimBlockWhitespaceBlock,
} from '@/components/lego_blocks/units/MarkdownDocumentContentBlock'

// The viewer's pipeline, minus math/highlight/wikilinks.
const render = (markdown: string) => renderToStaticMarkup(
  <ReactMarkdown
    remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
    rehypePlugins={[rehypeTrimBlockWhitespaceBlock]}
  >
    {preserveExtraBlankLinesInMarkdown(markdown)}
  </ReactMarkdown>,
)

describe('markdown view rendering (2026-10-29 viewer bugs)', () => {
  it('a loose list item keeps its text on the bullet line', () => {
    const html = render('- the two circuits -\n  - ignore - llama\n- patching maybe?\n\n- what percentage\n')
    expect(html).not.toMatch(/<li>\s+<p>/)
    expect(html).toContain('<li><p>patching maybe?</p></li>')
  })

  it('a long gap inside a list does not turn the indented text after it into code', () => {
    const html = render('- VLM task.\n  - better tasks\n\n    counting estimation\n\n\n\n    methods for introspection\n\n    - steering vectors\n')
    expect(html).not.toContain('<pre>')
    expect(html).toContain('methods for introspection')
  })

  it('a long gap outside a list still keeps a top-level marker', () => {
    expect(preserveExtraBlankLinesInMarkdown('a\n\n\n\nb')).toBe('a\n\n\nLTM-BLANK-LINE-MARKER-V2\n\nb')
  })

  it('single tildes are approximations, not strikethrough', () => {
    const html = render('runs ~40% margin (~$139B on ~$334B), and ~~this~~ is struck')
    expect(html).toContain('~40% margin (~$139B')
    expect(html.match(/<del>/g)).toHaveLength(1)
  })
})
