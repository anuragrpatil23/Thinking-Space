import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  resolveEditorLanguageBlock,
  resolveFencedCodeLanguageBlock,
} from '@/components/lego_blocks/units/editorLanguageBlock'

describe('resolveFencedCodeLanguageBlock', () => {
  it('resolves canonical names and their common aliases to one grammar', () => {
    expect(resolveFencedCodeLanguageBlock('python')).toBe(resolveFencedCodeLanguageBlock('py'))
    expect(resolveFencedCodeLanguageBlock('javascript')).toBe(resolveFencedCodeLanguageBlock('js'))
    expect(resolveFencedCodeLanguageBlock('yaml')).toBe(resolveFencedCodeLanguageBlock('yml'))
    expect(resolveFencedCodeLanguageBlock('typescript')).toBe(resolveFencedCodeLanguageBlock('ts'))
  })

  it('is case-insensitive', () => {
    expect(resolveFencedCodeLanguageBlock('Python')).toBe(resolveFencedCodeLanguageBlock('python'))
  })

  it('reads only the first word, so fence metadata does not break the match', () => {
    expect(resolveFencedCodeLanguageBlock('ts title="example.ts"'))
      .toBe(resolveFencedCodeLanguageBlock('ts'))
  })

  it('returns null for an empty or unknown info string', () => {
    expect(resolveFencedCodeLanguageBlock('')).toBeNull()
    expect(resolveFencedCodeLanguageBlock('   ')).toBeNull()
    expect(resolveFencedCodeLanguageBlock('rust')).toBeNull()
  })

  // ts/tsx and js/jsx are separate grammars — collapsing them would silently
  // mis-parse generics in .tsx fences.
  it('keeps the jsx/tsx variants distinct', () => {
    expect(resolveFencedCodeLanguageBlock('tsx')).not.toBe(resolveFencedCodeLanguageBlock('ts'))
    expect(resolveFencedCodeLanguageBlock('jsx')).not.toBe(resolveFencedCodeLanguageBlock('js'))
  })
})

/** Distinct node names covering `[from, to)`, resolved position by position.
 *
 *  Deliberately not `tree.iterate()`/`tree.cursor()`: a nested grammar is
 *  attached as a *mounted overlay*, and neither of those descends into one — a
 *  cursor walk of a highlighted Python fence reports only `CodeText` and looks
 *  exactly like a fence that was never parsed. `resolveInner` enters the mount,
 *  so it is the only traversal that can tell the two apart.
 *
 *  `ensureSyntaxTree` rather than `syntaxTree`, and that is what makes this
 *  deterministic. CodeMirror parses incrementally under a time budget, and
 *  `syntaxTree` returns whatever finished inside it — a nested grammar is
 *  mounted as parsing reaches it, so on a slow or loaded run the fence is still
 *  `CodeText` when the assertion reads it. That failed about one run in three
 *  and looked exactly like the feature being broken. The real editor is
 *  unaffected: it keeps parsing in the background and highlights progressively,
 *  which a one-shot state read cannot wait for. */
function resolvedNamesIn(doc: string, from: number, to: number): Set<string> {
  const state = EditorState.create({
    doc,
    extensions: [resolveEditorLanguageBlock('note.md').extension],
  })
  // Parse the whole document before reading it; fall back to the partial tree
  // only if even the generous budget was not enough, so a failure here is a
  // real one rather than a timing artefact.
  const tree = ensureSyntaxTree(state, doc.length, 10_000) ?? syntaxTree(state)
  const names = new Set<string>()
  for (let pos = from; pos < to; pos += 1) {
    names.add(tree.resolveInner(pos, 1).name)
  }
  return names
}

/** Offsets of the fence body, so the assertions do not hardcode indices. */
function fenceBody(doc: string): { from: number; to: number } {
  const from = doc.indexOf('\n') + 1
  const to = doc.lastIndexOf('```')
  return { from, to }
}

describe('markdown editor — fenced code parsing', () => {
  it('parses inside a labelled fence instead of leaving one flat token', () => {
    const doc = '```python\ndef greet():\n    return "hi"\n```\n'
    const body = fenceBody(doc)
    const names = resolvedNamesIn(doc, body.from, body.to)
    // These node types exist only in the Python grammar.
    expect(names).toContain('def')
    expect(names).toContain('String')
    expect(names).not.toContain('CodeText')
  })

  it('resolves an alias fence the same way as its canonical name', () => {
    const doc = '```py\ndef greet():\n    pass\n```\n'
    const body = fenceBody(doc)
    expect(resolvedNamesIn(doc, body.from, body.to)).toContain('def')
  })

  it('picks the grammar named by the fence, not a fixed one', () => {
    const doc = '```json\n{"a": 1}\n```\n'
    const body = fenceBody(doc)
    const names = resolvedNamesIn(doc, body.from, body.to)
    expect(names).toContain('PropertyName')
    expect(names).toContain('Number')
  })

  it('leaves an unlabelled fence as plain fenced code', () => {
    const doc = '```\ndef greet():\n```\n'
    const body = fenceBody(doc)
    const names = resolvedNamesIn(doc, body.from, body.to)
    expect(names).toContain('CodeText')
    expect(names).not.toContain('def')
  })

  it('falls back to plain fenced code for a language with no grammar', () => {
    const doc = '```rust\nfn main() {}\n```\n'
    const body = fenceBody(doc)
    expect(resolvedNamesIn(doc, body.from, body.to)).toContain('CodeText')
  })
})
