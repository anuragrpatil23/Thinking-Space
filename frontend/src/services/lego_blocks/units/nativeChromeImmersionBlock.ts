/**
 * Immersion registry for the native iOS chrome.
 *
 * Fullscreen web overlays (Excalidraw focus mode, and any future focus
 * surfaces) render as `fixed inset-0` divs — but the native SwiftUI chrome
 * is a real native layer above the whole WKWebView, so it always covers
 * them. While any overlay holds an immersion lease, App.tsx pushes
 * `visible: false` through the top-chrome bridge and the native bar + veil
 * slide away (mirrors Electron, where focus mode owns the entire window).
 *
 * Counter-based so overlapping overlays compose: chrome returns only when
 * the last lease is released.
 */

const IMMERSION_EVENT = 'ltm-native-chrome-immersion-change'

let immersionCount = 0

function emitImmersionChange(): void {
  window.dispatchEvent(new CustomEvent(IMMERSION_EVENT))
}

/** Acquire an immersion lease; returns an idempotent release function. */
export function acquireNativeChromeImmersionBlock(): () => void {
  immersionCount += 1
  if (immersionCount === 1) emitImmersionChange()

  let released = false
  return () => {
    if (released) return
    released = true
    immersionCount = Math.max(0, immersionCount - 1)
    if (immersionCount === 0) emitImmersionChange()
  }
}

export function isNativeChromeImmersedBlock(): boolean {
  return immersionCount > 0
}

export function subscribeNativeChromeImmersionBlock(
  callback: (immersed: boolean) => void,
): () => void {
  const handler = () => callback(immersionCount > 0)
  window.addEventListener(IMMERSION_EVENT, handler)
  return () => window.removeEventListener(IMMERSION_EVENT, handler)
}
