import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  createDefaultVaultUiPreferencesBlock,
  DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK,
  DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK,
  normalizeExplorerFolderColorPreferencesBlock,
  normalizeExplorerIconStyleBlock,
  normalizeMoonSceneMessagesPreferenceBlock,
  normalizeNewThoughtQuickDestinationsBlock,
  normalizeVaultUiPreferencesBlock,
  serializeVaultUiPreferencesBlock,
  MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK,
  type ExplorerFolderColorPreferenceBlock,
  type ExplorerIconStyleBlock,
  type MoonSceneMessagePreferenceBlock,
  type NewThoughtQuickDestinationPreferenceBlock,
  type AiActivityRoamingPrefsBlock,
  type VaultSchedulerTaskPreferenceBlock,
  type VaultUiPreferencesBlock,
} from '@/services/lego_blocks/units/vaultUiPreferencesBlock'
import {
  STORAGE_KEYS,
  getAiActivityAiTitlesEnabled,
  getAiActivityCalendarMode,
  getAiActivityHomePostItEnabled,
  getAiActivityRestDays,
  getAiActivitySetMode,
  getGoodnotesAnnotationGate,
  getGoodnotesReadingEnabled,
  getStoredVaultRoot,
  registerStorageWriteListenerBlock,
  setAiActivityAiTitlesEnabled,
  setAiActivityCalendarMode,
  setAiActivityHomePostItEnabled,
  setAiActivityRestDays,
  setAiActivitySetMode,
  setGoodnotesAnnotationGate,
  setGoodnotesReadingEnabled,
} from '@/services/lego_blocks/units/storageKeyBlock'

const THINK_SPACE_DIR_ORCH = '.thinking-space'
const LEGACY_THINK_SPACE_DIR_ORCH = '.think-space'
const UI_PREFERENCES_DIR_ORCH = `${THINK_SPACE_DIR_ORCH}/preferences`
const UI_PREFERENCES_FILE_ORCH = `${UI_PREFERENCES_DIR_ORCH}/ui.json`
const LEGACY_UI_PREFERENCES_DIR_ORCH = `${LEGACY_THINK_SPACE_DIR_ORCH}/preferences`
const LEGACY_UI_PREFERENCES_FILE_ORCH = `${LEGACY_UI_PREFERENCES_DIR_ORCH}/ui.json`

export type {
  ExplorerFolderColorPreferenceBlock,
  ExplorerIconStyleBlock,
  MoonSceneMessagePreferenceBlock,
  NewThoughtQuickDestinationPreferenceBlock,
  VaultUiPreferencesBlock,
}
export { DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK, DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK }

async function ensurePreferencesDirOrch(): Promise<void> {
  const fs = getVaultFS()
  try {
    await fs.mkdir(THINK_SPACE_DIR_ORCH)
  } catch {
    // Directory likely exists.
  }
  try {
    await fs.mkdir(UI_PREFERENCES_DIR_ORCH)
  } catch {
    // Directory likely exists.
  }
}

export async function readVaultUiPreferencesOrch(): Promise<VaultUiPreferencesBlock> {
  const fs = getVaultFS()
  try {
    const hasCurrent = await fs.exists(UI_PREFERENCES_FILE_ORCH)
    const targetPath = hasCurrent
      ? UI_PREFERENCES_FILE_ORCH
      : (await fs.exists(LEGACY_UI_PREFERENCES_FILE_ORCH))
        ? LEGACY_UI_PREFERENCES_FILE_ORCH
        : null
    if (!targetPath) {
      return createDefaultVaultUiPreferencesBlock()
    }
    const raw = await fs.read(targetPath)
    if (!raw.trim()) return createDefaultVaultUiPreferencesBlock()
    const normalized = normalizeVaultUiPreferencesBlock(JSON.parse(raw))
    if (targetPath === LEGACY_UI_PREFERENCES_FILE_ORCH) {
      // Best effort: migrate legacy location to canonical .thinking-space path.
      try {
        await ensurePreferencesDirOrch()
        await fs.write(UI_PREFERENCES_FILE_ORCH, serializeVaultUiPreferencesBlock(normalized))
      } catch {
        // Ignore migration write errors; return parsed preferences.
      }
    }
    return normalized
  } catch {
    return createDefaultVaultUiPreferencesBlock()
  }
}

async function writeVaultUiPreferencesOrch(
  preferences: VaultUiPreferencesBlock,
): Promise<VaultUiPreferencesBlock> {
  const normalized = normalizeVaultUiPreferencesBlock(preferences)
  const fs = getVaultFS()
  await ensurePreferencesDirOrch()
  await fs.write(UI_PREFERENCES_FILE_ORCH, serializeVaultUiPreferencesBlock(normalized))
  return normalized
}

