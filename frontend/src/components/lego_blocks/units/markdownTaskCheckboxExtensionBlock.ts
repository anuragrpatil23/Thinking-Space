import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

// Live-preview phase 3: rendered elements that are also controls.
// - `- [ ]` / `- [x]` task markers render as real checkboxes; clicking one
//   toggles the markdown underneath (the only "edit through the rendering"
//   interaction so far — the click writes `[x]`/`[ ]` into the document).
// - `---` horizontal rules render as an actual rule.
// Per-line reveal as everywhere: cursor on the line shows raw markdown.

const TASK_MARKER_RE_BLOCK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s/
const HORIZONTAL_RULE_RE_BLOCK = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/

class TaskCheckboxWidgetBlock extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerFrom: number,
    private readonly markerTo: number,
  ) {
    super()
  }

  override eq(other: TaskCheckboxWidgetBlock): boolean {
    return other.checked === this.checked
      && other.markerFrom === this.markerFrom
      && other.markerTo === this.markerTo
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className = 'ltm-cm-task-checkbox'
    input.setAttribute('aria-label', this.checked ? 'Mark task not done' : 'Mark task done')
    // mousedown would move the editor selection onto the line (revealing raw
    // syntax and swallowing the click) — claim it first.
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('click', (event) => {
      event.preventDefault()
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerTo,
          insert: this.checked ? '[ ]' : '[x]',
        },
      })
    })
    return input
  }

  override ignoreEvent(): boolean {
    return true
  }
}

class HorizontalRuleWidgetBlock extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'ltm-cm-hr'
    return wrap
  }
}

export const markdownTaskCheckboxThemeBlock: Extension = EditorView.baseTheme({
  '.ltm-cm-task-checkbox': {
    verticalAlign: 'middle',
    margin: '0 0.15em 0.15em 0',
    accentColor: 'hsl(var(--primary))',
    cursor: 'pointer',
  },
  '.ltm-cm-task-done-line': {
    opacity: '0.55',
  },
  '.ltm-cm-hr': {
    display: 'inline-block',
    width: '100%',
    height: '1px',
    verticalAlign: 'middle',
    backgroundColor: 'hsl(var(--border))',
  },
})

interface TaskCheckboxOptionsBlock {
  isEnabled: () => boolean
}

export function createMarkdownTaskCheckboxExtensionBlock(
  options: TaskCheckboxOptionsBlock,
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

        const builder = new RangeSetBuilder<Decoration>()
        for (const { from, to } of view.visibleRanges) {
          let position = from
          while (position <= to) {
            const line = view.state.doc.lineAt(position)
            position = line.to + 1
            if (cursorLines.has(line.number)) continue

            const taskMatch = TASK_MARKER_RE_BLOCK.exec(line.text)
            if (taskMatch) {
              const checked = taskMatch[2].toLowerCase() === 'x'
              const bracketStart = line.from + taskMatch[0].lastIndexOf(`[${taskMatch[2]}]`)
              const bracketEnd = bracketStart + 3
              if (checked) {
                builder.add(line.from, line.from, Decoration.line({ class: 'ltm-cm-task-done-line' }))
              }
              builder.add(
                bracketStart,
                bracketEnd,
                Decoration.replace({
                  widget: new TaskCheckboxWidgetBlock(checked, bracketStart, bracketEnd),
                }),
              )
              continue
            }

            if (line.text.length > 0 && HORIZONTAL_RULE_RE_BLOCK.test(line.text)) {
              builder.add(
                line.from,
                line.to,
                Decoration.replace({ widget: new HorizontalRuleWidgetBlock() }),
              )
            }
          }
        }
        return builder.finish()
      }
    },
    { decorations: (instance) => instance.decorations },
  )
  return [plugin, markdownTaskCheckboxThemeBlock]
}
