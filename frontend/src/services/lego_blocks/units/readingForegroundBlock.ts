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

type Listener = () => void

const stack: symbol[] = []
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
export function claimReadingForegroundBlock(token: symbol): () => void {
  const existing = stack.indexOf(token)
  if (existing !== -1) stack.splice(existing, 1)
  stack.push(token)
  notify()
  return () => {
    const at = stack.indexOf(token)
    if (at === -1) return
    stack.splice(at, 1)
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
  listeners.clear()
}
