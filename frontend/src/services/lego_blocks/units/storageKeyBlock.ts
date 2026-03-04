export const STORAGE_KEYS = {
  vaultRoot: 'ltm-vault-root',
  thinkingSpacesRegistry: 'ltm-thinking-spaces-registry',
  thinkingSpacesActiveId: 'ltm-thinking-spaces-active-id',
  thinkingOrganizerTab: 'ltm-thinking-organizer-tab',
  thinkingOrganizerTemplates: 'ltm-thinking-organizer-level-templates',
  thinkingOrganizerRecentTemplates: 'ltm-thinking-organizer-recent-templates',
  thinkingOrganizerNodeKinds: 'ltm-thinking-organizer-node-kinds',
  thinkingOrganizerFolderRoots: 'ltm-thinking-organizer-folder-roots',
  thinkingOrganizerProjectRoots: 'ltm-thinking-organizer-project-roots',
  thinkingOrganizerSelectedProjectRoot: 'ltm-thinking-organizer-selected-project-root',
  thinkingOrganizerProjects: 'ltm-thinking-organizer-projects',
  thinkingOrganizerProjectPresetTags: 'ltm-thinking-organizer-project-preset-tags',
  thinkingOrganizerProjectTagColors: 'ltm-thinking-organizer-project-tag-colors',
  thinkingOrganizerProjectProgramGroups: 'ltm-thinking-organizer-project-program-groups',
  thinkingOrganizerProjectCreateDestination: 'ltm-thinking-organizer-project-create-destination',
  appShellSidebarCollapsed: 'ltm-app-shell-sidebar-collapsed',
  appShellExcalidrawExpanded: 'ltm-app-shell-excalidraw-expanded',
  appShellTabs: 'ltm-app-shell-tabs',
  appShellActiveTabId: 'ltm-app-shell-active-tab-id',
  appTheme: 'ltm-app-theme',
  thinkingSpaceExplorerCollapsed: 'ltm-thinking-space-explorer-collapsed',
  thinkingSpaceExplorerWidthPx: 'ltm-thinking-space-explorer-width-px',
  capabilityFeatureFlags: 'ltm-capability-feature-flags',
  stewardProposalQueue: 'ltm-steward-proposal-queue',
  aiTelemetryEvents: 'ltm-ai-telemetry-events',
  capabilityPolicy: 'ltm-capability-policy',
  aiSettings: 'ltm-ai-settings',
  markdownEditorSettings: 'ltm-markdown-editor-settings',
  markdownDocumentTopBarHidden: 'ltm-markdown-document-top-bar-hidden',
  userProfileCache: 'ltm-user-profile-cache',
  gitSyncActionsByVault: 'ltm-git-sync-actions-by-vault',
  f9ExecutionSettings: 'ltm-f9-execution-settings',
  f9WorkspaceSideTabsCollapsed: 'ltm-f9-workspace-side-tabs-collapsed',
  f9ProjectPresetTags: 'ltm-f9-project-preset-tags',
  f9OverallRememberByProjectRoot: 'ltm-f9-overall-remember-by-project-root',
  aiManualCredentials: 'ltm-ai-manual-credentials',
  aiOauthCredentials: 'ltm-ai-oauth-credentials',
  googleDriveAuth: 'ltm-google-drive-auth',
  googleDriveOauthClientId: 'ltm-google-drive-oauth-client-id',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
export const SPACE_STORAGE_PREFIX_BLOCK = 'ltm.space.v1'
const GLOBAL_STORAGE_KEYS_BLOCK = new Set<string>([
  STORAGE_KEYS.vaultRoot,
  STORAGE_KEYS.thinkingSpacesRegistry,
  STORAGE_KEYS.thinkingSpacesActiveId,
])

function getLocalStorageItemBlock(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setLocalStorageItemBlock(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage write failures in restricted runtimes.
  }
}

function removeLocalStorageItemBlock(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch {
    // Ignore storage write failures in restricted runtimes.
  }
}

function isElectronVaultRootBridgeAvailableBlock(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.isElectron
    && typeof window.electronAPI.vaultRootGetPersisted === 'function'
}

function normalizeVaultRootValueBlock(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

let cachedElectronPersistedVaultRootBlock: string | null | undefined

function readElectronPersistedVaultRootBlock(): string | null {
  if (!isElectronVaultRootBridgeAvailableBlock()) return null
  if (cachedElectronPersistedVaultRootBlock !== undefined) {
    return cachedElectronPersistedVaultRootBlock
  }

  const persisted = normalizeVaultRootValueBlock(window.electronAPI?.vaultRootGetPersisted?.())
  if (persisted) {
    cachedElectronPersistedVaultRootBlock = persisted
    return persisted
  }

  // One-time migration from legacy localStorage key into main-process persistence.
  const legacy = normalizeVaultRootValueBlock(getLocalStorageItemBlock(STORAGE_KEYS.vaultRoot))
  if (!legacy) {
    cachedElectronPersistedVaultRootBlock = null
    return null
  }
  cachedElectronPersistedVaultRootBlock = legacy
  void window.electronAPI?.vaultRootSetPersisted?.(legacy)
  removeLocalStorageItemBlock(STORAGE_KEYS.vaultRoot)
  return legacy
}

function writeElectronPersistedVaultRootBlock(value: string): void {
  const normalized = normalizeVaultRootValueBlock(value)
  cachedElectronPersistedVaultRootBlock = normalized
  void window.electronAPI?.vaultRootSetPersisted?.(normalized)
  if (normalized) {
    setLocalStorageItemBlock(STORAGE_KEYS.vaultRoot, normalized)
    return
  }
  removeLocalStorageItemBlock(STORAGE_KEYS.vaultRoot)
}

function resolveRuntimeScopeBlock(): 'electron' | 'ios' | 'android' | 'web' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown'
  if (window.electronAPI?.isElectron) return 'electron'
  const maybeCapacitor = (window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean
      getPlatform?: () => string
    }
  }).Capacitor
  if (maybeCapacitor?.isNativePlatform?.()) {
    const platform = maybeCapacitor.getPlatform?.()
    if (platform === 'ios') return 'ios'
    if (platform === 'android') return 'android'
  }
  return 'web'
}

