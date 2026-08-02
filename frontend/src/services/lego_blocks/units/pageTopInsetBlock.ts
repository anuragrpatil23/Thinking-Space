/**
 * pageTopInsetBlock — lets a page surface tell the shell how the reserved strip
 * under the status bar should look on the iPhone (`.ltm-app-main` padding-top
 * in index.css).
 *
 * `paper` keeps the inset — the sticky bars inside the page still need
 * something to park against — but paints it card-white, for pages that are one
 * sheet of paper from the top edge down (the document viewer). Without it the
 * strip inherits the shell's grey and reads as a seam above the document.
 *
 * Distinct from New Note's `flush`, which drops the inset entirely because that
 * page paints its own strip. Dropping it here instead was tried and reverted
 * (2026-08-02): the doc header auto-hides on scroll, and with no inset the
 * Contents/Mindmap bar then stuck under the clock.
 *
 * Why an event and not a class the shell probes for: routes and document panes
 * stay mounted behind `hidden` / `visibility: hidden` when you switch tabs, and
 * `:has()` has no notion of visibility — a `:has(.ltm-page-flush-top)` probe
 * latched on for every other tab once one such page had been opened
 * (2026-08-02). Publishers must therefore report `default` when they go
 * inactive or unmount, which is exactly what an effect cleanup does.
 *
 * Same window-event pattern as `topChromeAppearanceBlock`; kept separate so the
 * two signals can never clobber each other's field.
 */

export const PAGE_TOP_INSET_EVENT_BLOCK = 'ltm-page-top-inset'

export type PageTopInsetModeBlock = 'default' | 'paper'

export interface PageTopInsetStateBlock {
  mode: PageTopInsetModeBlock
}

let lastState: PageTopInsetStateBlock = { mode: 'default' }

export function dispatchPageTopInsetBlock(state: PageTopInsetStateBlock): void {
  lastState = state
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PAGE_TOP_INSET_EVENT_BLOCK, { detail: state }))
}

/** Snapshot for subscribers that mount after the page already dispatched. */
export function getPageTopInsetBlock(): PageTopInsetStateBlock {
  return lastState
}