async function updateVaultUiPreferencesOrch(
  partial: Partial<VaultUiPreferencesBlock>,
): Promise<VaultUiPreferencesBlock> {
  const current = await readVaultUiPreferencesOrch()
  return writeVaultUiPreferencesOrch({
    ...current,
    ...partial,
  })
}

export async function setExplorerIconStylePreferenceOrch(
  style: ExplorerIconStyleBlock,
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({
    explorerIconStyle: normalizeExplorerIconStyleBlock(style),
  })
}

export async function setShowDailyHighlightsPreferenceOrch(
  show: boolean,
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({ showDailyHighlights: show })
}

export async function readNewThoughtQuickDestinationsPreferenceOrch(): Promise<
  NewThoughtQuickDestinationPreferenceBlock[]
> {
  const preferences = await readVaultUiPreferencesOrch()
  return preferences.newThoughtQuickDestinations
}

export async function setNewThoughtQuickDestinationsPreferenceOrch(
  destinations: NewThoughtQuickDestinationPreferenceBlock[],
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({
    newThoughtQuickDestinations: normalizeNewThoughtQuickDestinationsBlock(destinations),
  })
}

export async function readExplorerFolderColorPreferencesOrch(): Promise<
  ExplorerFolderColorPreferenceBlock[]
> {
  const preferences = await readVaultUiPreferencesOrch()
  return preferences.explorerFolderColorRules
}

export async function setExplorerFolderColorPreferencesOrch(
  rules: ExplorerFolderColorPreferenceBlock[],
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({
    explorerFolderColorRules: normalizeExplorerFolderColorPreferencesBlock(rules),
  })
}

export async function setExplorerSelectedColorPreferenceOrch(
  color: string,
): Promise<VaultUiPreferencesBlock> {
  // Blank/invalid falls back to the default in normalizeVaultUiPreferencesBlock.
  return updateVaultUiPreferencesOrch({ explorerSelectedColor: color })
}

export async function setWebullTabPreferencesOrch(
  label: string,
  iconText: string,
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({
    webullTabLabel: label.trim() || 'Webull',
    webullTabIconText: iconText.trim(),
  })
}

export async function setWebullSimTabEnabledPreferenceOrch(
  enabled: boolean,
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({ webullSimTabEnabled: enabled })
}

export async function setWebullSimFolderPathPreferenceOrch(
  path: string,
): Promise<VaultUiPreferencesBlock> {
  // Normalization (backslashes, stray slashes) happens in the preferences block.
  return updateVaultUiPreferencesOrch({ webullSimFolderPath: path })
}

export async function setFileActivityIgnoredPathsOrch(
  paths: string[],
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({
    fileActivityIgnoredPaths: paths.filter(p => typeof p === 'string' && p.trim().length > 0).map(p => p.trim()),
  })
}

export async function readMoonSceneMessagesPreferenceOrch(): Promise<
  MoonSceneMessagePreferenceBlock[]
> {
  const preferences = await readVaultUiPreferencesOrch()
  return preferences.moonSceneMessages
}

export async function setMoonSceneMessagesPreferenceOrch(
  messages: MoonSceneMessagePreferenceBlock[],
): Promise<VaultUiPreferencesBlock> {
  const saved = await updateVaultUiPreferencesOrch({
    moonSceneMessages: normalizeMoonSceneMessagesPreferenceBlock(messages),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK))
  }
  return saved
}

export async function setMoonSceneIdleAnimationsEnabledOrch(
  enabled: boolean,
): Promise<VaultUiPreferencesBlock> {
  const saved = await updateVaultUiPreferencesOrch({ moonSceneIdleAnimationsEnabled: enabled })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK))
  }
  return saved
}

export async function setSchedulerTasksPreferenceOrch(
  tasks: VaultSchedulerTaskPreferenceBlock[],
): Promise<VaultUiPreferencesBlock> {
  return updateVaultUiPreferencesOrch({ schedulerTasks: tasks })
}

export type { VaultSchedulerTaskPreferenceBlock }

// ── AI-activity prefs roaming (added 2026-07-19) ──
//
// The AI-activity display prefs live in localStorage (storageKeyBlock
// getters/setters — synchronous reads everywhere). This wiring mirrors them
// through ui.json so they carry across devices, reusing this orchestrator's
// existing read-merge-write:
// - startup PULL: vault values (non-null) overwrite local, via the public
//   setters so their change events fire and mounted UI updates live.
// - write-through PUSH: local setter writes (storageKeyBlock's write
//   listener) schedule a debounced snapshot push into ui.json.

