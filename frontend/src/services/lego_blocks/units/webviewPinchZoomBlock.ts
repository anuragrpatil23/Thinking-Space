/**
 * Trackpad pinch-to-zoom for a page in an Electron `<webview>`.
 *
 * The browser's own pinch zoom cannot be used here: it belongs to the
 * top-level window, and a webview is an embedded frame, so opening the
 * webview's visual-zoom range does nothing (tried 2026-10-08) and opening the
 * window's would magnify the whole app. What a pinch does deliver to the
 * embedded page is a stream of `wheel` events with `ctrlKey` set. This block
 * collects those in the page and turns them into page zoom from the app side.
 *
 * So a pinch here is page zoom — the page re-lays-out, as with the zoom
 * percentage — not a magnifier.
 */

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
// Pinch deltas arrive as a few units per event; this makes a full, unhurried
// pinch roughly double or halve the page.
const ZOOM_PER_DELTA = 0.01

/**
 * Resolves with the pinch movement gathered since the last call. Movement that
 * arrived while nobody was waiting is kept and handed over at once, so none is
 * dropped between one answer and the next question. A page that handles the
 * pinch itself (a map, a canvas) is left to it.
 */
export const WEBVIEW_PINCH_WAIT_SCRIPT_BLOCK = `(function(){
var s=window.__tsPagePinch;
if(!s){
s=window.__tsPagePinch={sum:0,waiters:[]};
window.addEventListener('wheel',function(e){
if(!e.ctrlKey||e.defaultPrevented)return;
e.preventDefault();
s.sum+=e.deltaY;
var w=s.waiters.splice(0);
if(w.length){var v=s.sum;s.sum=0;for(var i=0;i<w.length;i++)w[i](v)}
},{passive:false});
}
if(s.sum!==0){var v=s.sum;s.sum=0;return v}
return new Promise(function(resolve){s.waiters.push(resolve)});
})()`

/** The zoom factor after a pinch of `delta` (negative = fingers apart = in). */
export function nextPinchZoomFactorBlock(current: number, delta: number): number {
  if (!Number.isFinite(current) || current <= 0) return 1
  if (!Number.isFinite(delta) || delta === 0) return current
  const next = current * Math.exp(-delta * ZOOM_PER_DELTA)
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100
}

interface PinchZoomableWebviewBlock {
  executeJavaScript?: (code: string) => Promise<unknown>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/**
 * Keep a webview's zoom following trackpad pinches until the returned stop
 * function is called. Event-driven: one pending question sits in the page and
 * nothing runs between pinches.
 */
export function startWebviewPinchZoomWatchBlock(
  webview: PinchZoomableWebviewBlock,
  zoom: { get: () => number; apply: (factor: number) => void },
): () => void {
  let generation = 0
  const watch = async (mine: number) => {
    while (mine === generation) {
      const delta: unknown = await webview.executeJavaScript?.(WEBVIEW_PINCH_WAIT_SCRIPT_BLOCK)
      if (mine !== generation || typeof delta !== 'number') return
      const current = zoom.get()
      const next = nextPinchZoomFactorBlock(current, delta)
      if (next !== current) zoom.apply(next)
    }
  }
  const arm = () => {
    generation += 1
    watch(generation).catch(() => {
      // Guest not attached yet, navigated, or gone; the next load re-arms.
    })
  }
  webview.addEventListener('dom-ready', arm)
  // In case the page was already loaded when the watch started.
  arm()
  return () => {
    generation = -1
    webview.removeEventListener('dom-ready', arm)
  }
}
