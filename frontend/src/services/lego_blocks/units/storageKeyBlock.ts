export const STORAGE_KEYS = {
  vaultRoot: 'ltm-vault-root',
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
  thinkingOrganizerBacklogView: 'ltm-thinking-organizer-backlog-view',
  thinkingOrganizerProjectCreateDestination: 'ltm-thinking-organizer-project-create-destination',
  appShellSidebarCollapsed: 'ltm-app-shell-sidebar-collapsed',
  appShellExcalidrawExpanded: 'ltm-app-shell-excalidraw-expanded',
  appShellTabs: 'ltm-app-shell-tabs',
  appShellActiveTabId: 'ltm-app-shell-active-tab-id',
  appTheme: 'ltm-app-theme',
  appColorMode: 'ltm-app-color-mode',
  thinkingSpaceExplorerCollapsed: 'ltm-thinking-space-explorer-collapsed',
  thinkingSpaceExplorerWidthPx: 'ltm-thinking-space-explorer-width-px',
  capabilityFeatureFlags: 'ltm-capability-feature-flags',
  stewardProposalQueue: 'ltm-steward-proposal-queue',
  aiTelemetryEvents: 'ltm-ai-telemetry-events',
  aiSettings: 'ltm-ai-settings',
  markdownEditorSettings: 'ltm-markdown-editor-settings',
  schedulerSettings: 'ltm-scheduler-settings',
  schedulerTaskLastAttemptById: 'ltm-scheduler-task-last-attempt-by-id',
  markdownDocumentTopBarHidden: 'ltm-markdown-document-top-bar-hidden',
  userProfileCache: 'ltm-user-profile-cache',
  gitSyncActionsByVault: 'ltm-git-sync-actions-by-vault',
  webullExecutionSettings: 'ltm-webull-execution-settings',
  webullProjectPresetTags: 'ltm-webull-project-preset-tags',
  webullOverallRememberByProjectRoot: 'ltm-webull-overall-remember-by-project-root',
  aiManualCredentials: 'ltm-ai-manual-credentials',
  aiOauthCredentials: 'ltm-ai-oauth-credentials',
  googleDriveAuth: 'ltm-google-drive-auth',
  googleDriveOauthClientId: 'ltm-google-drive-oauth-client-id',
  rssFeedConfigs: 'ltm-rss-feed-configs',
  rssReadItemIds: 'ltm-rss-read-item-ids',
  rssFeedRetentionDays: 'ltm-rss-feed-retention-days',
  aiWebsites: 'ltm-ai-websites',
  webSites: 'ltm-web-sites',
  fileActivityIgnoredPaths: 'ltm-file-activity-ignored-paths',
  aiActivityProjectMapping: 'ltm-ai-activity-project-mapping',
  aiActivityVaultSourcePrefixes: 'ltm-ai-activity-vault-source-prefixes',
  goodnotesReadingAnnotationGate: 'ltm-goodnotes-reading-annotation-gate',
  aiActivityHomePostItEnabled: 'ltm-ai-activity-home-post-it-enabled',
  vaultSyncExcludedPrefixes: 'ltm-vault-sync-excluded-prefixes',
  intelligenceDefaultProvider: 'ltm-intelligence-default-provider',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

function getLocalStorageItemBlock(key: StorageKey): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setLocalStorageItemBlock(key: StorageKey, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
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

function readElectronPersistedVaultRootBlock(): string | null {
  if (!isElectronVaultRootBridgeAvailableBlock()) return null
  const persisted = normalizeVaultRootValueBlock(window.electronAPI?.vaultRootGetPersisted?.())
  if (persisted) return persisted

  // One-time migration from legacy localStorage key into main-process persistence.
  const legacy = normalizeVaultRootValueBlock(getLocalStorageItemBlock(STORAGE_KEYS.vaultRoot))
  if (!legacy) return null
  void window.electronAPI?.vaultRootSetPersisted?.(legacy)
  try {
    localStorage.removeItem(STORAGE_KEYS.vaultRoot)
  } catch {
    // Ignore cleanup failures.
  }
  return legacy
}

function writeElectronPersistedVaultRootBlock(value: string): void {
  const normalized = normalizeVaultRootValueBlock(value)
  void window.electronAPI?.vaultRootSetPersisted?.(normalized)
}

export function getStorageItem(key: StorageKey): string | null {
  if (key === STORAGE_KEYS.vaultRoot) {
    const electronPersisted = readElectronPersistedVaultRootBlock()
    if (electronPersisted) return electronPersisted
  }
  return getLocalStorageItemBlock(key)
}

export function setStorageItem(key: StorageKey, value: string): void {
  if (key === STORAGE_KEYS.vaultRoot && isElectronVaultRootBridgeAvailableBlock()) {
    writeElectronPersistedVaultRootBlock(value)
    return
  }
  setLocalStorageItemBlock(key, value)
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

/**
 * Whether GoodNotes reading sessions should be gated on an annotation signal —
 * only counted when the document was actually modified (an annotation/date added)
 * on the session day, filtering out idle "left the PDF open" sessions. Off by
 * default; opt-in for readers whose habit is to always mark up what they read.
 */
export function getGoodnotesAnnotationGate(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.goodnotesReadingAnnotationGate) === 'true'
}

export function setGoodnotesAnnotationGate(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.goodnotesReadingAnnotationGate, enabled ? 'true' : 'false')
}

/**
 * Whether the home canvas auto-drafts a daily "what I did with AI today" post-it.
 * Off by default — the This Week digest card now covers the same ground, so the
 * auto post-it is opt-in for users who still want it pinned on the canvas.
 */
export function getAiActivityHomePostItEnabled(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.aiActivityHomePostItEnabled) === 'true'
}

export function setAiActivityHomePostItEnabled(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityHomePostItEnabled, enabled ? 'true' : 'false')
}

export function setStoredVaultRoot(path: string): void {
  setStorageItem(STORAGE_KEYS.vaultRoot, path)
}
