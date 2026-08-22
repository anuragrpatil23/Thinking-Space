import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { visit } from 'unist-util-visit'
import type { Root } from 'hast'
import { markdownCodeHighlightRehypePluginsBlock } from '@/services/lego_blocks/integrations/markdownCodeHighlightPluginBlock'

function renderToHast(markdown: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(markdownCodeHighlightRehypePluginsBlock)
  return processor.runSync(processor.parse(markdown)) as Root
}

/** Every `hljs-*` class present anywhere in the tree. */
function tokenClasses(tree: Root): string[] {
  const found: string[] = []
  visit(tree, 'element', (node) => {
    const classes = node.properties?.className
    if (!Array.isArray(classes)) return
    for (const cls of classes) {
      if (typeof cls === 'string' && cls.startsWith('hljs-')) found.push(cls)
    }
  })
  return found
}

/** Concatenated text of the first <code> element. */
function codeText(tree: Root): string {
  let text = ''
  let seen = false
  visit(tree, 'element', (node) => {
    if (seen || node.tagName !== 'code') return
    seen = true
    visit(node, 'text', (leaf) => {
      text += leaf.value
    })
  })
  return text
}

describe('markdownCodeHighlightPluginBlock', () => {
  it('tokenizes a labelled code block', () => {
    const tree = renderToHast('```python\ndef greet():\n    return "hi"\n```\n')
    const classes = tokenClasses(tree)
    expect(classes).toContain('hljs-keyword')
    expect(classes).toContain('hljs-string')
  })

  it('keeps the source text intact while tokenizing it', () => {
    const tree = renderToHast('```js\nconst x = 1\n```\n')
    expect(codeText(tree)).toBe('const x = 1\n')
  })

  it('leaves an unlabelled block alone rather than guessing', () => {
    const tree = renderToHast('```\njust some prose-ish text\n```\n')
    expect(tokenClasses(tree)).toEqual([])
  })

  // TikzDiagramBlock reads its source by stringifying the code element's
  // children. Tokenizing would replace those with elements and the diagram
  // would render from "[object Object]".
  it('leaves tikz blocks untokenized so the diagram renderer can read them', () => {
    const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}'
    const tree = renderToHast('```tikz\n' + source + '\n```\n')
    expect(tokenClasses(tree)).toEqual([])
    expect(codeText(tree)).toBe(source + '\n')
  })

  it('does not throw on a language it has no grammar for', () => {
    expect(() => renderToHast('```rust\nfn main() {}\n```\n')).not.toThrow()
  })
})
