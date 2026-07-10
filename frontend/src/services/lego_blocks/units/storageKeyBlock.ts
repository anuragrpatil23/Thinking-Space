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
  goodnotesReadingEnabled: 'ltm-goodnotes-reading-enabled',
  aiActivityHomePostItEnabled: 'ltm-ai-activity-home-post-it-enabled',
  aiActivitySetMode: 'ltm-ai-activity-set-mode-enabled',
  aiActivityCalendarMode: 'ltm-ai-activity-calendar-mode-enabled',
  aiActivityAiTitlesEnabled: 'ltm-ai-activity-ai-titles-enabled',
  aiActivityRangeSummaryProvider: 'ltm-ai-activity-range-summary-provider',
  aiActivityRestDays: 'ltm-ai-activity-rest-days',
  aiActivitySectionsOpen: 'ltm-ai-activity-sections-open',
  vaultSyncExcludedPrefixes: 'ltm-vault-sync-excluded-prefixes',
  intelligenceDefaultProvider: 'ltm-intelligence-default-provider',
  aiActivityRuleBasedAtomsPurged: 'ltm-ai-activity-rule-based-atoms-purged',
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
 * Whether the GoodNotes harvester is allowed to run. Off by default — reading
 * GoodNotes' container (`~/Library/Containers/com.goodnotesapp.x/…/fts.sqlite`)
 * triggers macOS Sequoia's "would like to access data from other apps" TCC
 * prompt on every launch until granted, and the grant is flaky across app
 * rebuilds. Users who actually use GoodNotes opt in from Settings ▸ AI
 * Activity ▸ Session sources; everyone else never touches another app's
 * container.
 */
export function getGoodnotesReadingEnabled(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.goodnotesReadingEnabled) === 'true'
}

export function setGoodnotesReadingEnabled(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.goodnotesReadingEnabled, enabled ? 'true' : 'false')
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

/**
 * When on, AI-Activity surfaces group time by fixed 3-day "sets" anchored to
 * month boundaries instead of ISO weeks. Off by default — this is an opt-in
 * alternate rhythm for people whose completion window sits around 3 days.
 * When on: the heatmap switches to a month/set layout with day-of-month
 * numbers inside cells, and the aggregate bar chart's `week` granularity is
 * replaced by `set`.
 */
export function getAiActivitySetMode(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.aiActivitySetMode) === 'true'
}

export function setAiActivitySetMode(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivitySetMode, enabled ? 'true' : 'false')
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_ACTIVITY_SET_MODE_EVENT, { detail: enabled }))
  }
}

/** Fired on the window whenever set-mode is toggled — lets consumers re-render
 *  without polling. `storage` events don't fire in the same tab that wrote the
 *  value, so this bridges same-tab updates from the settings page to any open
 *  AI-Activity surfaces. */
export const AI_ACTIVITY_SET_MODE_EVENT = 'thinkspc:ai-activity-set-mode-changed'

/**
 * When on, the AI-Activity heatmap swaps its GitHub-style contribution grid
 * for a month-by-month calendar layout (Mon–Sun columns, dates in cells).
 * Off by default; opt-in for people who read time-of-month faster than
 * time-of-year at a glance.
 */
export function getAiActivityCalendarMode(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.aiActivityCalendarMode) === 'true'
}

export function setAiActivityCalendarMode(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityCalendarMode, enabled ? 'true' : 'false')
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_ACTIVITY_CALENDAR_MODE_EVENT, { detail: enabled }))
  }
}

export const AI_ACTIVITY_CALENDAR_MODE_EVENT = 'thinkspc:ai-activity-calendar-mode-changed'

/**
 * Master toggle for AI-generated chain titles + day summaries. Independent of
 * whether a local model is configured — when off, the atom/chain-digest
 * orchestrators skip model calls entirely and callers see the deterministic
 * topic-based fallback. Default on: preserves existing behavior for users
 * who already have an intelligence provider set up.
 */
