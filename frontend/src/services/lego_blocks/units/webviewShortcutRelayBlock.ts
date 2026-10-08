/**
 * App shortcuts that keep working while keyboard focus is inside an Electron
 * `<webview>`.
 *
 * A webview is a separate page: once the reader clicks into it, key presses
 * go to that page and never reach the app window's own key handler. That made
 * the sidebar and header shortcuts work or not depending on where the last
 * click landed. The embedded page now watches for a short, fixed list of app
 * shortcuts and hands each press back; the app replays it on its own window,
 * so there is still exactly one place that decides what a shortcut does.
 *
 * Only the listed shortcuts are taken from the page. Presses are queued in the
 * page until asked for, so one that lands between two questions is not lost.
 */

export type WebviewRelayedShortcutBlock = 'sidebar' | 'header' | 'find'

const SHORTCUT_KEY_EVENT: Record<WebviewRelayedShortcutBlock, { key: string; code: string; shiftKey: boolean }> = {
  sidebar: { key: '\\', code: 'Backslash', shiftKey: false },
  header: { key: '|', code: 'Backslash', shiftKey: true },
  find: { key: 'f', code: 'KeyF', shiftKey: false },
}

export function buildWebviewShortcutWaitScriptBlock(shortcuts: WebviewRelayedShortcutBlock[]): string {
  const allowed = JSON.stringify(shortcuts.filter((name) => name in SHORTCUT_KEY_EVENT))
  return `(function(){
var s=window.__tsAppKeys;
if(!s){
s=window.__tsAppKeys={queue:[],waiters:[],allowed:${allowed}};
window.addEventListener('keydown',function(e){
if(e.repeat||e.altKey||!(e.metaKey||e.ctrlKey))return;
var name=null;
if(e.code==='Backslash')name=e.shiftKey?'header':'sidebar';
else if(e.code==='KeyF'&&!e.shiftKey)name='find';
if(!name||s.allowed.indexOf(name)<0)return;
e.preventDefault();
var w=s.waiters.splice(0);
if(w.length){for(var i=0;i<w.length;i++)w[i](name)}else{s.queue.push(name)}
},true);
}
if(s.queue.length)return s.queue.shift();
return new Promise(function(resolve){s.waiters.push(resolve)});
})()`
}

/** Replay a relayed shortcut as a key press on the app window. */
export function replayWebviewShortcutBlock(name: unknown, isMac: boolean): boolean {
  if (typeof name !== 'string' || !(name in SHORTCUT_KEY_EVENT)) return false
  const shape = SHORTCUT_KEY_EVENT[name as WebviewRelayedShortcutBlock]
  window.dispatchEvent(new KeyboardEvent('keydown', {
    ...shape,
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  }))
  return true
}

interface ShortcutRelayWebviewBlock {
  executeJavaScript?: (code: string) => Promise<unknown>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/**
 * Relay the given shortcuts out of this webview until the returned stop
 * function is called. One pending question sits in the page; nothing runs
 * between key presses.
 */
export function startWebviewShortcutRelayBlock(
  webview: ShortcutRelayWebviewBlock,
  shortcuts: WebviewRelayedShortcutBlock[],
): () => void {
  const script = buildWebviewShortcutWaitScriptBlock(shortcuts)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  let generation = 0
  const watch = async (mine: number) => {
    while (mine === generation) {
      const name: unknown = await webview.executeJavaScript?.(script)
      if (mine !== generation) return
      if (!replayWebviewShortcutBlock(name, isMac)) return
    }
  }
  const arm = () => {
    generation += 1
    watch(generation).catch(() => {
      // Guest not attached yet, navigated, or gone; the next load re-arms.
    })
  }
  webview.addEventListener('dom-ready', arm)
  arm()
  return () => {
    generation = -1
    webview.removeEventListener('dom-ready', arm)
  }
}
