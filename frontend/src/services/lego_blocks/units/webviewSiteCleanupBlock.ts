// Reading a page in the in-app browser: some sites cover the article with
// their own boxes (donation banners, sign-in gates, pop-up messages). For the
// sites listed here, a little CSS hides those boxes once the page is ready.
// Only what covers or interrupts the article; nothing the article needs.
// Element names checked on the live pages (The Guardian, 2026-10-23).

const SITE_CLEANUP_CSS_BLOCK: Array<{ hosts: string[]; css: string }> = [
  {
    hosts: ['theguardian.com'],
    css: [
      'gu-island[name="StickyBottomBanner"]',
      'gu-island[name="SlotBodyEnd"]',
      'gu-island[name="BrazeMessaging"]',
      'gu-island[name="AdmiralScript"]',
      '#sign-in-gate',
      '[data-component="sign-in-gate"]',
    ].join(',\n') + ' { display: none !important; }',
  },
]

/** The CSS for a page, or null when its site needs none. */
export function webviewSiteCleanupCssBlock(url: string): string | null {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  const rules = SITE_CLEANUP_CSS_BLOCK
    .filter(rule => rule.hosts.some(h => host === h || host.endsWith(`.${h}`)))
    .map(rule => rule.css)
  return rules.length > 0 ? rules.join('\n') : null
}

interface CleanableWebviewBlock {
  addEventListener: (event: string, listener: () => void) => void
  removeEventListener: (event: string, listener: () => void) => void
  getURL?: () => string
  insertCSS?: (css: string) => Promise<unknown>
}

/** Apply the cleanup each time a page in this webview is ready. */
export function startWebviewSiteCleanupBlock(webview: CleanableWebviewBlock): () => void {
  const apply = () => {
    try {
      const css = webviewSiteCleanupCssBlock(webview.getURL?.() ?? '')
      if (css) webview.insertCSS?.(css)?.catch(() => { /* guest went away */ })
    } catch { /* not ready yet; dom-ready will apply it */ }
  }
  webview.addEventListener('dom-ready', apply)
  apply()
  return () => webview.removeEventListener('dom-ready', apply)
}
