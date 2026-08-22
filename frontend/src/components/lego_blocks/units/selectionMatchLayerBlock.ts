import { EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, RectangleMarker, layer } from '@codemirror/view'
import { SearchCursor } from '@codemirror/search'

// Selection-match highlighting drawn as a *layer*, not as decorations.
//
// `highlightSelectionMatches()` from @codemirror/search marks each match with
// `Decoration.mark`, which splits the line's single text node into several
// `<span>`s. The browser shapes and sub-pixel-positions each inline box from
// its own rounded origin, so a line that was one run before the selection is
// re-laid-out as three or five afterwards and every glyph past the first match
// slides a fraction of a pixel. Selecting a word made the paragraph twitch —
// worst in the New Note focus profile, where a 17px monospace measure makes the
// jitter easy to see (2026-08-21).
//
// A layer never touches the text DOM: it draws absolutely-positioned rectangles
// underneath, exactly the way `drawSelection` draws the selection itself. Same
// look, zero reflow. Colour and semantics are kept identical to the built-in so
// this is a pure no-shift swap — pair it with `highlightSelectionMatches: false`
// in `basicSetup`.

/** Mirrors @codemirror/search's own defaults for the options we relied on:
 *  no word-around-cursor, any selection of 1..200 chars, at most 100 matches. */
const MIN_SELECTION_LENGTH_BLOCK = 1
const MAX_SELECTION_LENGTH_BLOCK = 200
const MAX_MATCHES_BLOCK = 100

function selectionMatchMarkersBlock(view: EditorView): readonly RectangleMarker[] {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length > 1) return []

  const range = sel.main
  if (range.empty) return []
  const len = range.to - range.from
  if (len < MIN_SELECTION_LENGTH_BLOCK || len > MAX_SELECTION_LENGTH_BLOCK) return []

  const query = state.sliceDoc(range.from, range.to)
  if (!query) return []

  const markers: RectangleMarker[] = []
  for (const part of view.visibleRanges) {
    const cursor = new SearchCursor(state.doc, query, part.from, part.to)
    while (!cursor.next().done) {
      const { from, to } = cursor.value
      // The selection itself is already painted by the selection layer.
      if (from < range.to && to > range.from) continue
      markers.push(
        ...RectangleMarker.forRange(view, 'cm-selectionMatch', EditorSelection.range(from, to)),
      )
      if (markers.length > MAX_MATCHES_BLOCK) return []
    }
  }
  return markers
}

/** Layer + its base theme. The colour is @codemirror/search's own, kept so the
 *  swap is invisible apart from the text no longer moving. */
export function createSelectionMatchLayerBlock(): Extension {
  return [
    layer({
      above: false,
      class: 'cm-selectionMatchLayer',
      update: (update) =>
        update.docChanged
        || update.selectionSet
        || update.viewportChanged
        || update.geometryChanged,
      markers: selectionMatchMarkersBlock,
    }),
    EditorView.baseTheme({
      // A match is a *quieter* echo of the selection, not a peer of it: a faint
      // wash of the same accent plus a hairline underline. CodeMirror's default
      // `#99ff7780` was a saturated lime that had no relationship to anything
      // else on screen and drew the eye harder than the selection it was
      // echoing. Tokens live in index.css so both tints follow the accent the
      // user picked in Settings.
      //
      // The underline is the part that does the work. Fill alone at a low
      // enough alpha to stay calm is nearly invisible on a light ground; the
      // edge keeps a match findable while the fill stays out of the way.
      '.cm-selectionMatchLayer .cm-selectionMatch': {
        backgroundColor: 'var(--ltm-editor-match)',
        // Inset shadow rather than `border-bottom`: `.cm-layer > *` has no
        // `box-sizing` override, so it is content-box, and `RectangleMarker`
        // writes the measured width/height as inline styles. A real border
        // would add its 1px on top of that height and push every rectangle a
        // pixel past the text it is marking.
        boxShadow: 'inset 0 -1px 0 var(--ltm-editor-match-edge)',
        // Layer rectangles are their own boxes, so the softening the span
        // version could never have is free here.
        borderRadius: '2px',
      },
    }),
  ]
}
