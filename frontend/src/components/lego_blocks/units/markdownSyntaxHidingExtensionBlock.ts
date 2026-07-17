import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

// Live-preview phase 2 (CM6 decoration model): markdown formatting *reads* as
// a document — headings get real sizes, **bold** shows bold, [links](url)
// show just their styled text — while the markdown itself never changes.
// Styling marks apply everywhere; syntax markers hide only on lines the
// cursor isn't touching (per-line reveal, the Obsidian behavior). Driven by
// the Lezer markdown tree lang-markdown already maintains, so cost is
// proportional to the viewport, not the document.

const HEADING_LINE_CLASS_BLOCK: Record<string, string> = {
  ATXHeading1: 'ltm-cm-h1',
  ATXHeading2: 'ltm-cm-h2',
  ATXHeading3: 'ltm-cm-h3',
  ATXHeading4: 'ltm-cm-h4',
  ATXHeading5: 'ltm-cm-h5',
  ATXHeading6: 'ltm-cm-h6',
}

const hiddenMarkDecorationBlock = Decoration.replace({})
const boldMarkBlock = Decoration.mark({ class: 'ltm-cm-strong' })
const italicMarkBlock = Decoration.mark({ class: 'ltm-cm-em' })
const strikeMarkBlock = Decoration.mark({ class: 'ltm-cm-strike' })
const inlineCodeMarkBlock = Decoration.mark({ class: 'ltm-cm-inline-code' })
const linkTextMarkBlock = Decoration.mark({ class: 'ltm-cm-link' })
const quoteMarkBlock = Decoration.mark({ class: 'ltm-cm-quote-mark' })

/** Theme for the live-preview classes — pairs with the plugin below. */
export const markdownSyntaxHidingThemeBlock: Extension = EditorView.baseTheme({
  '.ltm-cm-h1': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.35' },
  '.ltm-cm-h2': { fontSize: '1.3em', fontWeight: '700', lineHeight: '1.35' },
  '.ltm-cm-h3': { fontSize: '1.15em', fontWeight: '600', lineHeight: '1.4' },
  '.ltm-cm-h4': { fontSize: '1.05em', fontWeight: '600' },
  '.ltm-cm-h5': { fontSize: '1em', fontWeight: '600' },
  '.ltm-cm-h6': { fontSize: '1em', fontWeight: '600', opacity: '0.8' },
  '.ltm-cm-strong': { fontWeight: '700' },
  '.ltm-cm-em': { fontStyle: 'italic' },
  '.ltm-cm-strike': { textDecoration: 'line-through', opacity: '0.75' },
  '.ltm-cm-inline-code': {
    fontSize: '0.92em',
    borderRadius: '4px',
    padding: '0.08em 0.3em',
    backgroundColor: 'hsl(var(--muted) / 0.55)',
  },
  '.ltm-cm-link': {
    color: 'hsl(var(--primary))',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    textDecorationColor: 'hsl(var(--primary) / 0.4)',
  },
  '.ltm-cm-quote-mark': { opacity: '0.4' },
})

interface SyntaxHidingOptionsBlock {
  isEnabled: () => boolean
}

export function createMarkdownSyntaxHidingExtensionBlock(
  options: SyntaxHidingOptionsBlock,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view)
        }
      }

      private build(view: EditorView): DecorationSet {
        if (!options.isEnabled()) return Decoration.none

        const cursorLines = new Set<number>()
        for (const range of view.state.selection.ranges) {
          const fromLine = view.state.doc.lineAt(range.from).number
          const toLine = view.state.doc.lineAt(range.to).number
          for (let n = fromLine; n <= toLine; n++) cursorLines.add(n)
        }
        const onCursorLine = (pos: number): boolean =>
          cursorLines.has(view.state.doc.lineAt(pos).number)

        // Collect first (tree iteration order isn't strictly sorted across
        // overlapping mark/replace ranges), then feed a sorted builder.
        const marks: Array<{ from: number; to: number; deco: Decoration }> = []
        const lineDecos: Array<{ at: number; cls: string }> = []

        for (const { from, to } of view.visibleRanges) {
          syntaxTree(view.state).iterate({
            from,
            to,
            enter: (node) => {
              const headingClass = HEADING_LINE_CLASS_BLOCK[node.name]
              if (headingClass) {
                lineDecos.push({ at: view.state.doc.lineAt(node.from).from, cls: headingClass })
                return
              }
              switch (node.name) {
                case 'StrongEmphasis':
                  marks.push({ from: node.from, to: node.to, deco: boldMarkBlock })
                  return
                case 'Emphasis':
                  marks.push({ from: node.from, to: node.to, deco: italicMarkBlock })
                  return
                case 'Strikethrough':
                  marks.push({ from: node.from, to: node.to, deco: strikeMarkBlock })
                  return
                case 'InlineCode':
                  marks.push({ from: node.from, to: node.to, deco: inlineCodeMarkBlock })
                  return
                case 'Link': {
                  // Style the visible text; URL + brackets hide via marks below.
                  marks.push({ from: node.from, to: node.to, deco: linkTextMarkBlock })
                  return
                }
                case 'QuoteMark':
                  marks.push({ from: node.from, to: node.to, deco: quoteMarkBlock })
                  return
                case 'HeaderMark': {
                  if (onCursorLine(node.from)) return
                  // Hide `##` plus the following space.
                  const after = view.state.doc.sliceString(node.to, node.to + 1)
                  marks.push({
                    from: node.from,
                    to: after === ' ' ? node.to + 1 : node.to,
                    deco: hiddenMarkDecorationBlock,
                  })
                  return
                }
                case 'EmphasisMark':
                case 'StrikethroughMark':
                case 'CodeMark': {
                  if (onCursorLine(node.from)) return
                  marks.push({ from: node.from, to: node.to, deco: hiddenMarkDecorationBlock })
                  return
                }
                case 'LinkMark': {
                  if (onCursorLine(node.from)) return
                  marks.push({ from: node.from, to: node.to, deco: hiddenMarkDecorationBlock })
                  return
                }
                case 'URL': {
                  if (onCursorLine(node.from)) return
                  // Hide the (url) part of [text](url); the parens are LinkMarks…
                  // except they aren't in all grammar versions, so pad to cover
                  // an immediately-surrounding ( ) pair when present.
                  let hideFrom = node.from
                  let hideTo = node.to
                  if (view.state.doc.sliceString(node.from - 1, node.from) === '(') hideFrom -= 1
                  if (view.state.doc.sliceString(node.to, node.to + 1) === ')') hideTo += 1
                  marks.push({ from: hideFrom, to: hideTo, deco: hiddenMarkDecorationBlock })
                  return
                }
                default:
                  return
              }
            },
          })
        }

        // Line and range decorations feed one builder, which requires sorted
        // input — merge and sort (line decos are zero-length, so from-ties
        // order them ahead of marks at the same position).
        const combined: Array<{ from: number; to: number; deco: Decoration }> = [
          ...lineDecos.map((entry) => ({ from: entry.at, to: entry.at, deco: Decoration.line({ class: entry.cls }) })),
          ...marks,
        ].sort((a, b) => a.from - b.from || a.to - b.to)
        const finalBuilder = new RangeSetBuilder<Decoration>()
        for (const entry of combined) {
          try {
            finalBuilder.add(entry.from, entry.to, entry.deco)
          } catch {
            // Overlapping ranges from odd nesting — skip rather than throw.
          }
        }
        return finalBuilder.finish()
      }
    },
    { decorations: (instance) => instance.decorations },
  )
  return [plugin, markdownSyntaxHidingThemeBlock]
}
