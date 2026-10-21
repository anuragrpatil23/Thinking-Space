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
 * `flush` drops the inset entirely, for a page that runs under the status bar
 * and clears it itself: the RSS reels deck, whose cards are full-screen photos
 * (the reserved strip read as a white bar above them). New Note gets the same
 * treatment from its route instead. Dropping it here instead was tried and reverted
 * (2026-08-02): the doc header auto-hides on scroll, and with no inset the
 * Contents/Mindmap bar then stuck under the clock.
 *
 * Why an event and not a class the shell probes for: routes and document panes
 * stay mounted behind `hidden` / `visibility: hidden` when you switch tabs, and
 * `:has()` has no notion of visibility — a `:has(.ltm-page-flush-top)` probe
 * latched on for every other tab once one such page had been opened
 * (2026-08-02).
 *
 * Each page holds a CLAIM and releases it when it goes inactive or unmounts
 * (an effect cleanup). It used to be one last-writer-wins value, and a
 * document pane going inactive reported `default` over the reels deck that
 * was still on screen, dropping it out of full-screen mid-read (2026-10-21).
 * With claims, `flush` wins over `paper`, which wins over nothing.
 *
 * Same window-event pattern as `topChromeAppearanceBlock`; kept separate so the
 * two signals can never clobber each other's field.
 */

export const PAGE_TOP_INSET_EVENT_BLOCK = 'ltm-page-top-inset'

export type PageTopInsetModeBlock = 'default' | 'paper' | 'flush'

export interface PageTopInsetStateBlock {
  mode: PageTopInsetModeBlock
}

const claims = new Map<symbol, PageTopInsetModeBlock>()
let lastState: PageTopInsetStateBlock = { mode: 'default' }

function publishBlock(): void {
  const modes = new Set(claims.values())
  const mode: PageTopInsetModeBlock = modes.has('flush') ? 'flush' : modes.has('paper') ? 'paper' : 'default'
  if (mode === lastState.mode) return
  lastState = { mode }
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PAGE_TOP_INSET_EVENT_BLOCK, { detail: lastState }))
}

/** Ask for a top-inset mode while active; call the result to release it. */
export function claimPageTopInsetBlock(mode: PageTopInsetModeBlock): () => void {
  const id = Symbol('page-top-inset')
  claims.set(id, mode)
  publishBlock()
  return () => {
    claims.delete(id)
    publishBlock()
  }
}

/** Snapshot for subscribers that mount after the page already dispatched. */
export function getPageTopInsetBlock(): PageTopInsetStateBlock {
  return lastState
}
