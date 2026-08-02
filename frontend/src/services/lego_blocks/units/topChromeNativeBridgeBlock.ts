import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export interface NativeTopChromeTabBridgeItem {
  id: string
  label: string
  active: boolean
}

export interface TopChromeStateBlock {
  title: string
  visible?: boolean
  activeNavItemId?: string
  topBarCollapsed?: boolean
  bottomBarCollapsed?: boolean
  showSearch?: boolean
  showTools?: boolean
  toolsBadgeCount?: number
  canToggleSidebar?: boolean
  sidebarToggleActive?: boolean
  sidebarToggleLabel?: string
  canToggleHeader?: boolean
  headerToggleLabel?: string
  tabs?: NativeTopChromeTabBridgeItem[]
  bottomBarHidden?: boolean
  canRefresh?: boolean
  /** True while a vault sync is in flight (past the visibility threshold) —
   *  animates the native refresh affordances. */
  syncActive?: boolean
  /** Processed/total file counts for the in-flight sync; 0 = indeterminate. */
  syncCompleted?: number
  syncTotal?: number
  canSync?: boolean
  canRebuild?: boolean
  canGitCommit?: boolean
  canGitPush?: boolean
  /** User-configured label for the Webull tab in the native iPhone rail. */
  webullTabLabel?: string
  /** User-configured text glyph for the Webull tab icon (Settings → Webull tab
   *  icon text, e.g. "f9"). Empty string means unset — the native side falls
   *  back to the Webull-horns mark, mirroring Electron's WebullNavIcon. */
  webullTabIconText?: string
  /** True when the content under the status bar is dark (night backdrop or
   *  dark app theme) — flips the native status-bar glyphs + top scrim. */
  topBarDark?: boolean
  /** True when the active page paints its own opaque strip under the status
   *  bar. The native scrim exists to keep the clock legible over content that
   *  scrolls beneath it; over an opaque page it has nothing to refract and
   *  reads as a grey smudge with a feathered edge (New Note, 2026-08-02). */
  topScrimHidden?: boolean
}

export type TopChromeEventPayload = {
  tabId?: string
  navItemId?: string
  path?: string
  /** Used by topChromeNavRequestRender to indicate forward push vs back pop. */
  direction?: 'forward' | 'back'
}

export type TopChromeEventName =
  | 'topChromeMenuTap'
  | 'topChromeSearchTap'
  | 'topChromeOpenDebugTap'
  | 'topChromeRefreshTap'
  | 'topChromeSyncTap'
  | 'topChromeRebuildTap'
  | 'topChromeGitCommitTap'
  | 'topChromeGitPushTap'
  | 'topChromeHeaderToggleTap'
  | 'topChromeSidebarToggleTap'
  | 'topChromeCreateTap'
  | 'topChromeExpandBottomTap'
  | 'topChromeSelectTab'
  | 'topChromeCloseTab'
  | 'topChromeNavItemTap'
  | 'topChromeNavRequestRender'
  | 'topChromeNavDidFinish'

interface TopChromePluginBlock {
  setState(options: Omit<TopChromeStateBlock, 'tabs'> & { tabsPayload?: string }): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  addListener(
    eventName: TopChromeEventName,
    listenerFunc: (payload: TopChromeEventPayload) => void,
  ): Promise<PluginListenerHandle>
  // Native push navigation (iOS phone shell). No-op on platforms where the
  // plugin doesn't implement it (Capacitor falls back gracefully).
  pushNavigation(options: { path: string }): Promise<void>
  popNavigation(): Promise<void>
  didCommitNavigation(options: { path: string }): Promise<void>
  setNavigationStack(options: { stack: string[] }): Promise<void>
}

const TopChrome = registerPlugin<TopChromePluginBlock>('TopChrome')

export async function setTopChromeStateBlock(options: TopChromeStateBlock): Promise<void> {
  const { tabs, ...rest } = options
  await TopChrome.setState({
    ...rest,
    tabsPayload: JSON.stringify(tabs ?? []),
  })
}

export async function showTopChromeBlock(): Promise<void> {
  await TopChrome.show()
}

export async function hideTopChromeBlock(): Promise<void> {
  await TopChrome.hide()
}

export async function addTopChromeListenerBlock(
  eventName: TopChromeEventName,
  handler: (payload: TopChromeEventPayload) => void,
): Promise<PluginListenerHandle> {
  return TopChrome.addListener(eventName, handler)
}

// MARK: - Native push navigation bridge (iPhone shell)

export async function pushNativeNavigationBlock(path: string): Promise<void> {
  await TopChrome.pushNavigation({ path })
}

export async function popNativeNavigationBlock(): Promise<void> {
  await TopChrome.popNavigation()
}

export async function commitNativeNavigationBlock(path: string): Promise<void> {
  await TopChrome.didCommitNavigation({ path })
}

export async function setNativeNavigationStackBlock(stack: string[]): Promise<void> {
  await TopChrome.setNavigationStack({ stack })
}

// Forward-mutation registry — for content opens that don't have a URL
// representation (RSS article, notebook view, etc.). The caller's onForward
// closure runs after Swift takes the snapshot but before the slide animates,
// so the new content is in place by the time the animation reveals it.

// Pending forward closure waiting for the next requestRender event. Single
// slot — assumes pushes are sequential (the UI flow is "user tap → push →
// animation" with no overlapping pushes). If a second push fires before
// the first commits, the second's closure replaces the first's (and the
// first never runs).
let pendingForwardBlock: (() => void) | null = null

/**
 * Push a detail screen with a state mutation as the forward action.
 *
 * Use this for content that doesn't live in the URL — RSS articles, notebook
 * views, browser overlays, etc. The hook auto-consumes the closure when
 * Swift fires the forward render event AND skips the navigate(path) step,
 * so the URL set by the caller's mutation (via setSearchParams) sticks.
 *
 * Multiple pushes can share the same `basePath` — Swift's stack allows
 * same-path entries; only the count matters for canPop.
 */
export async function pushNativeWithForwardBlock(basePath: string, onForward: () => void): Promise<void> {
  pendingForwardBlock = onForward
  await TopChrome.pushNavigation({ path: basePath })
}

/** Hook-internal: pop and return the pending forward closure, if any. */
export function consumePendingForwardBlock(): (() => void) | null {
  const cb = pendingForwardBlock
  pendingForwardBlock = null
  return cb
}
