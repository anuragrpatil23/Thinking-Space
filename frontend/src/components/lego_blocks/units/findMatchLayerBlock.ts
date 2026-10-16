import { StateEffect, StateField, EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, RectangleMarker, layer } from '@codemirror/view'
import {
  findNoteMatchesBlock,
  sameNoteFindQueryBlock,
  type NoteFindQuery,
} from '@/services/lego_blocks/units/searchHighlightTermsBlock'

// Find-in-note matches in edit mode (vault-search words or ⌘F text), drawn as
// a *layer* — rectangles underneath the text, never `Decoration.mark` spans,
// for the same reason as selectionMatchLayerBlock: splitting a line's text
// node into spans makes the browser re-shape it and the paragraph twitches.
// Markdown on disk is never touched (Editor contract): this only paints. The
// rendered view paints the same matches with useNoteFindInViewBlock.

export interface FindMatchState {
  query: NoteFindQuery | null
  matches: readonly { from: number; to: number }[]
  /** Index into `matches` of the one being looked at; -1 when none. */
  current: number
}

const EMPTY: FindMatchState = { query: null, matches: [], current: -1 }

const setQueryEffect = StateEffect.define<NoteFindQuery | null>()
const setCurrentEffect = StateEffect.define<number>()

export const findMatchField = StateField.define<FindMatchState>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(setQueryEffect)) {
        const query = effect.value
        const matches = findNoteMatchesBlock(tr.state.doc.toString(), query)
        next = { query, matches, current: matches.length > 0 ? 0 : -1 }
      } else if (effect.is(setCurrentEffect)) {
        next = { ...next, current: effect.value }
      }
    }
    if (tr.docChanged && next.query && next === value) {
      const matches = findNoteMatchesBlock(tr.state.doc.toString(), next.query)
      next = { ...next, matches, current: Math.min(Math.max(next.current, 0), matches.length - 1) }
    }
    return next
  },
})

function markers(view: EditorView): readonly RectangleMarker[] {
  const { matches, current } = view.state.field(findMatchField)
  if (matches.length === 0) return []
  const out: RectangleMarker[] = []
  for (const part of view.visibleRanges) {
    for (let i = 0; i < matches.length; i++) {
      const { from, to } = matches[i]
      if (to < part.from || from > part.to) continue
      const cls = i === current ? 'cm-findMatch cm-findMatch-current' : 'cm-findMatch'
      out.push(...RectangleMarker.forRange(view, cls, EditorSelection.range(from, to)))
    }
  }
  return out
}

export function createFindMatchLayerBlock(): Extension {
  return [
    findMatchField,
    layer({
      above: false,
      class: 'cm-findMatchLayer',
      update: (update) =>
        update.docChanged
        || update.viewportChanged
        || update.geometryChanged
        || update.startState.field(findMatchField) !== update.state.field(findMatchField),
      markers,
    }),
    EditorView.baseTheme({
      '.cm-findMatchLayer .cm-findMatch': {
        backgroundColor: 'var(--ltm-find-match)',
        borderRadius: '2px',
      },
      '.cm-findMatchLayer .cm-findMatch-current': {
        backgroundColor: 'var(--ltm-find-match-current)',
      },
    }),
  ]
}

/** Make match `index` the current one and scroll it to the middle. */
export function focusFindMatchBlock(view: EditorView, index: number): void {
  const match = view.state.field(findMatchField, false)?.matches[index]
  if (!match) return
  view.dispatch({
    effects: [setCurrentEffect.of(index), EditorView.scrollIntoView(match.from, { y: 'center' })],
  })
}

/** Light up `query` in the note and bring the first match into view. */
export function applyFindQueryBlock(view: EditorView, query: NoteFindQuery | null): void {
  const prev = view.state.field(findMatchField, false)
  if (!prev || sameNoteFindQueryBlock(prev.query, query)) return
  view.dispatch({ effects: setQueryEffect.of(query) })
  if (query) focusFindMatchBlock(view, 0)
}

/** Move to the next (+1) or previous (-1) match, wrapping around. False when
 *  there is nothing to move to, so a keymap can let the key through. */
export function stepFindMatchBlock(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state.field(findMatchField, false)
  if (!state || state.matches.length === 0) return false
  focusFindMatchBlock(view, (state.current + direction + state.matches.length) % state.matches.length)
  return true
}
