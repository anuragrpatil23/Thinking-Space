import { StateEffect, StateField, EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, RectangleMarker, layer } from '@codemirror/view'
import { findSearchWordMatchesBlock } from '@/services/lego_blocks/units/searchHighlightTermsBlock'

// Vault-search hits inside an open note, drawn as a *layer* — rectangles
// underneath the text, never `Decoration.mark` spans, for the same reason as
// selectionMatchLayerBlock: splitting a line's text node into spans makes the
// browser re-shape it and the paragraph twitches. Markdown on disk is never
// touched (Editor contract): this only paints.
//
// A word matches the way the full-text index matches it — at a word start,
// case-insensitive, and the whole word is lit ("fact" lights "factory"), so
// what the note highlights is exactly why it was a search hit.

export interface SearchMatchState {
  words: readonly string[]
  matches: readonly { from: number; to: number }[]
  /** Index into `matches` of the one being looked at; -1 when none. */
  current: number
}

const EMPTY: SearchMatchState = { words: [], matches: [], current: -1 }

const setWordsEffect = StateEffect.define<readonly string[]>()
const setCurrentEffect = StateEffect.define<number>()

export const searchMatchField = StateField.define<SearchMatchState>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(setWordsEffect)) {
        const words = effect.value
        const matches = findSearchWordMatchesBlock(tr.state.doc.toString(), words)
        next = { words, matches, current: matches.length > 0 ? 0 : -1 }
      } else if (effect.is(setCurrentEffect)) {
        next = { ...next, current: effect.value }
      }
    }
    if (tr.docChanged && next.words.length > 0 && next === value) {
      const matches = findSearchWordMatchesBlock(tr.state.doc.toString(), next.words)
      next = { ...next, matches, current: Math.min(next.current, matches.length - 1) }
    }
    return next
  },
})

function markers(view: EditorView): readonly RectangleMarker[] {
  const { matches, current } = view.state.field(searchMatchField)
  if (matches.length === 0) return []
  const out: RectangleMarker[] = []
  for (const part of view.visibleRanges) {
    for (let i = 0; i < matches.length; i++) {
      const { from, to } = matches[i]
      if (to < part.from || from > part.to) continue
      const cls = i === current ? 'cm-searchMatch cm-searchMatch-current' : 'cm-searchMatch'
      out.push(...RectangleMarker.forRange(view, cls, EditorSelection.range(from, to)))
    }
  }
  return out
}

export function createSearchMatchLayerBlock(): Extension {
  return [
    searchMatchField,
    layer({
      above: false,
      class: 'cm-searchMatchLayer',
      update: (update) =>
        update.docChanged
        || update.viewportChanged
        || update.geometryChanged
        || update.startState.field(searchMatchField) !== update.state.field(searchMatchField),
      markers,
    }),
    EditorView.baseTheme({
      '.cm-searchMatchLayer .cm-searchMatch': {
        backgroundColor: 'var(--ltm-editor-search-match)',
        borderRadius: '2px',
      },
      '.cm-searchMatchLayer .cm-searchMatch-current': {
        backgroundColor: 'var(--ltm-editor-search-match-current)',
      },
    }),
  ]
}

/** Make hit `index` the current one and scroll it to the middle. */
export function focusSearchMatchBlock(view: EditorView, index: number): void {
  const match = view.state.field(searchMatchField, false)?.matches[index]
  if (!match) return
  view.dispatch({
    effects: [setCurrentEffect.of(index), EditorView.scrollIntoView(match.from, { y: 'center' })],
  })
}

/** Light up `words` in the note and bring the first hit into view. */
export function applySearchWordsBlock(view: EditorView, words: readonly string[]): void {
  const prev = view.state.field(searchMatchField, false)
  if (!prev) return
  if (prev.words.length === words.length && prev.words.every((w, i) => w === words[i])) return
  view.dispatch({ effects: setWordsEffect.of(words) })
  if (words.length > 0) focusSearchMatchBlock(view, 0)
}

/** Move to the next (+1) or previous (-1) hit, wrapping around. False when
 *  there is nothing to move to, so a keymap can let the key through. */
export function stepSearchMatchBlock(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state.field(searchMatchField, false)
  if (!state || state.matches.length === 0) return false
  focusSearchMatchBlock(view, (state.current + direction + state.matches.length) % state.matches.length)
  return true
}