function hashSpaceRootBlock(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeSpaceRootFragmentBlock(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) return 'default'
  return normalized.length > 24 ? normalized.slice(normalized.length - 24) : normalized
}

function resolveRawVaultRootBlock(): string {
  const persisted = readElectronPersistedVaultRootBlock()
  if (persisted) return persisted
  const local = normalizeVaultRootValueBlock(getLocalStorageItemBlock(STORAGE_KEYS.vaultRoot))
  if (local) return local
  return 'unconfigured'
}

function readActiveSpaceIdBlock(): string | null {
  const stored = getLocalStorageItemBlock(STORAGE_KEYS.thinkingSpacesActiveId)
  if (typeof stored !== 'string') return null
  const normalized = stored.trim()
  return normalized.length > 0 ? normalized : null
}

export function getActiveSpaceIdBlock(): string {
  const explicitActiveSpaceId = readActiveSpaceIdBlock()
  if (explicitActiveSpaceId) return explicitActiveSpaceId
  return buildSpaceIdBlock(resolveRawVaultRootBlock())
}

export function buildSpaceIdBlock(spaceRoot: string): string {
  const runtime = resolveRuntimeScopeBlock()
  const root = normalizeVaultRootValueBlock(spaceRoot) ?? 'unconfigured'
  const hash = hashSpaceRootBlock(root)
  const suffix = normalizeSpaceRootFragmentBlock(root)
  return `${runtime}-${hash}-${suffix}`
}

export function getSpaceStorageKeyBlock(
  key: string,
  spaceId = getActiveSpaceIdBlock(),
): string {
  return `${SPACE_STORAGE_PREFIX_BLOCK}.${spaceId}.${key}`
}

function readSpaceStorageItemBlock(key: string): string | null {
  const scopedKey = getSpaceStorageKeyBlock(key)
  const scopedValue = getLocalStorageItemBlock(scopedKey)
  if (scopedValue !== null) return scopedValue

  // Lazy migration for pre-namespace keys.
  const legacyValue = getLocalStorageItemBlock(key)
  if (legacyValue === null) return null
  setLocalStorageItemBlock(scopedKey, legacyValue)
  removeLocalStorageItemBlock(key)
  return legacyValue
}

function writeSpaceStorageItemBlock(key: string, value: string): void {
  setLocalStorageItemBlock(getSpaceStorageKeyBlock(key), value)
}

function isGlobalStorageKeyBlock(key: string): boolean {
  return GLOBAL_STORAGE_KEYS_BLOCK.has(key)
}

export function clearAllSpaceStorageBlock(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const toDelete: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith(`${SPACE_STORAGE_PREFIX_BLOCK}.`)) {
        toDelete.push(key)
      }
    }
    for (const key of toDelete) {
      localStorage.removeItem(key)
    }
  } catch {
    // Ignore local storage errors in restricted runtimes.
  }
}

export function getStorageItem(key: StorageKey): string | null {
  if (key === STORAGE_KEYS.vaultRoot) {
    const electronPersisted = readElectronPersistedVaultRootBlock()
    if (electronPersisted) return electronPersisted
  }
  if (isGlobalStorageKeyBlock(key)) {
    return getLocalStorageItemBlock(key)
  }
  return readSpaceStorageItemBlock(key)
}

export function setStorageItem(key: StorageKey, value: string): void {
  if (key === STORAGE_KEYS.vaultRoot) {
    const normalizedVaultRoot = normalizeVaultRootValueBlock(value)
    const nextSpaceId = buildSpaceIdBlock(normalizedVaultRoot ?? 'unconfigured')
    setLocalStorageItemBlock(STORAGE_KEYS.thinkingSpacesActiveId, nextSpaceId)
    if (isElectronVaultRootBridgeAvailableBlock()) {
      writeElectronPersistedVaultRootBlock(normalizedVaultRoot ?? '')
      return
    }
    if (normalizedVaultRoot) {
      setLocalStorageItemBlock(key, normalizedVaultRoot)
    } else {
      removeLocalStorageItemBlock(key)
    }
    return
  }
  if (isGlobalStorageKeyBlock(key)) {
    setLocalStorageItemBlock(key, value)
    return
  }
  writeSpaceStorageItemBlock(key, value)
}

export function getJsonStorageItem<T>(key: StorageKey, fallback: T): T {
  const raw = getStorageItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setJsonStorageItem<T>(key: StorageKey, value: T): void {
  setStorageItem(key, JSON.stringify(value))
}

export function getStoredVaultRoot(): string | null {
  return getStorageItem(STORAGE_KEYS.vaultRoot)
}

export function setStoredVaultRoot(path: string): void {
  setStorageItem(STORAGE_KEYS.vaultRoot, path)
}
