// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { createMarkdownSyntaxHidingExtensionBlock } from '@/components/lego_blocks/units/markdownSyntaxHidingExtensionBlock'

// Typing "- " under a paragraph line makes Markdown read the line as a heading
// for a moment; while the cursor is on that `-`, the editor keeps it as text.
function pendingLines(doc: string, cursor: number): number[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown(), createMarkdownSyntaxHidingExtensionBlock({ isEnabled: () => true })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const view = new EditorView({ state, parent: document.body })
  const lines = [...view.contentDOM.querySelectorAll('.cm-line')]
  const out = lines.flatMap((el, i) => (el.classList.contains('ltm-cm-setext-pending') ? [i + 1] : []))
  view.destroy()
  return out
}

describe('a lone dash under a line, being typed', () => {
  const doc = 'Q3 What about margins?\n- '

  it('keeps the line above as text while the cursor is on the dash', () => {
    expect(pendingLines(doc, doc.length)).toEqual([1, 2])
  })

  it('leaves real Markdown alone once the cursor moves off', () => {
    expect(pendingLines(doc, 0)).toEqual([])
  })

  it('does not touch a --- underline or a list item with text', () => {
    expect(pendingLines('Title\n---', 9)).toEqual([])
    expect(pendingLines('Q3?\n- an answer', 14)).toEqual([])
  })
})
