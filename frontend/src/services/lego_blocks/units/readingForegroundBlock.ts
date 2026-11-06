// Which single document is being read, app-wide.
//
// Attention is exclusive in a way a wake lock is not. `screenWakeLockBlock`
// counts leases because two readers both wanting the screen on is not a
// contradiction — the screen is either awake or it isn't. But two documents
// both claiming the same minute of a person's attention *is* a contradiction,
// and the events that drive crediting are dispatched on `document`, so every
// mounted reader sees every one of them.
//
// That is not hypothetical. MarkdownViewerOrch is a global provider mounted in
// main.tsx and opened from the backlog, the vault graph, ClickablePathBlock and
// the todo panel. It renders as a fixed overlay above whatever route is
// showing, and the workspace document underneath still has `active` true — it
// has no idea it was covered. Without an arbiter, opening a wikilink over an
// open document credits both for the same reading.
//
// A stack rather than a slot, because the overlay case is strictly nested:
// closing the slide-over must hand attention back to the document it covered,
// not drop it on the floor.

//
// A *fallback* claim is a whole area of the app (the F9 tab) that counts as
// work when nothing more specific inside it is open. It always sits beneath
// every ordinary claim, whatever order they arrive in. Order cannot decide it:
// React runs a child's effects before its parent's, so an area mounted in the
// same commit as a page inside it would claim last and take that page's time.

type Listener = () => void

export interface ReadingForegroundClaimOptionsBlock {
  /** Hold foreground only while no ordinary claim exists. */
  fallback?: boolean
}

const stack: symbol[] = []
const fallbacks = new Set<symbol>()
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One bad subscriber must not strand the others.
    }
  }
}

/**
 * Claim foreground for `token`. Returns a release function; releasing hands
 * foreground back to whoever was underneath. Claiming twice with the same
 * token moves it to the top rather than stacking it, so a re-render cannot
 * inflate the stack.
 */
export function claimReadingForegroundBlock(
  token: symbol,
  options: ReadingForegroundClaimOptionsBlock = {},
): () => void {
  const existing = stack.indexOf(token)
  if (existing !== -1) stack.splice(existing, 1)
  fallbacks.delete(token)
  if (options.fallback) {
    // Fallbacks occupy the bottom of the stack, newest on top of them.
    let at = 0
    while (at < stack.length && fallbacks.has(stack[at])) at += 1
    stack.splice(at, 0, token)
    fallbacks.add(token)
  } else {
    stack.push(token)
  }
  notify()
  return () => {
    const at = stack.indexOf(token)
    if (at === -1) return
    stack.splice(at, 1)
    fallbacks.delete(token)
    notify()
  }
}

/** Whether `token` currently holds foreground. */
export function isReadingForegroundBlock(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token
}

export function subscribeReadingForegroundBlock(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test seam — the stack is module state and would otherwise leak between cases. */
export function resetReadingForegroundBlock(): void {
  stack.length = 0
  fallbacks.clear()
  listeners.clear()
}