const AI_ACTIVITY_ROAMING_STORAGE_KEYS_ORCH = new Set<string>([
  STORAGE_KEYS.aiActivityHomePostItEnabled,
  STORAGE_KEYS.aiActivitySetMode,
  STORAGE_KEYS.aiActivityCalendarMode,
  STORAGE_KEYS.aiActivityAiTitlesEnabled,
  STORAGE_KEYS.aiActivityRestDays,
  STORAGE_KEYS.goodnotesReadingEnabled,
  STORAGE_KEYS.goodnotesReadingAnnotationGate,
])

function snapshotLocalAiActivityPrefsOrch(): AiActivityRoamingPrefsBlock {
  return {
    homePostItEnabled: getAiActivityHomePostItEnabled(),
    setMode: getAiActivitySetMode(),
    calendarMode: getAiActivityCalendarMode(),
    aiTitlesEnabled: getAiActivityAiTitlesEnabled(),
    restDays: getAiActivityRestDays(),
    goodnotesReadingEnabled: getGoodnotesReadingEnabled(),
    goodnotesAnnotationGate: getGoodnotesAnnotationGate(),
  }
}

let applyingRoamingPullOrch = false
let roamingPushTimerOrch: ReturnType<typeof setTimeout> | null = null

function scheduleAiActivityPrefsPushOrch(): void {
  if (roamingPushTimerOrch !== null) clearTimeout(roamingPushTimerOrch)
  roamingPushTimerOrch = setTimeout(() => {
    roamingPushTimerOrch = null
    void updateVaultUiPreferencesOrch({
      aiActivityPrefs: snapshotLocalAiActivityPrefsOrch(),
    }).catch((error: unknown) => {
      console.warn('[vaultUiPreferencesOrch] AI-activity prefs push failed:', error)
    })
  }, 1500)
}

function applyRoamedAiActivityPrefsOrch(prefs: AiActivityRoamingPrefsBlock): void {
  applyingRoamingPullOrch = true
  try {
    if (prefs.homePostItEnabled !== null && prefs.homePostItEnabled !== getAiActivityHomePostItEnabled()) {
      setAiActivityHomePostItEnabled(prefs.homePostItEnabled)
    }
    if (prefs.setMode !== null && prefs.setMode !== getAiActivitySetMode()) {
      setAiActivitySetMode(prefs.setMode)
    }
    if (prefs.calendarMode !== null && prefs.calendarMode !== getAiActivityCalendarMode()) {
      setAiActivityCalendarMode(prefs.calendarMode)
    }
    if (prefs.aiTitlesEnabled !== null && prefs.aiTitlesEnabled !== getAiActivityAiTitlesEnabled()) {
      setAiActivityAiTitlesEnabled(prefs.aiTitlesEnabled)
    }
    if (prefs.restDays !== null && JSON.stringify(prefs.restDays) !== JSON.stringify(getAiActivityRestDays())) {
      setAiActivityRestDays(prefs.restDays)
    }
    if (prefs.goodnotesReadingEnabled !== null && prefs.goodnotesReadingEnabled !== getGoodnotesReadingEnabled()) {
      setGoodnotesReadingEnabled(prefs.goodnotesReadingEnabled)
    }
    if (prefs.goodnotesAnnotationGate !== null && prefs.goodnotesAnnotationGate !== getGoodnotesAnnotationGate()) {
      setGoodnotesAnnotationGate(prefs.goodnotesAnnotationGate)
    }
  } finally {
    applyingRoamingPullOrch = false
  }
}

/**
 * Install roaming for the AI-activity prefs: one startup pull from ui.json,
 * then write-through pushes on local changes. Idempotent per app session.
 */
export async function initAiActivityPrefsRoamingOrch(): Promise<void> {
  registerStorageWriteListenerBlock((key) => {
    if (applyingRoamingPullOrch) return
    if (!AI_ACTIVITY_ROAMING_STORAGE_KEYS_ORCH.has(key)) return
    scheduleAiActivityPrefsPushOrch()
  })

  if (!getStoredVaultRoot()?.trim()) return
  try {
    const preferences = await readVaultUiPreferencesOrch()
    applyRoamedAiActivityPrefsOrch(preferences.aiActivityPrefs)
  } catch (error) {
    console.warn('[vaultUiPreferencesOrch] AI-activity prefs pull failed:', error)
  }
}
