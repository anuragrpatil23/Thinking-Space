/**
 * What the app asks of an HTML page running in its webview: its outline, a
 * jump to one heading, and whether the reader has scrolled away from the top.
 * The page is a separate, untrusted WebContents with no preload, so these are
 * plain scripts run in it and answered by return value — nothing here gives
 * the page a channel back into the app.
 */

export interface HtmlPageHeadingBlock {
  level: number
  title: string
}

// One definition of "the page's headings", shared by the outline and the jump
// so index N means the same element in both.
const HEADINGS_EXPRESSION =
  "Array.from(document.querySelectorAll('h1,h2,h3')).filter(function(h){return h.getClientRects().length>0&&(h.textContent||'').trim()})"

export const HTML_PAGE_OUTLINE_SCRIPT_BLOCK =
  `${HEADINGS_EXPRESSION}.map(function(h){return{level:Number(h.tagName.charAt(1)),title:(h.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160)}})`

export function buildHtmlPageScrollToHeadingScriptBlock(index: number): string {
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0))
  return `(function(){var h=${HEADINGS_EXPRESSION}[${safeIndex}];if(h)h.scrollIntoView({behavior:'smooth',block:'start'})})()`
}

/**
 * Resolves the next time the page's "chrome should hide" state flips: true
 * once the reader scrolls down, false on scrolling back up or reaching the
 * top (the markdown reader's rule). The caller awaits it and asks again — an
 * event-driven long poll, so nothing runs while the page sits still.
 *
 * Hiding the app header resizes the page, which can clamp its scroll position
 * and look like a scroll in the other direction; scroll events just after a
 * resize are therefore ignored, or the header would flicker at the page end.
 */
export const HTML_PAGE_CHROME_HIDDEN_WAIT_SCRIPT_BLOCK = `(function(){
var s=window.__tsPageScroll;
if(!s){
s=window.__tsPageScroll={hidden:false,last:window.scrollY,quietUntil:0,waiters:[]};
var set=function(h){if(s.hidden===h)return;s.hidden=h;var w=s.waiters.splice(0);for(var i=0;i<w.length;i++)w[i](h)};
window.addEventListener('resize',function(){s.quietUntil=performance.now()+300;s.last=window.scrollY});
window.addEventListener('scroll',function(){var top=window.scrollY;if(performance.now()<s.quietUntil){s.last=top;return}var d=top-s.last;if(top>4&&Math.abs(d)<4)return;s.last=top;set(top>4&&d>0)},{passive:true});
}
return new Promise(function(resolve){s.waiters.push(resolve)});
})()`

export function parseHtmlPageHeadingsBlock(value: unknown): HtmlPageHeadingBlock[] {
  if (!Array.isArray(value)) return []
  const headings: HtmlPageHeadingBlock[] = []
  for (const entry of value.slice(0, 500)) {
    const record = entry as { level?: unknown; title?: unknown } | null
    const level = Number(record?.level)
    const title = typeof record?.title === 'string' ? record.title.replace(/\s+/g, ' ').trim() : ''
    if (!title || !(level >= 1 && level <= 3)) continue
    headings.push({ level, title })
  }
  return headings
}

/** The page's outline as markdown headings, one per line, so the markdown
 *  Contents control can show it unchanged. */
export function buildHtmlPageOutlineMarkdownBlock(headings: HtmlPageHeadingBlock[]): string {
  return headings.map((heading) => `${'#'.repeat(heading.level)} ${heading.title}`).join('\n')
}

/**
 * The app's own scrollbar, for the page: a slim thumb that only shows while
 * the pointer is over the page. Without it the webview draws the system
 * scrollbar — a permanent, full-width track down the side when macOS is set
 * to always show scroll bars — which no other document in the app has.
 * Mirrors `.ltm-app-shell *::-webkit-scrollbar` in index.css; the thumb is a
 * mid grey because the page's theme is unknown.
 */
export const HTML_PAGE_SCROLLBAR_CSS_BLOCK = `
::-webkit-scrollbar{width:10px;height:10px;background:transparent}
::-webkit-scrollbar-track{background:transparent;border:0;box-shadow:none}
::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background-color:transparent;border:2px solid transparent;border-radius:999px;background-clip:padding-box}
:hover::-webkit-scrollbar-thumb{background-color:rgb(150 150 150 / 0.55)}
`
