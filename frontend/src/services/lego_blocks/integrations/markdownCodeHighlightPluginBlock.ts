import rehypeHighlight from 'rehype-highlight'
import type { PluggableList } from 'unified'

// Syntax highlighting for fenced code blocks in *rendered* markdown (view mode).
// The editor gets its own highlighting from CM6 grammars — see
// `resolveFencedCodeLanguageBlock` in `editorLanguageBlock.ts`. This is the
// read-side twin of that.
//
// `rehype-highlight` (lowlight/highlight.js) over Shiki on purpose: Shiki's
// output is finer but it ships per-language TextMate grammars as large JSON and
// wants a WASM regex engine, which is a lot of weight to put behind a document
// you are only reading. lowlight's `common` set is ~37 languages of regex-based
// tokenizing, already in the lazy viewer chunk.
//
// Colours are NOT highlight.js's own stylesheet. Importing one would (a) fight
// the app's light/dark switch, since hljs ships two separate files with the same
// selectors, and (b) drop GitHub's palette into a themed app. The `.hljs-*`
// rules live in `index.css` next to the other `.prose` rules and are written
// against the app's own tokens.

export const markdownCodeHighlightRehypePluginsBlock: PluggableList = [
  [
    rehypeHighlight,
    {
      // Never guess. Auto-detection on an unlabelled block is a coin flip, and
      // a wrong guess paints prose-like pseudocode in keyword colours.
      detect: false,
      // Tikz blocks are consumed whole by `TikzDiagramBlock`, which reads its
      // source by stringifying the code element's children. Highlighting would
      // replace those children with token elements and the diagram would render
      // from "[object Object]". It is currently safe only because tikz is not a
      // registered language; this makes the exclusion deliberate.
      plainText: ['tikz'],
    },
  ],
]
