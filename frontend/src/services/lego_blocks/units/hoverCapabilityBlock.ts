/**
 * hoverCapabilityBlock — single source of truth for "can this device truly
 * hover?". iOS/iPadOS WebKit synthesizes mouseenter on tap (and often never
 * delivers the matching mouseleave), so hover-opened overlays — tooltips,
 * hover cards — must not arm themselves on touch surfaces or they appear on
 * tap and stick until an unrelated re-render (seen: explorer summary tooltip
 * frozen mid-screen on iPad).
 *
 * `(hover: hover) and (pointer: fine)` is the canonical query: true for
 * mouse/trackpad (including iPad WITH a paired trackpad, where hover UX is
 * genuinely usable), false for bare touch. Listens for changes because iPads
 * gain/lose trackpads at runtime.
 */

const QUERY = '(hover: hover) and (pointer: fine)'

let cached: boolean | null = null

function evaluate(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(QUERY).matches
}

export function deviceCanHoverBlock(): boolean {
  if (cached === null) {
    cached = evaluate()
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        window.matchMedia(QUERY).addEventListener('change', (e) => { cached = e.matches })
      } catch {
        // Older WebKit without addEventListener on MediaQueryList — the
        // first evaluation stands for the session.
      }
    }
  }
  return cached
}
