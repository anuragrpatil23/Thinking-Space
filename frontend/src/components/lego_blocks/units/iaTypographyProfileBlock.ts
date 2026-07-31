import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

// Focus typography profile — the iA-Writer-style writing surface used by the
// New Note tab. Deliberately a *per-instance profile*, not a global setting:
// the explorer editor keeps reading `markdownEditorSettingsBlock` and must not
// shift when this changes. (Editor contract: "per-profile decoration routing".)
//
// Font note: iA's own Mono/Duo/Quattro files ship with no LICENSE and a README
// that forbids themes imitating their products, so we do NOT bundle them. IBM
// Plex Mono is what those faces were modified *from* and is OFL-1.1, so it is
// both the legitimate and the closest-available choice.
//
// These CSS imports must stay in this module (or another module only reachable
// from `MarkdownRichEditorBlock`) so Vite keeps the @font-face rules inside the
// lazy editor chunk. Importing them from `index.css` would put a webfont on the
// startup path — see docs/contracts/STARTUP-PERFORMANCE.md.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/600-italic.css'

export type EditorTypographyProfileBlock = 'default' | 'focus'

export const FOCUS_FONT_STACK_BLOCK =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

/** Measure cap. ~66 characters is the classic prose measure and lands close to
 *  iA Writer's default column at its default size. */
const FOCUS_MEASURE_BLOCK = '66ch'

export interface FocusTypographyOptionsBlock {
  /** Phone/compact surfaces drop the measure cap and shrink the padding —
   *  a 66ch column inside a 390px viewport reads as a narrow ribbon. */
  compact?: boolean
  /** Bottom padding reserved for the on-screen keyboard (iOS). Keeps the caret
   *  clear of the keyboard on the full-bleed surface. */
  keyboardInsetPx?: number
}

/** CM6 theme for the focus profile. Pairs with the `'dim'` marker mode in
 *  `markdownSyntaxHidingExtensionBlock` — together they are the iA look. */
export function createFocusTypographyThemeBlock(
  options: FocusTypographyOptionsBlock = {},
): Extension {
  const compact = options.compact ?? false
  const keyboardInsetPx = Math.max(0, options.keyboardInsetPx ?? 0)

  return EditorView.theme({
    '.cm-scroller': {
      fontFamily: FOCUS_FONT_STACK_BLOCK,
      fontSize: compact ? '16px' : '17px',
      lineHeight: '1.8',
      // Plex Mono's default figures are fine, but disabling ligatures keeps
      // `->` and `!=` from fusing mid-sentence in prose.
      fontVariantLigatures: 'none',
    },
    '.cm-content': {
      maxWidth: compact ? '100%' : FOCUS_MEASURE_BLOCK,
      marginInline: 'auto',
      padding: compact
        ? `2rem 1.25rem ${1.5 + keyboardInsetPx / 16}rem`
        : `4rem 0 ${8 + keyboardInsetPx / 16}rem`,
    },
    // Thicker, iA-style caret in the user's own accent — `--ltm-explorer-selected-color`
    // is the "Selected item color" from Settings → Explorer, already published
    // on documentElement by App.tsx, so this needs no new plumbing and the
    // caret matches the highlight they picked.
    //
    // The transition is the "glide": CM6 positions the caret with inline
    // left/top, so animating those makes it slide between characters the way
    // iA Writer's does instead of teleporting. Horizontal is quicker than
    // vertical — a line change should feel like a step, not a swoop.
    '.cm-cursor, .cm-dropCursor': {
      borderLeftWidth: '2px',
      borderLeftColor: 'var(--ltm-explorer-selected-color, hsl(var(--primary)))',
      transition: 'left 70ms cubic-bezier(0.22, 1, 0.36, 1), top 110ms cubic-bezier(0.22, 1, 0.36, 1)',
    },
    // CM6's stock blink is a hard `steps(1)` on/off. iA's fades. Own keyframe
    // name, not an override of `cm-blink`: keyframes are global, and stomping
    // CM's would change every other editor in the app too.
    '@keyframes ltm-ia-caret-blink': {
      '0%, 45%': { opacity: '1' },
      '55%, 95%': { opacity: '0' },
      '100%': { opacity: '1' },
    },
    '&.cm-focused .cm-cursor': {
      animation: 'ltm-ia-caret-blink 1.15s ease-in-out infinite',
    },
    // Respect the OS setting — a gliding, pulsing caret is exactly the kind of
    // motion people turn this on to avoid.
    '@media (prefers-reduced-motion: reduce)': {
      '.cm-cursor, .cm-dropCursor': { transition: 'none' },
      '&.cm-focused .cm-cursor': { animation: 'none' },
    },
    '.cm-line': {
      padding: '0',
    },
  })
}
