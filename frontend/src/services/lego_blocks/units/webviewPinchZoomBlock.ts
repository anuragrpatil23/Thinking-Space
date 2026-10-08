/**
 * Trackpad pinch as a magnifier for a page in an Electron `<webview>`.
 *
 * The browser's own pinch zoom cannot be used: it belongs to the top-level
 * window, and a webview is an embedded frame, so opening the webview's
 * visual-zoom range does nothing (tried 2026-10-08) and opening the window's
 * would magnify the whole app. What a pinch does deliver to the embedded page
 * is a stream of `wheel` events with `ctrlKey` set.
 *
 * So the magnifier is made inside the page: the root element is scaled with a
 * CSS transform, which enlarges what is drawn without re-laying-out anything
 * (page zoom, by contrast, narrows the layout and re-wraps the text), and the
 * page is scrolled in the same step so the point under the fingers stays
 * under them. Pinching back to 1x removes the transform entirely.
 *
 * Known cost: while magnified, `position: fixed` elements scroll with the
 * page, because a transformed root becomes their containing block.
 *
 * A page that handles the pinch itself (a map, a canvas) is left to it. The
 * app's header-hide watch (`__tsPageScroll`) is told to ignore the scrolling a
 * pinch causes, or the header would flap while magnifying.
 */
export const WEBVIEW_MAGNIFY_SCRIPT_BLOCK = `(function(){
if(window.__tsMagnify)return;
var m=window.__tsMagnify={scale:1};
var root=document.documentElement;
window.addEventListener('wheel',function(e){
if(!e.ctrlKey||e.defaultPrevented)return;
e.preventDefault();
var prev=m.scale;
var next=Math.min(5,Math.max(1,prev*Math.exp(-e.deltaY*0.01)));
if(next<1.02&&e.deltaY>0)next=1;
if(next===prev)return;
var docX=(window.scrollX+e.clientX)/prev,docY=(window.scrollY+e.clientY)/prev;
m.scale=next;
if(next===1){root.style.transform='';root.style.transformOrigin=''}
else{root.style.transformOrigin='0 0';root.style.transform='scale('+next+')'}
var ps=window.__tsPageScroll;
if(ps)ps.quietUntil=performance.now()+400;
window.scrollTo({left:docX*next-e.clientX,top:docY*next-e.clientY,behavior:'instant'});
if(ps)ps.last=window.scrollY;
},{passive:false});
})()`

interface MagnifiableWebviewBlock {
  executeJavaScript?: (code: string) => Promise<unknown>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/**
 * Give every page this webview loads the pinch magnifier, until the returned
 * stop function is called. Nothing runs between pinches: the page only reacts
 * to its own wheel events.
 */
export function startWebviewMagnifierBlock(webview: MagnifiableWebviewBlock): () => void {
  const install = () => {
    try {
      webview.executeJavaScript?.(WEBVIEW_MAGNIFY_SCRIPT_BLOCK)?.catch(() => { /* guest went away */ })
    } catch {
      // Guest not attached yet; dom-ready will install it.
    }
  }
  webview.addEventListener('dom-ready', install)
  // In case the page was already loaded when this started.
  install()
  return () => webview.removeEventListener('dom-ready', install)
}
