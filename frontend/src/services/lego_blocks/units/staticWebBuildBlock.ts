/**
 * The static GitHub Pages build (`BUILD_TARGET=pages`, see vite.config.ts).
 *
 * It is the public, try-it-in-a-browser face of the app, so the owner's
 * personal tools (brokerage, passwords, heading assignments) are left out of
 * it entirely: no nav entry, and their routes go home.
 */

export const IS_STATIC_WEB_BUILD_BLOCK = import.meta.env.VITE_HASH_ROUTER === 'true'

const STATIC_WEB_HIDDEN_ROUTES_BLOCK = new Set([
  '/webull',
  '/password-manager',
  '/personal-tools',
  '/personal-extension',
])

/** Whether `route` is a personal tool left out of the static web build. */
export function isHiddenInStaticWebBuildBlock(route: string): boolean {
  return IS_STATIC_WEB_BUILD_BLOCK && STATIC_WEB_HIDDEN_ROUTES_BLOCK.has(route)
}
