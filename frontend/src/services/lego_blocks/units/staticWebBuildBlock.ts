/**
 * The static GitHub Pages build (`BUILD_TARGET=pages`, see vite.config.ts).
 *
 * It is the public, try-it-in-a-browser face of the app, and it runs under a
 * Content-Security-Policy that lets the page talk only to its own origin (see
 * vite.config.ts). So two kinds of surface are left out of it entirely — no
 * nav entry, no settings tab, and their routes go home:
 *  - the owner's personal tools (brokerage, passwords, heading assignments);
 *  - anything that has to reach another host: AI chat and schedules (they also
 *    need API keys, which this build never stores), the Web tab, RSS, and the
 *    Google integrations.
 */

export const IS_STATIC_WEB_BUILD_BLOCK = import.meta.env.VITE_HASH_ROUTER === 'true'

const STATIC_WEB_HIDDEN_ROUTES_BLOCK = new Set([
  '/webull',
  '/password-manager',
  '/personal-tools',
  '/personal-extension',
  '/ai/chat',
  '/ai/schedules',
  '/web',
])

const STATIC_WEB_HIDDEN_SETTINGS_TABS_BLOCK = new Set([
  'ai',
  'ai_websites',
  'web_bookmarks',
  'google_docs_sheets',
  'rss',
  'webull',
])

/** Whether `route` is left out of the static web build. */
export function isHiddenInStaticWebBuildBlock(route: string): boolean {
  if (!IS_STATIC_WEB_BUILD_BLOCK) return false
  if (STATIC_WEB_HIDDEN_ROUTES_BLOCK.has(route)) return true
  return route.startsWith('/ai/schedules/')
}

/** Whether a Settings tab is left out of the static web build. */
export function isSettingsTabHiddenInStaticWebBuildBlock(tabId: string): boolean {
  return IS_STATIC_WEB_BUILD_BLOCK && STATIC_WEB_HIDDEN_SETTINGS_TABS_BLOCK.has(tabId)
}
