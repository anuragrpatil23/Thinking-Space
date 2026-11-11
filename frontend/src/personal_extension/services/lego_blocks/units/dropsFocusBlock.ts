// "Show this company in Drops": the company page asks, the F9 page switches to
// Feed → Drops, and Drops scrolls to that company's row and marks it. The ask
// is kept until Drops takes it, since Drops may not be on screen yet.

export const DROPS_FOCUS_EVENT_BLOCK = 'ltm:f9-drops-focus'

let pending: string | null = null

export function openInDropsBlock(ticker: string): void {
  pending = ticker.toUpperCase()
  window.dispatchEvent(new CustomEvent<string>(DROPS_FOCUS_EVENT_BLOCK, { detail: pending }))
}

/** The company asked for, once: taking it clears it. */
export function takeDropsFocusBlock(): string | null {
  const ticker = pending
  pending = null
  return ticker
}

/** Whether an ask is waiting, without taking it. */
export const dropsFocusPendingBlock = () => pending !== null