export function getAiActivityAiTitlesEnabled(): boolean {
  const raw = getLocalStorageItemBlock(STORAGE_KEYS.aiActivityAiTitlesEnabled)
  if (raw === null) return true
  return raw === 'true'
}

export function setAiActivityAiTitlesEnabled(enabled: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityAiTitlesEnabled, enabled ? 'true' : 'false')
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_ACTIVITY_AI_TITLES_EVENT, { detail: enabled }))
  }
}

export const AI_ACTIVITY_AI_TITLES_EVENT = 'thinkspc:ai-activity-ai-titles-changed'

/**
 * Run-once flag for the migration that purges legacy rule-based stub atoms
 * (persisted by an old bug) from the store. Set after the purge completes so
 * it never runs again on subsequent boots. Per-device — the vault-side delete
 * is idempotent, so a second device running it once more is harmless.
 */
export function getAiActivityRuleBasedAtomsPurged(): boolean {
  return getLocalStorageItemBlock(STORAGE_KEYS.aiActivityRuleBasedAtomsPurged) === 'true'
}

export function setAiActivityRuleBasedAtomsPurged(done: boolean): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityRuleBasedAtomsPurged, done ? 'true' : 'false')
}

/**
 * Provider choice for the range-summary pipeline. Independent of the chain-
 * digest / day-atom AI toggle above because the compute profile is very
 * different — range summaries synthesize 5-25 chains in one pass, which
 * exceeds small local models' reliability ceiling. User picks:
 *   'off'         — deterministic fallback only (titles list, or stub when
 *                   even titles are missing). Default.
 *   'local'       — two-stage (label → cluster → narrate) on whatever the
 *                   configured local intelligence provider is.
 *   'claude-cli'  — one-shot via the `claude -p` provider. Handles bigger
 *                   ranges reliably; consumes the user's Pro-plan budget.
 * Both non-fallback paths still fall through to the deterministic route if
 * their model call fails.
 */
export type AiActivityRangeSummaryProvider = 'off' | 'local' | 'claude-cli'

export function getAiActivityRangeSummaryProvider(): AiActivityRangeSummaryProvider {
  const raw = getLocalStorageItemBlock(STORAGE_KEYS.aiActivityRangeSummaryProvider)
  if (raw === 'local' || raw === 'claude-cli' || raw === 'off') return raw
  return 'off'
}

export function setAiActivityRangeSummaryProvider(provider: AiActivityRangeSummaryProvider): void {
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityRangeSummaryProvider, provider)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_ACTIVITY_RANGE_SUMMARY_PROVIDER_EVENT, { detail: provider }))
  }
}

export const AI_ACTIVITY_RANGE_SUMMARY_PROVIDER_EVENT = 'thinkspc:ai-activity-range-summary-provider-changed'

/**
 * User-declared rest weekdays — numbers 0..6 with 0 = Sunday, 6 = Saturday.
 * Only cells whose date falls in the *current calendar month* AND whose
 * weekday matches get the soft highlight; historical months are untouched
 * because rest cadence is a forward-looking preference, not a log.
 */
export function getAiActivityRestDays(): number[] {
  const raw = getLocalStorageItemBlock(STORAGE_KEYS.aiActivityRestDays)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (n): n is number => typeof n === 'number' && n >= 0 && n <= 6 && Number.isInteger(n),
    )
  } catch {
    return []
  }
}

export function setAiActivityRestDays(days: number[]): void {
  const clean = Array.from(new Set(days.filter(n => n >= 0 && n <= 6 && Number.isInteger(n)))).sort(
    (a, b) => a - b,
  )
  setLocalStorageItemBlock(STORAGE_KEYS.aiActivityRestDays, JSON.stringify(clean))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_ACTIVITY_REST_DAYS_EVENT, { detail: clean }))
  }
}

export const AI_ACTIVITY_REST_DAYS_EVENT = 'thinkspc:ai-activity-rest-days-changed'

export function setStoredVaultRoot(path: string): void {
  setStorageItem(STORAGE_KEYS.vaultRoot, path)
}
