/**
 * topChromeAppearanceBlock — lets a page surface tell the native iPhone shell
 * that the area under the status bar is currently dark (e.g. Home's night
 * time-of-day backdrop), so the native status-bar glyphs and the progressive
 * top scrim can flip to their dark appearance instead of rendering a light
 * frosted band over a dark canvas.
 *
 * Same window-event pattern as the sidebar chrome blocks: the page dispatches,
 * App.tsx subscribes and forwards through the TopChrome plugin state push.
 */

export const TOP_CHROME_APPEARANCE_EVENT_BLOCK = 'ltm-top-chrome-appearance'

export interface TopChromeAppearanceStateBlock {
  /** True when the content under the status bar is dark. */
  dark: boolean
}

let lastState: TopChromeAppearanceStateBlock = { dark: false }

export function dispatchTopChromeAppearanceBlock(state: TopChromeAppearanceStateBlock): void {
  lastState = state
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOP_CHROME_APPEARANCE_EVENT_BLOCK, { detail: state }))
}

/** Snapshot for subscribers that mount after the page already dispatched. */
export function getTopChromeAppearanceBlock(): TopChromeAppearanceStateBlock {
  return lastState
}
