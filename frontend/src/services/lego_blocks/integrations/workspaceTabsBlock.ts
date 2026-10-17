import { isExternalDocumentPathBlock } from '@/services/lego_blocks/units/externalDocumentPathBlock'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  getStorageItem,
} from '@/services/orchestrators/storageOrch'
import type { WindowContextBlock } from '@/services/lego_blocks/units/windowContextBlock'

export interface AppWorkspaceTab {
  id: string
  route: string
  label?: string
}

export function createWorkspaceTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeTabRoute(route: string): string {
  const trimmed = route.trim()
  if (!trimmed) return '/'
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  // Migrate legacy /chat tabs to /ai/chat (preserves query/hash).
  if (withSlash === '/chat' || withSlash.startsWith('/chat?') || withSlash.startsWith('/chat#')) {
    return `/ai/chat${withSlash.slice('/chat'.length)}`
  }
  return withSlash
}

export function parseTabRoute(route: string): { pathname: string; search: URLSearchParams } {
  try {
    const parsed = new URL(normalizeTabRoute(route), 'https://ltm.local')
    return { pathname: parsed.pathname, search: parsed.searchParams }
  } catch {
    return { pathname: '/', search: new URLSearchParams() }
  }
}

export function dedupeTabIds(tabIds: string[]): string[] {
  const next: string[] = []
  for (const tabId of tabIds) {
    if (!next.includes(tabId)) next.push(tabId)
  }
  return next
}

export function sameTabIdSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tabId, index) => tabId === right[index])
}

export function applyPersistentSurfaceBudget(
  tabIds: string[],
  hiddenLimit: number,
  activeTabId?: string | null,
): string[] {
  const deduped = dedupeTabIds(tabIds)
  if (deduped.length === 0) return deduped

  const normalizedHiddenLimit = Math.max(0, hiddenLimit)
  const requestedActiveTabId = activeTabId?.trim() ? activeTabId : null
  const protectedActiveTabId = requestedActiveTabId && deduped.includes(requestedActiveTabId)
    ? requestedActiveTabId
    : null
  if (!protectedActiveTabId) {
    return deduped.length <= normalizedHiddenLimit
      ? deduped
      : deduped.slice(-normalizedHiddenLimit)
  }

  const hiddenTabIds = deduped.filter((tabId) => tabId !== protectedActiveTabId)
  const keptHiddenTabIds = hiddenTabIds.slice(-normalizedHiddenLimit)
  return [...keptHiddenTabIds, protectedActiveTabId]
}

export function appendPersistentSurfaceTabId(
  tabIds: string[],
  tabId: string,
  hiddenLimit: number,
  activeTabId?: string | null,
): string[] {
  return applyPersistentSurfaceBudget(
    [...tabIds.filter((candidate) => candidate !== tabId), tabId],
    hiddenLimit,
    activeTabId,
  )
}

export function getWindowScopedStorageKey(baseKey: string, sessionId: string): string {
  return `${baseKey}:${sessionId}`
}

export function getWindowScopedAppShellTabsStorageKey(windowContext: WindowContextBlock): string {
  return getWindowScopedStorageKey(STORAGE_KEYS.appShellTabs, windowContext.sessionId)
}

export function getWindowScopedAppShellActiveTabStorageKey(windowContext: WindowContextBlock): string {
  return getWindowScopedStorageKey(STORAGE_KEYS.appShellActiveTabId, windowContext.sessionId)
}

export function getDynamicStorageItemBlock(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setDynamicStorageItemBlock(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage write failures in restricted runtimes.
  }
}

export function getDynamicJsonStorageItemBlock<T>(key: string, fallback: T): T {
  const raw = getDynamicStorageItemBlock(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readScopedAppShellTabsBlock(windowContext: WindowContextBlock): AppWorkspaceTab[] {
  const scopedTabs = getDynamicJsonStorageItemBlock<AppWorkspaceTab[]>(
    getWindowScopedAppShellTabsStorageKey(windowContext),
    [],
  )
  if (scopedTabs.length > 0) return scopedTabs
  if (!windowContext.isMainWindow) return []
  return getJsonStorageItem<AppWorkspaceTab[]>(STORAGE_KEYS.appShellTabs, [])
}

export function readScopedAppShellActiveTabIdBlock(windowContext: WindowContextBlock): string {
  const scopedActiveTabId = getDynamicStorageItemBlock(getWindowScopedAppShellActiveTabStorageKey(windowContext))
  if (scopedActiveTabId) return scopedActiveTabId
  if (!windowContext.isMainWindow) return ''
  return getStorageItem(STORAGE_KEYS.appShellActiveTabId) ?? ''
}

export function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getTabLabel(route: string, labelByPath: Map<string, string>, chatLabel?: string, webLabel?: string, webullLabel?: string, webSiteLabels?: Record<string, string>): string {
  const { pathname, search } = parseTabRoute(route)
  if (pathname === '/thinking-space') {
    const filePath = search.get('file')?.trim()
    if (filePath) {
      const decoded = safeDecodeURIComponent(filePath)
      const name = decoded.split('/').filter(Boolean).pop() || 'File'
      return isExternalDocumentPathBlock(decoded) ? `External · ${name}` : `Space · ${name}`
    }
  }

  if (pathname === '/thinking-organizer' || pathname === '/file-organizer') {
    const tab = search.get('tab')?.trim()
    if (tab) return `Organizer · ${toTitleCase(tab)}`
  }

  if (pathname === '/ai/chat' && chatLabel) return chatLabel

  if (pathname === '/web') {
    const siteId = search.get('site')
    if (siteId && webSiteLabels) {
      const siteName = webSiteLabels[siteId]
      if (siteName) return `Web · ${siteName}`
    }
    if (webLabel) return webLabel
  }

  if (pathname === '/webull' && webullLabel) return webullLabel

  return labelByPath.get(pathname) ?? 'Workspace'
}

export function resolvePreferredSameRouteTabLabel(pathname: string, cachedLabel: string | undefined, derivedLabel: string): string {
  const trimmedCachedLabel = cachedLabel?.trim()
  const genericLabel = pathname === '/ai/chat'
    ? 'AI'
    : (pathname === '/web' ? 'Web' : null)

  if (!genericLabel) return trimmedCachedLabel || derivedLabel
  if (trimmedCachedLabel && trimmedCachedLabel !== genericLabel) return trimmedCachedLabel
  if (derivedLabel !== genericLabel) return derivedLabel
  return trimmedCachedLabel || derivedLabel
}
