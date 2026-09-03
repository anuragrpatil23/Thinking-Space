/* Scroll-direction state machine for auto-hiding reader chrome.

   Pure so the thresholds are testable without a scroll container. The rules
   exist because the naive version — "hide on any downward delta" — makes the
   toolbar flicker on the small upward corrections that happen constantly while
   reading, and hides the toolbar the instant you nudge a document that is
   barely taller than the viewport.

   Rules:
   - Near the top, chrome is always visible. You have not started reading yet,
     and that is where the controls are expected to be.
   - Direction changes must accumulate past a threshold before they count, so
     jitter and rubber-band overscroll do not toggle anything.
   - A document that cannot scroll meaningfully never hides its chrome. */

export type ReaderScrollDirectionBlock = 'none' | 'up' | 'down'

export interface ReaderChromeStateBlock {
  visible: boolean
  /** Scroll offset the current directional run is measured from. */
  anchorScrollTop: number
  lastScrollTop: number
  /** Direction of the run in progress, so a reversal can re-anchor. */
  direction: ReaderScrollDirectionBlock
}

export const READER_CHROME_TOP_ZONE_PX_BLOCK = 64
export const READER_CHROME_HIDE_THRESHOLD_PX_BLOCK = 48
export const READER_CHROME_SHOW_THRESHOLD_PX_BLOCK = 24
/* Below this much scrollable overflow, hiding chrome buys nothing and just
   makes the controls feel unreliable. */
export const READER_CHROME_MIN_OVERFLOW_PX_BLOCK = 240

export function createReaderChromeStateBlock(): ReaderChromeStateBlock {
  return { visible: true, anchorScrollTop: 0, lastScrollTop: 0, direction: 'none' }
}

export function advanceReaderChromeStateBlock(
  state: ReaderChromeStateBlock,
  input: { scrollTop: number; scrollHeight: number; clientHeight: number },
): ReaderChromeStateBlock {
  const scrollTop = Math.max(0, input.scrollTop)
  const overflow = input.scrollHeight - input.clientHeight

  if (overflow < READER_CHROME_MIN_OVERFLOW_PX_BLOCK) {
    return { visible: true, anchorScrollTop: scrollTop, lastScrollTop: scrollTop, direction: 'none' }
  }

  if (scrollTop <= READER_CHROME_TOP_ZONE_PX_BLOCK) {
    return { visible: true, anchorScrollTop: scrollTop, lastScrollTop: scrollTop, direction: 'none' }
  }

  if (scrollTop === state.lastScrollTop) return state

  const direction: ReaderScrollDirectionBlock = scrollTop > state.lastScrollTop ? 'down' : 'up'

  /* Re-anchor on a reversal, so the threshold measures the run the reader is
     actually in rather than the whole distance since the last commit. Without
     this, scrolling a long way down and then flicking back up would reveal the
     chrome only after an equally long upward scroll. */
  const anchorScrollTop = direction === state.direction ? state.anchorScrollTop : state.lastScrollTop
  const travel = scrollTop - anchorScrollTop

  if (state.visible && direction === 'down' && travel >= READER_CHROME_HIDE_THRESHOLD_PX_BLOCK) {
    return { visible: false, anchorScrollTop: scrollTop, lastScrollTop: scrollTop, direction }
  }
  if (!state.visible && direction === 'up' && -travel >= READER_CHROME_SHOW_THRESHOLD_PX_BLOCK) {
    return { visible: true, anchorScrollTop: scrollTop, lastScrollTop: scrollTop, direction }
  }

  return { ...state, anchorScrollTop, lastScrollTop: scrollTop, direction }
}
