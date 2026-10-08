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
 * The app answers a flip by hiding or showing its header, which resizes the
 * page from its top edge. Left alone, everything on the page would jump by
 * the header's height. So the resize that follows a flip is met with an equal
 * scroll in the same frame: the content stays where it is on screen and the
 * header simply uncovers, or covers, the strip above it. This is also why the
 * header is not animated — an animated resize would re-lay-out the page on
 * every frame of it, which is what made scrolling stutter.
 *
 * Hiding waits until the reader is past the header's height, so that scroll
 * can always be made in full and never strands the page at the top with the
 * header gone. Arriving at the very top is the one flip left unmatched: the
 * page should stay at the top, not be nudged back down under the header.
 */
export const HTML_PAGE_CHROME_HIDDEN_WAIT_SCRIPT_BLOCK = `(function(){
var s=window.__tsPageScroll;
if(!s){
s=window.__tsPageScroll={hidden:false,last:window.scrollY,height:window.innerHeight,flipUntil:0,quietUntil:0,waiters:[]};
var set=function(h,keep){if(s.hidden===h)return;s.hidden=h;s.flipUntil=keep?performance.now()+600:0;var w=s.waiters.splice(0);for(var i=0;i<w.length;i++)w[i](h)};
window.addEventListener('resize',function(){var now=performance.now();var grew=window.innerHeight-s.height;s.height=window.innerHeight;if(grew!==0&&now<s.flipUntil){s.flipUntil=0;window.scrollBy({top:-grew,left:0,behavior:'instant'})}s.quietUntil=now+150;s.last=window.scrollY});
window.addEventListener('scroll',function(){var top=window.scrollY;if(performance.now()<s.quietUntil){s.last=top;return}var d=top-s.last;if(top>4&&Math.abs(d)<4)return;s.last=top;if(top<=4)set(false,false);else if(d<0)set(false,true);else if(top>240)set(true,true)},{passive:true});
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
 * The app's scrollbar manners, for the page: slim, and drawn only while the
 * pointer is over the page. Without it the webview shows the system scrollbar
 * — a permanent full-width track when macOS always shows scroll bars — which
 * no other document in the app has.
 *
 * Standard properties on purpose, not `::-webkit-scrollbar`: a custom-drawn
 * scrollbar is painted by the page's main thread on every scroll frame, while
 * these keep the browser's own scrollbar, which scrolls off that thread. The
 * thumb is a mid grey because the page's theme is unknown.
 */
export const HTML_PAGE_SCROLLBAR_CSS_BLOCK = `
html{scrollbar-width:thin;scrollbar-color:transparent transparent}
html:hover{scrollbar-color:rgb(150 150 150 / 0.55) transparent}
`
