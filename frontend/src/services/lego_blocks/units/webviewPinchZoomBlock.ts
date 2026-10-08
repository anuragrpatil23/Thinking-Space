/**
 * Trackpad pinch-to-zoom for a page in an Electron `<webview>`. Electron ships
 * with it off; a page becomes pinchable once its visual zoom range is opened.
 *
 * This is the browser's "magnify" zoom — it scales what is on screen without
 * re-laying-out the page, and is separate from the page-zoom percentage.
 * Call it from the webview's `dom-ready`; before that the guest isn't attached
 * and the call throws, which is swallowed here.
 */
const MIN_VISUAL_ZOOM = 1
const MAX_VISUAL_ZOOM = 5

interface PinchZoomableWebviewBlock {
  setVisualZoomLevelLimits?: (minimumLevel: number, maximumLevel: number) => Promise<void> | void
}

export function enableWebviewPinchZoomBlock(webview: PinchZoomableWebviewBlock | null | undefined): void {
  try {
    const result = webview?.setVisualZoomLevelLimits?.(MIN_VISUAL_ZOOM, MAX_VISUAL_ZOOM)
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => { /* guest went away */ })
    }
  } catch {
    // Guest not attached yet, or already gone.
  }
}
