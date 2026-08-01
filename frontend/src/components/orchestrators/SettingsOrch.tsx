import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  dispatchSettingsSidebarChromeStateBlock,
  SETTINGS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK,
} from '@/services/lego_blocks/units/settingsSidebarChromeBlock'
import {
  SETTINGS_CONTROL_CLASS_BLOCK,
  SETTINGS_PANE_WIDTH_BLOCK,
  SettingsGroupBlock,
  SettingsRowBlock,
  SettingsSectionHeaderBlock,
} from '@/components/lego_blocks/units/SettingsGroupBlock'
import { WorkspaceProfilesSettingsBlock } from '@/components/lego_blocks/integrations/WorkspaceProfilesSettingsBlock'
import { NavRailSettingsBlock } from '@/components/lego_blocks/integrations/NavRailSettingsBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import AiSettingsOrch from '@/components/orchestrators/AiSettingsOrch'
import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { UI_COLOR_MODE_OPTIONS_BLOCK, UI_THEME_OPTIONS_BLOCK, useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { USER_PROFILE_FILE_PATH_BLOCK, deriveUserProfileSymbolBlock } from '@/services/lego_blocks/units/userProfileBlock'
import { clearAppCacheOrch, hardRefreshOrch } from '@/services/orchestrators/appCacheOrch'
import { backfillVaultUuidsOrch } from '@/services/orchestrators/vaultIndexBackfillOrch'
import {
  readMarkdownEditorSettingsOrch,
  writeMarkdownEditorSettingsOrch,
  type MarkdownEditorSettingsBlock,
} from '@/services/orchestrators/markdownEditorSettingsOrch'
import {
  getNextScheduledTaskRunAtOrch,
  SCHEDULED_TASK_ACTION_OPTIONS_BLOCK,
  type SchedulerSettingsBlock,
  type ScheduledTaskBlock,
} from '@/services/orchestrators/schedulerSettingsOrch'
import { isCapacitorNative, isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  getDefaultWebullExecutionSettingsOrch,
  readWebullExecutionSettingsOrch,
  writeWebullExecutionSettingsOrch,
} from '@/personal_extension/services/orchestrators/webullExecutionSettingsOrch'
import {
  clearWebullCredentialsBlock,
  readWebullCredentialStatusBlock,
  saveWebullCredentialsBlock,
} from '@/personal_extension/services/lego_blocks/units/webullConfigBlock'
import { deriveDefaultWebullSimRootBlock } from '@/personal_extension/services/orchestrators/webullSimOrch'
import {
  clearGoogleDriveAuthOrch,
  connectGoogleDriveAuthOrch,
  getGoogleOauthClientIdOrch,
  readGoogleDriveAuthOrch,
  setGoogleOauthClientIdOrch,
} from '@/services/orchestrators/googleDriveAuthOrch'
import {
  DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK,
  DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK,
  readVaultUiPreferencesOrch,
  setMoonSceneIdleAnimationsEnabledOrch,
  setMoonSceneMessagesPreferenceOrch,
  setShowDailyHighlightsPreferenceOrch,
  setWebullSimTabEnabledPreferenceOrch,
  setWebullSimFolderPathPreferenceOrch,
  type ExplorerFolderColorPreferenceBlock,
  type ExplorerIconStyleBlock,
  type MoonSceneMessagePreferenceBlock,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import { MOON_SCENE_ANIMATION_IDS_BLOCK } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'
import {
  addRssFeedOrch,
  addRssFeedGroupOrch,
  getRssRetentionDaysOrch,
  readRssFeedPreferencesOrch,
  removeRssFeedOrch,
  removeRssFeedGroupOrch,
  setRssRetentionDaysOrch,
  updateRssFeedOrch,
  updateRssFeedGroupOrch,
  updateRssPresetTagsOrch,
} from '@/services/orchestrators/rssFeedOrch'
import type { RssFeedPreferencesBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import {
  splitTagInputBlock,
  tagColorClassBlock,
  tagColorStyleBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import {
  addAiWebsiteOrch,
  readAiWebsitesOrch,
  removeAiWebsiteOrch,
  updateAiWebsiteOrch,
} from '@/services/orchestrators/aiWebsiteOrch'
import type { AiWebsiteBlock } from '@/services/lego_blocks/units/aiWebsiteBlock'
import AiActivityProjectMappingSettingsBlock from '@/components/lego_blocks/integrations/AiActivityProjectMappingSettingsBlock'
import AiActivitySessionSourcesSettingsBlock from '@/components/lego_blocks/integrations/AiActivitySessionSourcesSettingsBlock'
import AiActivityHomePostItSettingsBlock from '@/components/lego_blocks/integrations/AiActivityHomePostItSettingsBlock'
import AiActivitySetModeSettingsBlock from '@/components/lego_blocks/integrations/AiActivitySetModeSettingsBlock'
import AiActivityCalendarModeSettingsBlock from '@/components/lego_blocks/integrations/AiActivityCalendarModeSettingsBlock'
import AiActivityAiTitlesSettingsBlock from '@/components/lego_blocks/integrations/AiActivityAiTitlesSettingsBlock'
import AiActivityRangeSummaryProviderSettingsBlock from '@/components/lego_blocks/integrations/AiActivityRangeSummaryProviderSettingsBlock'
import AiActivityRestDaysSettingsBlock from '@/components/lego_blocks/integrations/AiActivityRestDaysSettingsBlock'
import {
  addWebSiteOrch,
  addWebSiteGroupOrch,
  readWebSitePreferencesOrch,
  removeWebSiteOrch,
  removeWebSiteGroupOrch,
  updateWebSiteOrch,
  updateWebSiteGroupOrch,
} from '@/services/orchestrators/webSiteOrch'
import type { WebSitePreferencesBlock } from '@/services/lego_blocks/units/webSiteBlock'
import DeveloperSetupBlock from '@/components/lego_blocks/integrations/DeveloperSetupBlock'
import ProjectsSettingsBlock from '@/components/lego_blocks/integrations/ProjectsSettingsBlock'
import {
  getReadingKeepScreenAwake,
  setReadingKeepScreenAwake,
} from '@/services/lego_blocks/units/storageKeyBlock'
import { readFileActivityIgnoredPaths, writeFileActivityIgnoredPaths } from '@/services/orchestrators/fileActivityOrch'
import { setFileActivityIgnoredPathsOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'
import {
  getCapabilityFeatureFlags,
  setCapabilityFeatureFlag,
} from '@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock'
import {
  isConsoleWarningsVisible,
  setConsoleWarningsVisible,
} from '@/services/lego_blocks/units/consoleNoiseFilterBlock'

export type SettingsTabId = 'workspace_profiles' | 'navigation' | 'theme' | 'explorer' | 'moon_scene' | 'activity' | 'ai_activity' | 'scheduler' | 'ai' | 'ai_websites' | 'web_bookmarks' | 'google_docs_sheets' | 'webull' | 'rss' | 'cache' | 'vault' | 'about' | 'developer' | 'projects'
export type SettingsTabWithProfileId = SettingsTabId | 'profile'

interface SettingsOrchProps {
  explorerIconStyle: ExplorerIconStyleBlock
  onExplorerIconStyleChange: (nextStyle: ExplorerIconStyleBlock) => void
  explorerFolderColorRules: ExplorerFolderColorPreferenceBlock[]
  onExplorerFolderColorRulesChange: (nextRules: ExplorerFolderColorPreferenceBlock[]) => Promise<void> | void
  explorerSelectedColor: string
  onExplorerSelectedColorChange: (nextColor: string) => void
  schedulerSettings: SchedulerSettingsBlock
  onSchedulerSettingsChange: (nextSettings: SchedulerSettingsBlock) => Promise<void> | void
  onRequestVaultSwitch: () => void
  initialTab?: SettingsTabWithProfileId
  webullTabLabel?: string
  webullTabIconText?: string
  onWebullTabPreferencesChange?: (label: string, iconText: string) => Promise<void> | void
}

function createExplorerColorRuleId(): string {
  return `explorer-color-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createMoonSceneMessageId(): string {
  return `moon-scene-message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const MOON_SCENE_SPEAKER_OPTIONS = [
  { id: 'astronaut', label: 'Astronaut' },
  { id: 'clawd', label: 'Clawd' },
] as const

const MOON_SCENE_ANIMATION_LABELS: Record<string, string> = {
  none: 'None (idle)',
  wave: 'Wave',
  dance: 'Dance',
  hop: 'Hop',
  cheer: 'Cheer',
  spin: 'Spin',
  skate: 'Skateboard',
  wizard: 'Wizard',
  run: 'Run around',
  float: 'Float',
  sleep: 'Sleep (zzz)',
  hang: 'Coping hang (upside down)',
  wag: 'Tail-wag walk',
  nod: 'Nod',
  wobble: 'Wobble',
  stretch: 'Stretch',
  backflip: 'Backflip',
}

function normalizeExplorerFolderPathInput(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function createExplorerRuleKey(rule: Pick<ExplorerFolderColorPreferenceBlock, 'folderPath' | 'includeDescendants'>): string {
  return `${normalizeExplorerFolderPathInput(rule.folderPath)}::${rule.includeDescendants ? 'all' : 'single'}`
}

const TAB_GROUPS: Array<{ heading: string; items: Array<{ id: SettingsTabWithProfileId; label: string }> }> = [
  {
    heading: 'Workspace',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'projects', label: 'Projects' },
      { id: 'vault', label: 'Select Thinking Space' },
      { id: 'workspace_profiles', label: 'Thinking Space Profiles' },
    ],
  },
  {
    heading: 'Appearance',
    items: [
      { id: 'theme', label: 'Theme' },
      { id: 'navigation', label: 'Navigation' },
      { id: 'explorer', label: 'Explorer' },
      { id: 'moon_scene', label: 'Moon Scene' },
    ],
  },
  {
    heading: 'Productivity',
    items: [
      { id: 'activity', label: 'Activity Tracker' },
      { id: 'ai_activity', label: 'AI Activity' },
      { id: 'scheduler', label: 'Scheduler' },
    ],
  },
  {
    heading: 'AI',
    items: [
      { id: 'ai', label: 'AI' },
      { id: 'ai_websites', label: 'AI Websites' },
    ],
  },
  {
    heading: 'Content',
    items: [
      { id: 'web_bookmarks', label: 'Web' },
      { id: 'google_docs_sheets', label: 'Google Docs and Sheets' },
      { id: 'rss', label: 'RSS Feeds' },
    ],
  },
  {
    heading: 'Integrations',
    items: [
      { id: 'webull', label: 'Webull' },
    ],
  },
  {
    heading: 'System',
    items: [
      { id: 'cache', label: 'Index & Cache' },
      { id: 'about', label: 'About' },
      { id: 'developer', label: 'Developer' },
    ],
  },
]

function sanitizeTimeInputBlock(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null
  const [h, m] = trimmed.split(':').map(Number)
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export default function SettingsOrch({
  explorerIconStyle,
  onExplorerIconStyleChange,
  explorerFolderColorRules,
  onExplorerFolderColorRulesChange,
  explorerSelectedColor,
  onExplorerSelectedColorChange,
  schedulerSettings,
  onSchedulerSettingsChange,
  onRequestVaultSwitch,
  initialTab = 'theme',
  webullTabLabel: webullTabLabelProp = 'Webull',
  webullTabIconText: webullTabIconTextProp = '',
  onWebullTabPreferencesChange,
}: SettingsOrchProps) {
  const { profile, loading: profileLoading, saveProfile, reloadProfile } = useUserProfileBlock()
  const { colorModeId, setColorModeId, themeId, setThemeId } = useUIThemeBlock()
  const [activeTab, setActiveTab] = useState<SettingsTabWithProfileId>(initialTab)
  const [markdownEditorSettings, setMarkdownEditorSettings] = useState<MarkdownEditorSettingsBlock>(
    () => readMarkdownEditorSettingsOrch(),
  )
  const [readingKeepScreenAwake, setReadingKeepScreenAwakeState] = useState(getReadingKeepScreenAwake)
  const [showDailyHighlights, setShowDailyHighlights] = useState(false)
  const [moonSceneMessagesSaved, setMoonSceneMessagesSaved] = useState<MoonSceneMessagePreferenceBlock[]>([])
  const [moonSceneMessagesDraft, setMoonSceneMessagesDraft] = useState<MoonSceneMessagePreferenceBlock[]>([])
  const [moonSceneMessagesDirty, setMoonSceneMessagesDirty] = useState(false)
  const [moonSceneIdleAnimationsEnabled, setMoonSceneIdleAnimationsEnabled] = useState(true)
  const [webullSimTabEnabled, setWebullSimTabEnabled] = useState(false)
  const [webullSimFolderPathInput, setWebullSimFolderPathInput] = useState('')
  const [webullSavedSimFolderPath, setWebullSavedSimFolderPath] = useState('')
  useEffect(() => {
    let cancelled = false
    void readVaultUiPreferencesOrch()
      .then(prefs => {
        if (cancelled) return
        setShowDailyHighlights(prefs.showDailyHighlights)
        setMoonSceneMessagesSaved(prefs.moonSceneMessages)
        setMoonSceneMessagesDraft(prefs.moonSceneMessages)
        setMoonSceneIdleAnimationsEnabled(prefs.moonSceneIdleAnimationsEnabled)
        setWebullSimTabEnabled(prefs.webullSimTabEnabled)
        setWebullSimFolderPathInput(prefs.webullSimFolderPath)
        setWebullSavedSimFolderPath(prefs.webullSimFolderPath)
      })
      .catch(() => {
        /* leave default */
      })
    return () => {
      cancelled = true
    }
  }, [])
  const updateShowDailyHighlights = (next: boolean) => {
    setShowDailyHighlights(next)
    void setShowDailyHighlightsPreferenceOrch(next).catch(err => {
      console.warn('[settings] failed to persist showDailyHighlights:', err)
    })
  }
  const updateWebullSimTabEnabled = (next: boolean) => {
    setWebullSimTabEnabled(next)
    void setWebullSimTabEnabledPreferenceOrch(next).catch(err => {
      console.warn('[settings] failed to persist webullSimTabEnabled:', err)
    })
  }
  const onSaveWebullSimFolderPath = async () => {
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      const saved = await setWebullSimFolderPathPreferenceOrch(webullSimFolderPathInput)
      setWebullSimFolderPathInput(saved.webullSimFolderPath)
      setWebullSavedSimFolderPath(saved.webullSimFolderPath)
      setMessage(saved.webullSimFolderPath
        ? 'Sim folder path saved.'
        : 'Sim folder path cleared. The Sim tab now uses the default sibling folder beside the execution folder.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the Sim folder path.')
    } finally {
      setBusyAction(null)
    }
  }
  const [schedulerSettingsDraft, setSchedulerSettingsDraft] = useState<SchedulerSettingsBlock>(() => schedulerSettings)
  const [schedulerDirty, setSchedulerDirty] = useState(false)
  const [schedulerNewTimeByTaskId, setSchedulerNewTimeByTaskId] = useState<Record<string, string>>({})
  const [webullExecutionFolderPathInput, setWebullExecutionFolderPathInput] = useState<string>('')
  const [webullSavedExecutionFolderPath, setWebullSavedExecutionFolderPath] = useState<string>('')
  const [webullAppKeyInput, setWebullAppKeyInput] = useState('')
  const [webullAppSecretInput, setWebullAppSecretInput] = useState('')
  const [webullCredentialsConfigured, setWebullCredentialsConfigured] = useState(false)
  const [webullAppKeyHint, setWebullAppKeyHint] = useState<string | null>(null)
  const [webullSecureStorageAvailable, setWebullSecureStorageAvailable] = useState(false)
  const [webullTabLabelInput, setWebullTabLabelInput] = useState(webullTabLabelProp)
  const [webullTabIconTextInput, setWebullTabIconTextInput] = useState(webullTabIconTextProp)
  const [googleOauthClientIdInput, setGoogleOauthClientIdInput] = useState(() => getGoogleOauthClientIdOrch() ?? '')
  const [googleDriveConnected, setGoogleDriveConnected] = useState(() => Boolean(readGoogleDriveAuthOrch()?.accessToken))
  const [googleDriveAuthBusy, setGoogleDriveAuthBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<SettingsTabId | null>(null)
  const [busyGpuCache, setBusyGpuCache] = useState(false)
  const [busyUuidBackfill, setBusyUuidBackfill] = useState(false)
  const [explorerFolderColorRulesDraft, setExplorerFolderColorRulesDraft] = useState<ExplorerFolderColorPreferenceBlock[]>(
    () => explorerFolderColorRules,
  )
  const [explorerRulesDirty, setExplorerRulesDirty] = useState(false)
  const [profileNameInput, setProfileNameInput] = useState('')
  const [profileSymbolInput, setProfileSymbolInput] = useState('')
  const [profileMemoriesInput, setProfileMemoriesInput] = useState('')
  const [profileDirty, setProfileDirty] = useState(false)
  const [busyProfileSave, setBusyProfileSave] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activityIgnoredPaths, setActivityIgnoredPaths] = useState<string[]>(() => readFileActivityIgnoredPaths())
  const [activityNewPathInput, setActivityNewPathInput] = useState('')
  const [activityDirty, setActivityDirty] = useState(false)
  const [yamlFieldsAutoHealEnabled, setYamlFieldsAutoHealEnabled] = useState(
    () => getCapabilityFeatureFlags().yaml_fields_auto_heal_enabled,
  )
  const [consoleWarningsVisible, setConsoleWarningsVisibleState] = useState(
    () => isConsoleWarningsVisible(),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('settings_sidebar_collapsed') === '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('settings_sidebar_collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    dispatchSettingsSidebarChromeStateBlock({
      enabled: true,
      collapsed: sidebarCollapsed,
      label: 'Settings',
    })
    return () => {
      dispatchSettingsSidebarChromeStateBlock({
        enabled: false,
        collapsed: false,
        label: 'Settings',
      })
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const handler = () => setSidebarCollapsed(prev => !prev)
    window.addEventListener(SETTINGS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(SETTINGS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
  }, [])

  const handleActivityAddPath = useCallback(() => {
    const trimmed = activityNewPathInput.trim()
    if (!trimmed || activityIgnoredPaths.includes(trimmed)) return
    setActivityIgnoredPaths(prev => [...prev, trimmed])
    setActivityNewPathInput('')
    setActivityDirty(true)
  }, [activityNewPathInput, activityIgnoredPaths])

  const handleActivityRemovePath = useCallback((path: string) => {
    setActivityIgnoredPaths(prev => prev.filter(p => p !== path))
    setActivityDirty(true)
  }, [])

  const handleActivitySave = useCallback(async () => {
    setBusyAction('activity')
    writeFileActivityIgnoredPaths(activityIgnoredPaths)
    // Persist to vault for cross-device sync
    await setFileActivityIgnoredPathsOrch(activityIgnoredPaths)
    setActivityDirty(false)
    setBusyAction(null)
  }, [activityIgnoredPaths])

  const runtimeLabel = useMemo(() => {
    if (isElectron()) return 'desktop'
    if (isCapacitorNative()) return 'mobile'
    return 'web'
  }, [])
  const webullCredentialEditingSupported = isElectron()
  const schedulerActionOptionById = useMemo(
    () => new Map(SCHEDULED_TASK_ACTION_OPTIONS_BLOCK.map((option) => [option.id, option])),
    [],
  )
  const schedulerNextRunByTaskId = useMemo(() => Object.fromEntries(
    schedulerSettingsDraft.tasks.map((task) => [task.id, getNextScheduledTaskRunAtOrch(task)]),
  ), [schedulerSettingsDraft])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    setWebullTabLabelInput(webullTabLabelProp)
    setWebullTabIconTextInput(webullTabIconTextProp)
  }, [webullTabLabelProp, webullTabIconTextProp])

  useEffect(() => {
    setSchedulerSettingsDraft(schedulerSettings)
    setSchedulerDirty(false)
  }, [schedulerSettings])

  useEffect(() => {
    let cancelled = false
    if (activeTab !== 'webull') return
    void readWebullCredentialStatusBlock()
      .then((status) => {
        if (cancelled) return
        setWebullCredentialsConfigured(status.configured)
        setWebullAppKeyHint(status.appKeyHint)
        setWebullSecureStorageAvailable(status.secureStorageAvailable)
      })
      .catch(() => {
        if (cancelled) return
        setWebullCredentialsConfigured(false)
        setWebullAppKeyHint(null)
        setWebullSecureStorageAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab])

  useEffect(() => {
    setProfileNameInput(profile.name)
    setProfileSymbolInput(profile.symbol)
    setProfileMemoriesInput(profile.memories.join('\n'))
    setProfileDirty(false)
  }, [profile])

  useEffect(() => {
    setExplorerFolderColorRulesDraft(explorerFolderColorRules)
    setExplorerRulesDirty(false)
  }, [explorerFolderColorRules])

  useEffect(() => {
    let cancelled = false
    void readWebullExecutionSettingsOrch()
      .then((settings) => {
        if (cancelled) return
        setWebullExecutionFolderPathInput(settings.executionFolderPath)
        setWebullSavedExecutionFolderPath(settings.executionFolderPath)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load Webull settings')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSaveProfile = async () => {
    const normalizedName = profileNameInput.trim()
    if (!normalizedName) {
      setError('Profile name cannot be empty.')
      return
    }
    const memories = profileMemoriesInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    setBusyProfileSave(true)
    setError(null)
    setMessage(null)
    try {
      await saveProfile({
        name: normalizedName,
        symbol: profileSymbolInput.trim(),
        memories,
      })
      setMessage('Profile saved.')
      setProfileDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setBusyProfileSave(false)
    }
  }

  const onReloadProfile = async () => {
    setBusyProfileSave(true)
    setError(null)
    setMessage(null)
    try {
      await reloadProfile()
      setMessage('Profile reloaded from Thinking Space.')
      setProfileDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload profile')
    } finally {
      setBusyProfileSave(false)
    }
  }

  const onClearCache = async () => {
    const confirmed = window.confirm('Clear local cache and reload the app now?')
    if (!confirmed) return
    setBusyAction('cache')
    setError(null)
    setMessage(null)
    try {
      await clearAppCacheOrch({ preserveVaultRoot: true })
      hardRefreshOrch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache')
    } finally {
      setBusyAction(null)
    }
  }

  const onClearGpuCache = async () => {
    const confirmed = window.confirm(
      'Clear GPU cache and restart the app? Useful for fixing render glitches and stale shader artifacts.',
    )
    if (!confirmed) return
    setBusyGpuCache(true)
    setError(null)
    setMessage(null)
    try {
      const api = window.electronAPI
      if (!api?.clearGpuCache) {
        throw new Error('GPU cache clearing is only available in the desktop app.')
      }
      await api.clearGpuCache()
      // App is relaunching — no further state updates needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear GPU cache')
      setBusyGpuCache(false)
    }
  }

  const onBackfillUuids = async () => {
    const confirmed = window.confirm(
      'Stamp a Thinking Space uuid into every note that has frontmatter but no uuid? '
        + 'This edits files in place (one line added) and re-indexes. Nothing is reformatted.',
    )
    if (!confirmed) return
    setBusyUuidBackfill(true)
    setError(null)
    setMessage(null)
    try {
      const r = await backfillVaultUuidsOrch()
      const parts = [`Stamped ${r.stamped} of ${r.candidates} notes`,
        `${r.alreadyHadUuid} already had a uuid`,
        `${r.scanned} scanned`]
      if (r.failed > 0) parts.push(`${r.failed} failed`)
      setMessage(`${parts.join(', ')}.${r.stamped > 0 ? ' Index rebuilt.' : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to backfill uuids')
    } finally {
      setBusyUuidBackfill(false)
    }
  }

  const onSwitchVault = () => {
    const confirmed = window.confirm('Open Thinking Space folder selector and reload after selection?')
    if (!confirmed) return
    setError(null)
    setMessage('Opening Thinking Space selector...')
    onRequestVaultSwitch()
  }

  const updateMarkdownEditorSettings = (nextSettings: MarkdownEditorSettingsBlock) => {
    setMarkdownEditorSettings(nextSettings)
    writeMarkdownEditorSettingsOrch(nextSettings)
  }

  const onUpdateScheduledTask = (taskId: string, patch: Partial<ScheduledTaskBlock>) => {
    setSchedulerSettingsDraft((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => (
        task.id === taskId ? { ...task, ...patch } : task
      )),
    }))
    setSchedulerDirty(true)
    setMessage(null)
    setError(null)
  }

  const onAddScheduledTime = (taskId: string, time: string) => {
    const sanitized = sanitizeTimeInputBlock(time)
    if (!sanitized) return
    setSchedulerSettingsDraft(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        if (t.timesOfDay.includes(sanitized)) return t
        return { ...t, timesOfDay: [...t.timesOfDay, sanitized].sort() }
      }),
    }))
    setSchedulerDirty(true)
    setMessage(null)
    setError(null)
  }

  const onRemoveScheduledTime = (taskId: string, time: string) => {
    setSchedulerSettingsDraft(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        const next = t.timesOfDay.filter(tod => tod !== time)
        return { ...t, timesOfDay: next.length > 0 ? next : t.timesOfDay }
      }),
    }))
    setSchedulerDirty(true)
    setMessage(null)
    setError(null)
  }

  const onResetSchedulerSettings = () => {
    setSchedulerSettingsDraft(schedulerSettings)
    setSchedulerDirty(false)
    setMessage('Scheduler settings reset to saved values.')
    setError(null)
  }

  const onSaveSchedulerSettings = async () => {
    setBusyAction('scheduler')
    setError(null)
    setMessage(null)
    try {
      await onSchedulerSettingsChange(schedulerSettingsDraft)
      setSchedulerDirty(false)
      setMessage('Scheduler settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scheduler settings')
    } finally {
      setBusyAction(null)
    }
  }

  const onSaveWebullTabPreferences = async () => {
    if (!onWebullTabPreferencesChange) return
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      await onWebullTabPreferencesChange(webullTabLabelInput, webullTabIconTextInput)
      setMessage('Tab label and icon saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tab preferences')
    } finally {
      setBusyAction(null)
    }
  }

  const onSaveWebullSettings = async () => {
    const normalized = webullExecutionFolderPathInput.trim()
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      const saved = await writeWebullExecutionSettingsOrch({ executionFolderPath: normalized })
      setWebullExecutionFolderPathInput(saved.executionFolderPath)
      setWebullSavedExecutionFolderPath(saved.executionFolderPath)
      setMessage(saved.executionFolderPath
        ? 'Webull execution folder path saved.'
        : 'Webull execution folder path cleared. Execution file sync is disabled until a path is set.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Webull settings')
    } finally {
      setBusyAction(null)
    }
  }

  const onResetWebullSettings = async () => {
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      const defaults = getDefaultWebullExecutionSettingsOrch()
      const saved = await writeWebullExecutionSettingsOrch(defaults)
      setWebullExecutionFolderPathInput(saved.executionFolderPath)
      setWebullSavedExecutionFolderPath(saved.executionFolderPath)
      setMessage('Webull execution folder path reset to default (not configured).')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset Webull settings')
    } finally {
      setBusyAction(null)
    }
  }

  const onSaveWebullCredentials = async () => {
    if (!webullCredentialEditingSupported) {
      setError('Webull secure credentials are currently supported only in Electron desktop runtime.')
      return
    }
    const appKey = webullAppKeyInput.trim()
    const appSecret = webullAppSecretInput.trim()
    if (!appKey) {
      setError('Webull app key cannot be empty.')
      return
    }
    if (!appSecret) {
      setError('Webull app secret cannot be empty.')
      return
    }
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      const status = await saveWebullCredentialsBlock({ appKey, appSecret })
      setWebullCredentialsConfigured(status.configured)
      setWebullAppKeyHint(status.appKeyHint)
      setWebullSecureStorageAvailable(status.secureStorageAvailable)
      setWebullAppSecretInput('')
      setMessage('Webull credentials saved to secure device storage.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Webull credentials')
    } finally {
      setBusyAction(null)
    }
  }

  const refreshGoogleDriveAuthState = () => {
    setGoogleDriveConnected(Boolean(readGoogleDriveAuthOrch()?.accessToken))
  }

  const onSaveGoogleOauthClientId = () => {
    setError(null)
    setMessage(null)
    const normalized = googleOauthClientIdInput.trim()
    setGoogleOauthClientIdOrch(normalized)
    setMessage(normalized ? 'Google OAuth client ID saved.' : 'Google OAuth client ID cleared.')
  }

  const onConnectGoogleDrive = async () => {
    const typedClientId = googleOauthClientIdInput.trim()
    const resolvedClientId = typedClientId || getGoogleOauthClientIdOrch() || ''
    if (!resolvedClientId) {
      setError('Google OAuth client ID is required. Add it in this tab before connecting.')
      return
    }
    setGoogleDriveAuthBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (typedClientId) {
        setGoogleOauthClientIdOrch(typedClientId)
      }
      await connectGoogleDriveAuthOrch({ clientId: resolvedClientId })
      refreshGoogleDriveAuthState()
      setMessage('Google Drive connected.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
      refreshGoogleDriveAuthState()
    } finally {
      setGoogleDriveAuthBusy(false)
    }
  }

  const onDisconnectGoogleDrive = () => {
    setError(null)
    setMessage(null)
    clearGoogleDriveAuthOrch()
    refreshGoogleDriveAuthState()
    setMessage('Google Drive disconnected.')
  }

  const onClearWebullCredentials = async () => {
    if (!webullCredentialEditingSupported) {
      setError('Webull secure credentials are currently supported only in Electron desktop runtime.')
      return
    }
    setBusyAction('webull')
    setError(null)
    setMessage(null)
    try {
      const status = await clearWebullCredentialsBlock()
      setWebullCredentialsConfigured(status.configured)
      setWebullAppKeyHint(status.appKeyHint)
      setWebullSecureStorageAvailable(status.secureStorageAvailable)
      setWebullAppKeyInput('')
      setWebullAppSecretInput('')
      setMessage('Webull credentials cleared from secure device storage.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear Webull credentials')
    } finally {
      setBusyAction(null)
    }
  }

  const updateMoonSceneIdleAnimationsEnabled = (next: boolean) => {
    setMoonSceneIdleAnimationsEnabled(next)
    void setMoonSceneIdleAnimationsEnabledOrch(next).catch(err => {
      console.warn('[settings] failed to persist moonSceneIdleAnimationsEnabled:', err)
    })
  }

  const onAddMoonSceneMessage = () => {
    setMoonSceneMessagesDraft(prev => [
      ...prev,
      {
        id: createMoonSceneMessageId(),
        speaker: 'clawd',
        text: '',
        startTime: '09:00',
        endTime: '10:00',
        animation: 'wave',
        enabled: true,
      },
    ])
    setMoonSceneMessagesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onUpdateMoonSceneMessage = (
    messageId: string,
    patch: Partial<MoonSceneMessagePreferenceBlock>,
  ) => {
    setMoonSceneMessagesDraft(prev => prev.map(entry => (
      entry.id === messageId ? { ...entry, ...patch } : entry
    )))
    setMoonSceneMessagesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onRemoveMoonSceneMessage = (messageId: string) => {
    setMoonSceneMessagesDraft(prev => prev.filter(entry => entry.id !== messageId))
    setMoonSceneMessagesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onResetMoonSceneMessages = () => {
    setMoonSceneMessagesDraft(moonSceneMessagesSaved)
    setMoonSceneMessagesDirty(false)
    setMessage('Moon scene messages reset to saved values.')
    setError(null)
  }

  const onSaveMoonSceneMessages = async () => {
    const sanitized = moonSceneMessagesDraft
      .map(entry => ({ ...entry, text: entry.text.trim() }))
      .filter(entry => entry.text.length > 0)
    setBusyAction('moon_scene')
    setMessage(null)
    setError(null)
    try {
      const saved = await setMoonSceneMessagesPreferenceOrch(sanitized)
      setMoonSceneMessagesSaved(saved.moonSceneMessages)
      setMoonSceneMessagesDraft(saved.moonSceneMessages)
      setMoonSceneMessagesDirty(false)
      setMessage('Moon scene messages saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save moon scene messages')
    } finally {
      setBusyAction(null)
    }
  }

  const onAddExplorerColorRule = () => {
    setExplorerFolderColorRulesDraft((prev) => [
      ...prev,
      {
        id: createExplorerColorRuleId(),
        folderPath: '',
        color: '#6aaafa',
        includeDescendants: true,
      },
    ])
    setExplorerRulesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onUpdateExplorerColorRule = (
    ruleId: string,
    patch: Partial<ExplorerFolderColorPreferenceBlock>,
  ) => {
    setExplorerFolderColorRulesDraft((prev) => prev.map((rule) => {
      if (rule.id !== ruleId) return rule
      return { ...rule, ...patch }
    }))
    setExplorerRulesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onRemoveExplorerColorRule = (ruleId: string) => {
    setExplorerFolderColorRulesDraft((prev) => prev.filter((rule) => rule.id !== ruleId))
    setExplorerRulesDirty(true)
    setMessage(null)
    setError(null)
  }

  const onResetExplorerColorRules = () => {
    setExplorerFolderColorRulesDraft(explorerFolderColorRules)
    setExplorerRulesDirty(false)
    setMessage('Explorer color rules reset to saved values.')
    setError(null)
  }

  const onLoadLegacyExplorerColorRules = () => {
    setExplorerFolderColorRulesDraft((prev) => {
      const merged = [...prev]
      const indexByKey = new Map<string, number>()
      merged.forEach((rule, index) => {
        indexByKey.set(createExplorerRuleKey(rule), index)
      })
      DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK.forEach((preset) => {
        const key = createExplorerRuleKey(preset)
        const foundIndex = indexByKey.get(key)
        if (foundIndex == null) {
          merged.push({
            ...preset,
          })
          indexByKey.set(key, merged.length - 1)
          return
        }
        merged[foundIndex] = {
          ...merged[foundIndex],
          color: preset.color,
        }
      })
      return merged
    })
    setExplorerRulesDirty(true)
    setMessage('Legacy explorer color preset loaded. Save Explorer Settings to persist.')
    setError(null)
  }

  const onSaveExplorerColorRules = async () => {
    const sanitized = explorerFolderColorRulesDraft
      .map((rule) => ({
        ...rule,
        folderPath: normalizeExplorerFolderPathInput(rule.folderPath),
      }))
      .filter((rule) => rule.folderPath.length > 0)
    setBusyAction('explorer')
    setMessage(null)
    setError(null)
    try {
      await onExplorerFolderColorRulesChange(sanitized)
      setExplorerRulesDirty(false)
      setMessage('Explorer settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save explorer settings')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside
        className={cn(
          'flex flex-col self-stretch bg-background/40 overflow-y-auto overflow-x-hidden overscroll-contain',
          'shrink-0 transition-[width,opacity] duration-200 ease-out',
          sidebarCollapsed
            ? 'w-0 opacity-0 pointer-events-none border-r-0'
            : 'w-[258px] opacity-100 lg:border-r lg:border-border/60',
        )}
      >
        <p className="mb-2 mt-4 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Settings
        </p>
        <nav className="min-h-0 flex-1 px-2 pb-4">
          {TAB_GROUPS.map((group, groupIdx) => (
            <div key={group.heading} className={groupIdx === 0 ? undefined : 'mt-5'}>
              <p className="mb-1 px-2.5 text-[11px] font-medium text-muted-foreground/60">
                {group.heading}
              </p>
              <div className="space-y-0.5">
                {group.items.map(tab => {
                  const active = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'ltm-motion-fast flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                        active
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span className="truncate">{tab.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 space-y-4 min-w-0 px-4 py-6 lg:px-6 overflow-y-auto overscroll-contain">
      {activeTab === 'theme' && (
        <>
          <SettingsSectionHeaderBlock
            title="Theme"
            description="How the app looks: shell chrome, color mode, and how documents are drawn."
          />

          <SettingsGroupBlock heading="Appearance">
            <SettingsRowBlock
              label="Chrome Theme"
              description={UI_THEME_OPTIONS_BLOCK.find((option) => option.id === themeId)?.description}
              control={(
                <select
                  id="ltm-settings-theme-select"
                  value={themeId}
                  onChange={(event) => setThemeId(event.target.value as typeof themeId)}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[140px]')}
                  aria-label="Chrome Theme"
                >
                  {UI_THEME_OPTIONS_BLOCK.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            />
            <SettingsRowBlock
              label="Overall Color Mode"
              description={UI_COLOR_MODE_OPTIONS_BLOCK.find((option) => option.id === colorModeId)?.description}
              control={(
                <select
                  id="ltm-settings-color-mode-select"
                  value={colorModeId}
                  onChange={(event) => setColorModeId(event.target.value as typeof colorModeId)}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[140px]')}
                  aria-label="Overall Color Mode"
                >
                  {UI_COLOR_MODE_OPTIONS_BLOCK.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Markdown Editor"
            description="How markdown is drawn while you read and write. None of these change the file on disk."
          >
            <SettingsRowBlock
              as="label"
              label="Preserve spaces in view mode"
              description="Keeps repeated and trailing spaces visible."
              control={(
                <Switch
                  checked={markdownEditorSettings.preserveSpacesInViewMode}
                  onCheckedChange={(checked) => updateMarkdownEditorSettings({
                    ...markdownEditorSettings,
                    preserveSpacesInViewMode: checked,
                  })}
                  aria-label="Preserve spaces in view mode"
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              label="Preserve new lines in view mode"
              description="Renders soft line breaks as visible line breaks."
              control={(
                <Switch
                  checked={markdownEditorSettings.preserveNewlinesInViewMode}
                  onCheckedChange={(checked) => updateMarkdownEditorSettings({
                    ...markdownEditorSettings,
                    preserveNewlinesInViewMode: checked,
                  })}
                  aria-label="Preserve new lines in view mode"
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              label="Live preview while editing"
              description="Headings, bold, and links render as a document; the line under your cursor shows its raw markdown. Off gives the plain typewriter feel."
              control={(
                <Switch
                  checked={markdownEditorSettings.livePreviewSyntaxHiding}
                  onCheckedChange={(checked) => updateMarkdownEditorSettings({
                    ...markdownEditorSettings,
                    livePreviewSyntaxHiding: checked,
                  })}
                  aria-label="Live preview while editing"
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              label="Keep the screen on while reading"
              description="Stops the display dimming while a document is open for reading, even in Low Power Mode. Editing, other screens, and the background all release it immediately."
              control={(
                <Switch
                  checked={readingKeepScreenAwake}
                  onCheckedChange={(checked) => {
                    setReadingKeepScreenAwake(checked)
                    setReadingKeepScreenAwakeState(checked)
                  }}
                  aria-label="Keep the screen on while reading"
                />
              )}
            />
            <SettingsRowBlock
              label="Document font"
              description="Applies to reading and editing alike — Mono recreates the typewriter feel."
              control={(
                <>
                  <select
                    value={markdownEditorSettings.documentFontFamily}
                    onChange={(event) => updateMarkdownEditorSettings({
                      ...markdownEditorSettings,
                      documentFontFamily: event.target.value as MarkdownEditorSettingsBlock['documentFontFamily'],
                    })}
                    className={SETTINGS_CONTROL_CLASS_BLOCK}
                    aria-label="Document font family"
                  >
                    <option value="sans">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                  <input
                    type="number"
                    min={12}
                    max={24}
                    value={markdownEditorSettings.documentFontSizePx}
                    onChange={(event) => updateMarkdownEditorSettings({
                      ...markdownEditorSettings,
                      documentFontSizePx: Number(event.target.value),
                    })}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-16')}
                    aria-label="Document font size in pixels"
                  />
                  <span className="text-[12px] text-muted-foreground">px</span>
                </>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Home dashboard"
            footnote={'Needs daily insight notes and memorization sessions to be meaningful — off by default.'}
          >
            <SettingsRowBlock
              as="label"
              label="Show daily insight & memorization tiles"
              description={'Adds "Insights today" / "Memorized today" counters plus most-recent rows.'}
              control={(
                <Switch
                  checked={showDailyHighlights}
                  onCheckedChange={updateShowDailyHighlights}
                  aria-label="Show daily insight and memorization tiles"
                />
              )}
            />
          </SettingsGroupBlock>
        </>
      )}

      {activeTab === 'explorer' && (
        <>
          <SettingsSectionHeaderBlock
            title="Explorer"
            description="Icon style and folder colors for the file tree. Saved in your Thinking Space UI preferences."
          />

          <SettingsGroupBlock heading="Appearance">
            <SettingsRowBlock
              label="Icon style"
              description="Outline reads lighter; filled reads denser."
              control={(
                <select
                  id="ltm-settings-explorer-icon-style-select"
                  value={explorerIconStyle}
                  onChange={(event) => onExplorerIconStyleChange(event.target.value as ExplorerIconStyleBlock)}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[140px]')}
                  aria-label="Explorer icon style"
                >
                  <option value="outline">Outline</option>
                  <option value="filled">Filled</option>
                </select>
              )}
            />
            <SettingsRowBlock
              label="Selected item color"
              description="Highlight color for the selected file in the explorer and the RSS feed list."
              control={(
                <>
                  <input
                    type="color"
                    aria-label="Selected item color"
                    value={explorerSelectedColor || DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK}
                    onChange={(event) => onExplorerSelectedColorChange(event.target.value)}
                    className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
                  />
                  <button
                    type="button"
                    onClick={() => onExplorerSelectedColorChange(DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK)}
                    disabled={explorerSelectedColor.toLowerCase() === DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK}
                    className="rounded-md border border-input px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reset
                  </button>
                </>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Folder color rules"
            description="Each rule colors a folder icon by relative path. Enable descendants to apply the color to nested folders."
          >
            {explorerFolderColorRulesDraft.length === 0 && (
              <SettingsRowBlock
                label="No custom rules yet"
                description="Add one to color explorer folders."
              />
            )}
            {explorerFolderColorRulesDraft.map((rule) => (
              <SettingsRowBlock key={rule.id} stacked className="gap-2">
                <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                  <input
                    type="text"
                    value={rule.folderPath}
                    onChange={(event) => onUpdateExplorerColorRule(rule.id, { folderPath: event.target.value })}
                    placeholder="example/folder/path"
                    aria-label="Folder path"
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
                  />
                  <input
                    type="color"
                    value={rule.color}
                    onChange={(event) => onUpdateExplorerColorRule(rule.id, { color: event.target.value })}
                    className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
                    aria-label={`Color for ${rule.folderPath || 'new rule'}`}
                  />
                  <label className="inline-flex h-8 items-center gap-2 text-[12px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rule.includeDescendants}
                      onChange={(event) => onUpdateExplorerColorRule(rule.id, { includeDescendants: event.target.checked })}
                      className="h-4 w-4"
                    />
                    Descendants
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    onClick={() => onRemoveExplorerColorRule(rule.id)}
                  >
                    Remove
                  </Button>
                </div>
              </SettingsRowBlock>
            ))}
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={() => { void onSaveExplorerColorRules() }}
              disabled={busyAction === 'explorer' || !explorerRulesDirty}
            >
              {busyAction === 'explorer' ? 'Saving...' : 'Save Explorer Settings'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onAddExplorerColorRule}
            >
              Add Rule
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onLoadLegacyExplorerColorRules}
            >
              Load Legacy Preset
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onResetExplorerColorRules}
              disabled={busyAction === 'explorer' || !explorerRulesDirty}
            >
              Reset
            </Button>
          </div>
        </>
      )}

      {activeTab === 'moon_scene' && (
        <>
          <SettingsSectionHeaderBlock
            title="Moon Scene"
            description="Speech bubbles for the home-canvas moon scene. During a message's daily window the sprite shows your text instead of its idle thought bubble; windows where start is after end wrap past midnight."
          />

          <SettingsGroupBlock heading="Sprites">
            <SettingsRowBlock
              as="label"
              label="Idle animation rotation"
              description="Between scheduled messages, sprites occasionally play a random animation from the library (skateboard, wizard, float, …). Saves immediately."
              control={(
                <Switch
                  checked={moonSceneIdleAnimationsEnabled}
                  onCheckedChange={updateMoonSceneIdleAnimationsEnabled}
                  aria-label="Idle animation rotation"
                />
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Scheduled messages"
            footnote="One message per sprite is shown at a time — if windows overlap, the first matching entry wins. Messages with empty text are dropped on save."
          >
            {moonSceneMessagesDraft.length === 0 && (
              <SettingsRowBlock
                label="No scheduled messages yet"
                description="Add one to make the astronaut or Clawd talk."
              />
            )}
            {moonSceneMessagesDraft.map(entry => (
              <SettingsRowBlock key={entry.id} stacked className="gap-2">
                <div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto] md:items-center">
                  <select
                    value={entry.speaker}
                    onChange={event => onUpdateMoonSceneMessage(entry.id, {
                      speaker: event.target.value as MoonSceneMessagePreferenceBlock['speaker'],
                    })}
                    className={SETTINGS_CONTROL_CLASS_BLOCK}
                    aria-label="Speaker"
                  >
                    {MOON_SCENE_SPEAKER_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={entry.text}
                    maxLength={120}
                    onChange={event => onUpdateMoonSceneMessage(entry.id, { text: event.target.value })}
                    placeholder="e.g. time to wrap up and rest"
                    aria-label="Message"
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
                  />
                  <input
                    type="time"
                    step={60}
                    value={entry.startTime}
                    onChange={event => onUpdateMoonSceneMessage(entry.id, { startTime: event.target.value })}
                    className={SETTINGS_CONTROL_CLASS_BLOCK}
                    aria-label="From"
                  />
                  <input
                    type="time"
                    step={60}
                    value={entry.endTime}
                    onChange={event => onUpdateMoonSceneMessage(entry.id, { endTime: event.target.value })}
                    className={SETTINGS_CONTROL_CLASS_BLOCK}
                    aria-label="To"
                  />
                  <select
                    value={entry.animation}
                    onChange={event => onUpdateMoonSceneMessage(entry.id, {
                      animation: event.target.value as MoonSceneMessagePreferenceBlock['animation'],
                    })}
                    className={SETTINGS_CONTROL_CLASS_BLOCK}
                    aria-label="Animation"
                  >
                    {MOON_SCENE_ANIMATION_IDS_BLOCK.map(id => (
                      <option key={id} value={id}>{MOON_SCENE_ANIMATION_LABELS[id] ?? id}</option>
                    ))}
                  </select>
                  <label className="inline-flex h-8 items-center gap-2 text-[12px] text-muted-foreground">
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={checked => onUpdateMoonSceneMessage(entry.id, { enabled: checked })}
                      aria-label={`Enable message "${entry.text || 'new message'}"`}
                    />
                    On
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    onClick={() => onRemoveMoonSceneMessage(entry.id)}
                  >
                    Remove
                  </Button>
                </div>
              </SettingsRowBlock>
            ))}
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={() => { void onSaveMoonSceneMessages() }}
              disabled={busyAction === 'moon_scene' || !moonSceneMessagesDirty}
            >
              {busyAction === 'moon_scene' ? 'Saving...' : 'Save Moon Scene Settings'}
            </Button>
            <Button type="button" variant="outline" onClick={onAddMoonSceneMessage}>
              Add Message
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onResetMoonSceneMessages}
              disabled={busyAction === 'moon_scene' || !moonSceneMessagesDirty}
            >
              Reset
            </Button>
          </div>
        </>
      )}

      {activeTab === 'activity' && (
        <>
          <SettingsSectionHeaderBlock
            title="Activity Tracker"
            description="Vault paths excluded from file activity tracking. Files under an ignored prefix never appear in activity calendars or daily summaries."
          />

          <SettingsGroupBlock
            heading="Ignored paths"
            description="Vault-relative path prefixes. Any file whose path starts with one is filtered out."
          >
            {activityIgnoredPaths.length === 0 && (
              <SettingsRowBlock label="No ignored paths configured" />
            )}
            {activityIgnoredPaths.map(path => (
              <SettingsRowBlock
                key={path}
                label={<code className="font-mono text-[12px] font-normal text-muted-foreground">{path}</code>}
                control={(
                  <button
                    type="button"
                    onClick={() => handleActivityRemovePath(path)}
                    className="text-[12px] text-muted-foreground/60 transition-colors hover:text-destructive"
                    title="Remove"
                  >
                    Remove
                  </button>
                )}
              />
            ))}
            <SettingsRowBlock stacked>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={activityNewPathInput}
                  onChange={e => setActivityNewPathInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleActivityAddPath() }}
                  placeholder="e.g. operations/F9/execution"
                  aria-label="New ignored path"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={handleActivityAddPath}
                  disabled={!activityNewPathInput.trim()}
                >
                  Add
                </Button>
              </div>
            </SettingsRowBlock>
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={handleActivitySave}
              disabled={busyAction === 'activity' || !activityDirty}
            >
              {busyAction === 'activity' ? 'Saving...' : 'Save Activity Settings'}
            </Button>
          </div>
        </>
      )}

      {activeTab === 'ai_activity' && (
        <>
          <SettingsSectionHeaderBlock
            title="AI Activity"
            description="Where AI sessions come from, how they are grouped, and which surfaces they appear on."
          />
          <AiActivitySessionSourcesSettingsBlock />
          <AiActivityProjectMappingSettingsBlock />
          <AiActivityHomePostItSettingsBlock />
          <AiActivitySetModeSettingsBlock />
          <AiActivityCalendarModeSettingsBlock />
          <AiActivityAiTitlesSettingsBlock />
          <AiActivityRangeSummaryProviderSettingsBlock />
          <AiActivityRestDaysSettingsBlock />
        </>
      )}

      {activeTab === 'scheduler' && (
        <>
          <SettingsSectionHeaderBlock
            title="Scheduler"
            description={`In-app scheduled jobs. Tasks run only while Thinking Space is open; ${runtimeLabel} runtimes may pause timers when the app is backgrounded.`}
          />

          {schedulerSettingsDraft.tasks.map((task) => {
            const taskOption = schedulerActionOptionById.get(task.action)
            const nextRunAt = schedulerNextRunByTaskId[task.id]
            return (
              <SettingsGroupBlock
                key={task.id}
                heading={taskOption?.label ?? task.action}
                footnote={task.enabled && nextRunAt
                  ? `Next run: ${new Date(nextRunAt).toLocaleString()}`
                  : 'Task is disabled. Enable it to schedule runs.'}
              >
                <SettingsRowBlock
                  as="label"
                  label="Enabled"
                  description={taskOption?.description ?? 'Scheduled task'}
                  control={(
                    <Switch
                      checked={task.enabled}
                      onCheckedChange={(checked) => onUpdateScheduledTask(task.id, { enabled: checked })}
                      aria-label={`Enable ${taskOption?.label ?? task.action}`}
                    />
                  )}
                />
                <SettingsRowBlock
                  label="Scheduled times"
                  description={task.timesOfDay.length === 0 ? 'No times set.' : undefined}
                  control={(
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {task.timesOfDay.map(time => (
                        <span
                          key={time}
                          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[12px]"
                        >
                          <span className="font-mono">{time}</span>
                          {task.timesOfDay.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onRemoveScheduledTime(task.id, time)}
                              className="text-muted-foreground/50 transition-colors hover:text-destructive"
                              title="Remove time"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                />
                <SettingsRowBlock
                  label="Add a time"
                  control={(
                    <>
                      <input
                        type="time"
                        step={60}
                        value={schedulerNewTimeByTaskId[task.id] ?? ''}
                        onChange={(e) => setSchedulerNewTimeByTaskId(prev => ({ ...prev, [task.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onAddScheduledTime(task.id, schedulerNewTimeByTaskId[task.id] ?? '')
                            setSchedulerNewTimeByTaskId(prev => ({ ...prev, [task.id]: '' }))
                          }
                        }}
                        aria-label={`New time for ${taskOption?.label ?? task.action}`}
                        className={SETTINGS_CONTROL_CLASS_BLOCK}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          onAddScheduledTime(task.id, schedulerNewTimeByTaskId[task.id] ?? '')
                          setSchedulerNewTimeByTaskId(prev => ({ ...prev, [task.id]: '' }))
                        }}
                        disabled={!schedulerNewTimeByTaskId[task.id]?.trim()}
                      >
                        Add
                      </Button>
                    </>
                  )}
                />
              </SettingsGroupBlock>
            )
          })}

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={() => { void onSaveSchedulerSettings() }}
              disabled={busyAction === 'scheduler' || !schedulerDirty}
            >
              {busyAction === 'scheduler' ? 'Saving...' : 'Save Scheduler Settings'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onResetSchedulerSettings}
              disabled={busyAction === 'scheduler' || !schedulerDirty}
            >
              Reset
            </Button>
          </div>
        </>
      )}

      {activeTab === 'profile' && (
        <>
          <SettingsSectionHeaderBlock
            title="Profile"
            description={(
              <>
                Stored in your Thinking Space folder at{' '}
                <span className="font-mono">{USER_PROFILE_FILE_PATH_BLOCK}</span>.
              </>
            )}
          />

          <SettingsGroupBlock heading="Identity">
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-profile-name"
              label="Name"
              control={(
                <input
                  id="ltm-settings-profile-name"
                  type="text"
                  value={profileNameInput}
                  onChange={(event) => {
                    setProfileNameInput(event.target.value)
                    setProfileDirty(true)
                  }}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[240px]')}
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-profile-symbol"
              label="Profile symbol"
              description="Shown wherever the app needs a compact stand-in for you."
              control={(
                <>
                  <input
                    id="ltm-settings-profile-symbol"
                    type="text"
                    value={profileSymbolInput}
                    onChange={(event) => {
                      setProfileSymbolInput(event.target.value)
                      setProfileDirty(true)
                    }}
                    placeholder={deriveUserProfileSymbolBlock(profileNameInput)}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[180px]')}
                  />
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-[13px] font-semibold text-foreground">
                    {profileSymbolInput.trim() || deriveUserProfileSymbolBlock(profileNameInput)}
                  </span>
                </>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="AI memories"
            footnote={profileLoading ? 'Loading profile…' : 'Stored as plain text lines in your profile. AI can append to these later.'}
          >
            <SettingsRowBlock stacked>
              <textarea
                id="ltm-settings-profile-memories"
                value={profileMemoriesInput}
                onChange={(event) => {
                  setProfileMemoriesInput(event.target.value)
                  setProfileDirty(true)
                }}
                placeholder="One memory per line."
                aria-label="AI memories"
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-ring"
              />
            </SettingsRowBlock>
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={onSaveProfile}
              disabled={busyProfileSave || (!profileDirty && !profileLoading)}
            >
              {busyProfileSave ? 'Saving...' : 'Save Profile'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void onReloadProfile() }}
              disabled={busyProfileSave}
            >
              Reload from Thinking Space
            </Button>
          </div>
        </>
      )}

      {activeTab === 'ai' && (
        <AiSettingsOrch />
      )}

      {activeTab === 'ai_websites' && (
        <AiWebsitesSettingsSection />
      )}

      {activeTab === 'web_bookmarks' && <WebSettingsSection />}

      {activeTab === 'google_docs_sheets' && (
        <>
          <SettingsSectionHeaderBlock
            title="Google Docs and Sheets"
            description="Opening and editing Docs and Sheets works from the in-app Google view without any setup — sign in once inside a document and that session is reused. The client ID below is only for Pick from Drive."
          />

          <SettingsGroupBlock
            heading="Drive picker"
            footnote={`Status: ${googleDriveConnected ? 'connected' : 'not connected'}`}
          >
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-google-oauth-client-id"
              label="OAuth client ID"
              description="Required only for Connect Google / Pick from Drive."
              control={(
                <input
                  id="ltm-settings-google-oauth-client-id"
                  type="text"
                  value={googleOauthClientIdInput}
                  onChange={(event) => setGoogleOauthClientIdInput(event.target.value)}
                  placeholder="1234567890-xxxx.apps.googleusercontent.com"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px]')}
                />
              )}
            />
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button type="button" variant="outline" onClick={onSaveGoogleOauthClientId}>
              Save Client ID
            </Button>
            <Button
              type="button"
              onClick={() => { void onConnectGoogleDrive() }}
              disabled={googleDriveAuthBusy}
            >
              {googleDriveAuthBusy ? 'Connecting...' : 'Connect Google'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onDisconnectGoogleDrive}
              disabled={googleDriveAuthBusy || !googleDriveConnected}
            >
              Disconnect Google
            </Button>
          </div>
        </>
      )}

      {activeTab === 'webull' && (
        <>
          <SettingsSectionHeaderBlock
            title="Webull"
            description="Tab name and icon, API credentials, and where execution files are stored."
          />

          <SettingsGroupBlock
            heading="Tab appearance"
            description="The label and icon shown in the sidebar and tab strip. Changes sync across devices via your vault."
          >
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-tab-label"
              label="Tab label"
              control={(
                <input
                  id="ltm-settings-webull-tab-label"
                  type="text"
                  value={webullTabLabelInput}
                  onChange={(event) => setWebullTabLabelInput(event.target.value)}
                  placeholder="Webull"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[220px]')}
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-tab-icon"
              label="Tab icon"
              description="Text or emoji (e.g. 📈, W). Blank uses the Webull crescent icon."
              control={(
                <input
                  id="ltm-settings-webull-tab-icon"
                  type="text"
                  value={webullTabIconTextInput}
                  onChange={(event) => setWebullTabIconTextInput(event.target.value)}
                  placeholder="Default"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[220px]')}
                />
              )}
            />
            <SettingsRowBlock
              label="Apply"
              control={(
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={() => { void onSaveWebullTabPreferences() }}
                  disabled={busyAction === 'webull' || !onWebullTabPreferencesChange}
                >
                  {busyAction === 'webull' ? 'Saving...' : 'Save Tab Appearance'}
                </Button>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Experimental subtabs"
            footnote={(
              <>
                Vault-relative folder holding the Sim data (<code>cases/</code>, <code>eras.yaml</code>, <code>bench.md</code>).
                {' '}
                {webullSavedSimFolderPath
                  ? <>Currently saved: <span className="font-mono">{webullSavedSimFolderPath}</span>.</>
                  : deriveDefaultWebullSimRootBlock(webullSavedExecutionFolderPath)
                    ? <>Blank uses the default <span className="font-mono">{deriveDefaultWebullSimRootBlock(webullSavedExecutionFolderPath)}</span>.</>
                    : <>Blank uses an <span className="font-mono">F9-sim</span> folder beside the execution folder.</>}
              </>
            )}
          >
            <SettingsRowBlock
              as="label"
              label="Sim subtab"
              description="Adds a Sim timeline of F9 practice reps across market history, beside Study. Applied on next visit to the Webull tab."
              control={(
                <Switch
                  checked={webullSimTabEnabled}
                  onCheckedChange={updateWebullSimTabEnabled}
                  aria-label="Enable the Webull Sim subtab"
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-sim-folder"
              label="Sim folder path"
              control={(
                <>
                  <input
                    id="ltm-settings-webull-sim-folder"
                    type="text"
                    value={webullSimFolderPathInput}
                    onChange={(event) => setWebullSimFolderPathInput(event.target.value)}
                    placeholder={
                      deriveDefaultWebullSimRootBlock(webullSavedExecutionFolderPath)
                      || 'e.g. acceleration_core/F9/F9-sim'
                    }
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px]')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => { void onSaveWebullSimFolderPath() }}
                    disabled={busyAction === 'webull'}
                  >
                    Save
                  </Button>
                </>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="API credentials"
            description={
              !webullCredentialEditingSupported
                ? 'Secure credential entry is available only in the Electron desktop app.'
                : !webullSecureStorageAvailable
                  ? 'Secure storage is unavailable on this device — credentials cannot be saved safely.'
                  : undefined
            }
            footnote={`Status: ${webullCredentialsConfigured ? `configured (${webullAppKeyHint ?? 'saved'})` : 'not configured'}`}
          >
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-webull-app-key"
              label="App key"
              control={(
                <input
                  id="ltm-settings-webull-webull-app-key"
                  type="text"
                  value={webullAppKeyInput}
                  onChange={(event) => setWebullAppKeyInput(event.target.value)}
                  placeholder="Enter app key"
                  disabled={!webullCredentialEditingSupported}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px] disabled:cursor-not-allowed disabled:opacity-60')}
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-webull-app-secret"
              label="App secret"
              control={(
                <input
                  id="ltm-settings-webull-webull-app-secret"
                  type="password"
                  value={webullAppSecretInput}
                  onChange={(event) => setWebullAppSecretInput(event.target.value)}
                  placeholder="Enter app secret"
                  disabled={!webullCredentialEditingSupported}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px] disabled:cursor-not-allowed disabled:opacity-60')}
                />
              )}
            />
            <SettingsRowBlock
              label="Stored credentials"
              control={(
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={() => { void onSaveWebullCredentials() }}
                    disabled={busyAction === 'webull' || !webullCredentialEditingSupported}
                  >
                    {busyAction === 'webull' ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => { void onClearWebullCredentials() }}
                    disabled={busyAction === 'webull' || !webullCredentialEditingSupported || !webullCredentialsConfigured}
                  >
                    Clear
                  </Button>
                </>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock
            heading="Execution storage"
            description="Where Webull writes overall.json, company index files, and per-position markdown."
            footnote={(
              <>
                Currently saved:{' '}
                {webullSavedExecutionFolderPath
                  ? <span className="font-mono">{webullSavedExecutionFolderPath}</span>
                  : <span className="italic">not configured</span>}
              </>
            )}
          >
            <SettingsRowBlock
              as="label"
              htmlFor="ltm-settings-webull-execution-folder"
              label="Execution folder path"
              description="Blank disables execution file sync."
              control={(
                <input
                  id="ltm-settings-webull-execution-folder"
                  type="text"
                  value={webullExecutionFolderPathInput}
                  onChange={(event) => setWebullExecutionFolderPathInput(event.target.value)}
                  placeholder="Optional"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[280px]')}
                />
              )}
            />
          </SettingsGroupBlock>

          <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
            <Button
              type="button"
              onClick={() => { void onSaveWebullSettings() }}
              disabled={busyAction === 'webull'}
            >
              {busyAction === 'webull' ? 'Saving...' : 'Save Webull Path'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { void onResetWebullSettings() }}
              disabled={busyAction === 'webull'}
            >
              Reset to Default
            </Button>
          </div>
        </>
      )}

      {activeTab === 'rss' && (
        <RssFeedSettingsSection />
      )}

      {activeTab === 'cache' && (
        <>
          <SettingsSectionHeaderBlock
            title="Index & Cache"
            description="Rebuildable local state: the search index that makes notes findable, and the caches the app can always regenerate."
          />

          <SettingsGroupBlock
            heading="Faster indexing"
            footnote="Only notes that already have YAML frontmatter but lack a uuid are touched — one uuid: line is inserted. Plain notes and harvested AI transcripts are left alone, and nothing else is reformatted. Safe to run repeatedly."
          >
            <SettingsRowBlock
              label="Add Thinking Space UUIDs"
              description="Stamps a uuid on notes without one so they index reliably and show up in reading/memorization activity and related retrieval."
              control={(
                <Button type="button" size="sm" className="h-8" onClick={onBackfillUuids} disabled={busyUuidBackfill}>
                  {busyUuidBackfill ? 'Stamping…' : 'Run'}
                </Button>
              )}
            />
          </SettingsGroupBlock>

          <SettingsGroupBlock heading="Reset">
            <SettingsRowBlock
              label="Clear cache"
              description="Clears IndexedDB and the local settings cache, then reloads. Your Thinking Space selection is kept, but locally stored API/OAuth credentials (AI, Google Drive) are removed — you may need to sign in again."
              control={(
                <Button type="button" size="sm" className="h-8" onClick={onClearCache} disabled={busyAction === 'cache'}>
                  {busyAction === 'cache' ? 'Clearing…' : 'Clear'}
                </Button>
              )}
            />
            <SettingsRowBlock
              label="Clear GPU cache"
              description="Deletes the GPU shader cache and restarts the app. Fixes render glitches, blank surfaces, or stale shader artifacts after a driver update."
              control={(
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={onClearGpuCache}
                  disabled={busyGpuCache}
                >
                  {busyGpuCache ? 'Clearing…' : 'Clear & Restart'}
                </Button>
              )}
            />
          </SettingsGroupBlock>
        </>
      )}

      {activeTab === 'projects' && <ProjectsSettingsBlock />}

      {activeTab === 'vault' && (
        <>
          <SettingsSectionHeaderBlock
            title="Select Thinking Space"
            description={`Open the folder selector for this ${runtimeLabel} runtime. The app reloads after selection.`}
          />

          <SettingsGroupBlock heading="Folder">
            <SettingsRowBlock
              label="Switch Thinking Space"
              description="Use this to move to a different folder or recover from stale folder context. Switching does not delete API keys or credentials."
              control={(
                <Button type="button" size="sm" className="h-8" onClick={onSwitchVault}>
                  Open Selector
                </Button>
              )}
            />
          </SettingsGroupBlock>
        </>
      )}

      {activeTab === 'workspace_profiles' && <WorkspaceProfilesSettingsBlock />}

      {activeTab === 'navigation' && <NavRailSettingsBlock webullLabel={webullTabLabelInput} />}

      {activeTab === 'about' && <AboutSection />}

      {activeTab === 'developer' && (
        <>
          <SettingsSectionHeaderBlock
            title="Developer"
            description="Modify Thinking Space with AI assistance — see changes live, then build a permanent version."
          />

          <SettingsGroupBlock heading="Flags">
            <SettingsRowBlock
              as="label"
              label="Auto-heal YAML fields during sync"
              description="Repairs known YAML field shapes and appends missing generated wiki_links on touched notes."
              control={(
                <Switch
                  checked={yamlFieldsAutoHealEnabled}
                  onCheckedChange={(checked) => {
                    setCapabilityFeatureFlag('yaml_fields_auto_heal_enabled', checked)
                    setYamlFieldsAutoHealEnabled(checked)
                  }}
                  aria-label="Auto-heal YAML fields during sync"
                />
              )}
            />
            <SettingsRowBlock
              as="label"
              label="Show console warnings"
              description="When off, low-priority console.log/info/warn/debug messages are suppressed in DevTools. Errors are always shown."
              control={(
                <Switch
                  checked={consoleWarningsVisible}
                  onCheckedChange={(checked) => {
                    setConsoleWarningsVisible(checked)
                    setConsoleWarningsVisibleState(checked)
                  }}
                  aria-label="Show console warnings"
                />
              )}
            />
          </SettingsGroupBlock>

          <div className={SETTINGS_PANE_WIDTH_BLOCK}>
            <DeveloperSetupBlock />
          </div>
        </>
      )}

      {message && <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'text-[13px] text-muted-foreground')}>{message}</p>}
      {error && <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'text-[13px] text-destructive')}>{error}</p>}
      </div>
    </div>
  )
}

function AboutSection() {
  const electronVersions = window.electronAPI?.versions

  const rows: Array<{ label: string; value: string }> = electronVersions ? [
    { label: 'Thinking Space', value: electronVersions.app },
    { label: 'Electron', value: electronVersions.electron },
    { label: 'Chromium', value: electronVersions.chrome },
    { label: 'Node.js', value: electronVersions.node },
    { label: 'V8', value: electronVersions.v8 },
  ] : []

  return (
    <>
      <SettingsSectionHeaderBlock title="About" description="Runtime and version information." />
      <SettingsGroupBlock heading="Versions">
        {rows.length === 0 ? (
          <SettingsRowBlock label="Version info is only available in the Electron desktop app." />
        ) : rows.map(({ label, value }) => (
          <SettingsRowBlock
            key={label}
            label={label}
            control={<span className="font-mono text-[13px] text-muted-foreground">{value}</span>}
          />
        ))}
      </SettingsGroupBlock>
    </>
  )
}

const RETENTION_OPTIONS = [7, 14, 30, 60, 90, 180] as const

function RssFeedSettingsSection() {
  const [prefs, setPrefs] = useState<RssFeedPreferencesBlock | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupParent, setNewGroupParent] = useState<string | null>(null)
  const [newTagDraft, setNewTagDraft] = useState('')
  const [retentionDays, setRetentionDays] = useState<number>(() => getRssRetentionDaysOrch())

  const feeds = prefs?.feeds ?? []
  const groups = prefs?.groups ?? []
  const presetTags = prefs?.presetTags ?? []
  const presetTagColors = prefs?.tagColors ?? {}

  useEffect(() => {
    void readRssFeedPreferencesOrch().then(setPrefs)
  }, [])

  const handleAddFeed = async () => {
    const url = newUrl.trim()
    if (!url) return
    const entry = await addRssFeedOrch(url, newTitle.trim() || undefined)
    setPrefs(prev => prev ? { ...prev, feeds: [...prev.feeds, entry] } : prev)
    setNewUrl('')
    setNewTitle('')
  }

  const handleRemoveFeed = async (feedId: string) => {
    await removeRssFeedOrch(feedId)
    setPrefs(prev => prev ? { ...prev, feeds: prev.feeds.filter(f => f.id !== feedId) } : prev)
  }

  const handleUpdateFeedTitle = async (feedId: string, title: string) => {
    await updateRssFeedOrch(feedId, { title })
    setPrefs(prev => prev ? { ...prev, feeds: prev.feeds.map(f => f.id === feedId ? { ...f, title } : f) } : prev)
  }

  const handleUpdateFeedGroup = async (feedId: string, groupId: string | null) => {
    await updateRssFeedOrch(feedId, { groupId })
    setPrefs(prev => prev ? { ...prev, feeds: prev.feeds.map(f => f.id === feedId ? { ...f, groupId } : f) } : prev)
  }

  const handleAddGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    const group = await addRssFeedGroupOrch(name, newGroupParent)
    setPrefs(prev => prev ? { ...prev, groups: [...prev.groups, group] } : prev)
    setNewGroupName('')
    setNewGroupParent(null)
  }

  const handleRemoveGroup = async (groupId: string) => {
    await removeRssFeedGroupOrch(groupId)
    setPrefs(prev => {
      if (!prev) return prev
      // Cascade: remove group + ungroup its feeds
      const idsToRemove = new Set<string>()
      function collect(id: string) {
        idsToRemove.add(id)
        for (const g of prev!.groups) if (g.parentGroupId === id) collect(g.id)
      }
      collect(groupId)
      return {
        ...prev,
        groups: prev.groups.filter(g => !idsToRemove.has(g.id)),
        feeds: prev.feeds.map(f => f.groupId && idsToRemove.has(f.groupId) ? { ...f, groupId: null } : f),
      }
    })
  }

  const handleRenameGroup = async (groupId: string, name: string) => {
    await updateRssFeedGroupOrch(groupId, { name })
    setPrefs(prev => prev ? { ...prev, groups: prev.groups.map(g => g.id === groupId ? { ...g, name } : g) } : prev)
  }

  const handleAddPresetTag = async () => {
    const incoming = splitTagInputBlock(newTagDraft).filter(t => !presetTags.includes(t))
    if (incoming.length === 0) { setNewTagDraft(''); return }
    const next = [...presetTags, ...incoming]
    await updateRssPresetTagsOrch(next, presetTagColors)
    setPrefs(prev => prev ? { ...prev, presetTags: next } : prev)
    setNewTagDraft('')
  }

  const handleRemovePresetTag = async (tag: string) => {
    const next = presetTags.filter(t => t !== tag)
    const nextColors = { ...presetTagColors }
    delete nextColors[tagLookupKeyBlock(tag)]
    await updateRssPresetTagsOrch(next, nextColors)
    setPrefs(prev => prev ? { ...prev, presetTags: next, tagColors: nextColors } : prev)
  }

  return (
    <>
      <SettingsSectionHeaderBlock
        title="RSS Feeds"
        description="RSS or Atom feed URLs. They appear in the RSS panel at the bottom of the explorer."
      />

      <SettingsGroupBlock heading="Feeds">
        {feeds.length === 0 && <SettingsRowBlock label="No feeds configured yet." />}
        {feeds.map(feed => (
          <SettingsRowBlock
            key={feed.id}
            label={(
              <input
                defaultValue={feed.title}
                onBlur={e => { void handleUpdateFeedTitle(feed.id, e.target.value) }}
                className="block w-full bg-transparent text-[13px] font-medium outline-none placeholder:text-muted-foreground"
                placeholder="Feed title"
              />
            )}
            description={<span className="block truncate">{feed.url}</span>}
            control={(
              <>
                <select
                  value={feed.groupId ?? ''}
                  onChange={e => { void handleUpdateFeedGroup(feed.id, e.target.value || null) }}
                  className={SETTINGS_CONTROL_CLASS_BLOCK}
                  aria-label="Feed group"
                >
                  <option value="">No group</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-destructive hover:text-destructive"
                  onClick={() => void handleRemoveFeed(feed.id)}
                >
                  Remove
                </Button>
              </>
            )}
          />
        ))}
        <SettingsRowBlock stacked className="gap-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              aria-label="New feed URL"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
              onKeyDown={e => { if (e.key === 'Enter') void handleAddFeed() }}
            />
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Title (optional — auto-detected)"
              aria-label="New feed title"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
              onKeyDown={e => { if (e.key === 'Enter') void handleAddFeed() }}
            />
            <Button size="sm" className="h-8" onClick={() => void handleAddFeed()} disabled={!newUrl.trim()}>
              Add Feed
            </Button>
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>

      <SettingsGroupBlock heading="Feed groups">
        {groups.map(g => (
          <SettingsRowBlock
            key={g.id}
            label={(
              <input
                defaultValue={g.name}
                onBlur={e => { void handleRenameGroup(g.id, e.target.value) }}
                className="block w-full bg-transparent text-[13px] font-medium outline-none"
                placeholder="Group name"
              />
            )}
            description={g.parentGroupId
              ? `in ${groups.find(p => p.id === g.parentGroupId)?.name ?? '?'}`
              : undefined}
            control={(
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-destructive hover:text-destructive"
                onClick={() => void handleRemoveGroup(g.id)}
              >
                Remove
              </Button>
            )}
          />
        ))}
        <SettingsRowBlock stacked className="gap-2">
          <div className="flex items-center gap-2">
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder="New group name"
              aria-label="New group name"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
              onKeyDown={e => { if (e.key === 'Enter') void handleAddGroup() }}
            />
            {groups.length > 0 && (
              <select
                value={newGroupParent ?? ''}
                onChange={e => setNewGroupParent(e.target.value || null)}
                className={SETTINGS_CONTROL_CLASS_BLOCK}
                aria-label="Parent group"
              >
                <option value="">Root level</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void handleAddGroup()} disabled={!newGroupName.trim()}>
              Add
            </Button>
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>

      <SettingsGroupBlock
        heading="Global preset tags"
        description="Tags defined here become one-click chips when tagging articles."
      >
        {presetTags.length > 0 && (
          <SettingsRowBlock stacked>
            <div className="flex flex-wrap gap-1.5">
              {presetTags.map(tag => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    tagColorClassBlock(tag, 'solid'),
                  )}
                  style={tagColorStyleBlock(tag, 'solid', presetTagColors[tagLookupKeyBlock(tag)])}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => void handleRemovePresetTag(tag)}
                    className="opacity-60 hover:opacity-100"
                    aria-label={`Remove ${tag}`}
                  >
                    <span className="text-xs">&times;</span>
                  </button>
                </span>
              ))}
            </div>
          </SettingsRowBlock>
        )}
        <SettingsRowBlock stacked className="gap-2">
          <div className="flex items-center gap-2">
            <input
              value={newTagDraft}
              onChange={e => setNewTagDraft(e.target.value)}
              placeholder="Add tags (comma separated)"
              aria-label="Add preset tags"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddPresetTag() } }}
            />
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void handleAddPresetTag()} disabled={!newTagDraft.trim()}>
              Add
            </Button>
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>

      <SettingsGroupBlock heading="Retention">
        <SettingsRowBlock
          label="Article retention"
          description={<>Articles older than this are auto-purged. Articles with tags or <code>keep: true</code> are kept forever.</>}
          control={(
            <select
              value={retentionDays}
              onChange={e => {
                const days = Number(e.target.value)
                setRetentionDays(days)
                setRssRetentionDaysOrch(days)
              }}
              className={SETTINGS_CONTROL_CLASS_BLOCK}
              aria-label="Article retention"
            >
              {RETENTION_OPTIONS.map(d => (
                <option key={d} value={d}>{d} days</option>
              ))}
              {!RETENTION_OPTIONS.includes(retentionDays as typeof RETENTION_OPTIONS[number]) && (
                <option value={retentionDays}>{retentionDays} days</option>
              )}
            </select>
          )}
        />
      </SettingsGroupBlock>
    </>
  )
}

function AiWebsitesSettingsSection() {
  const [sites, setSites] = useState<AiWebsiteBlock[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNameDraft, setEditNameDraft] = useState('')

  useEffect(() => { void readAiWebsitesOrch().then(setSites) }, [])

  const handleAdd = async () => {
    const url = newUrl.trim()
    if (!url) return
    const entry = await addAiWebsiteOrch(newName.trim() || url, url)
    setSites(prev => [...prev, entry])
    setNewUrl('')
    setNewName('')
  }

  const handleRemove = async (id: string) => {
    await removeAiWebsiteOrch(id)
    setSites(prev => prev.filter(s => s.id !== id))
  }

  const handleStartEdit = (site: AiWebsiteBlock) => {
    setEditingId(site.id)
    setEditNameDraft(site.name)
  }

  const handleSaveEdit = async (id: string) => {
    const name = editNameDraft.trim()
    if (!name) return
    await updateAiWebsiteOrch(id, { name })
    setSites(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    setEditingId(null)
  }

  return (
    <>
      <SettingsSectionHeaderBlock
        title="AI Websites"
        description="AI chat websites (grok.com, chatgpt.com, …) shown in the Chat tab. Each entry gets its own isolated login session — add the same site twice for two accounts."
      />

      <SettingsGroupBlock heading="Websites">
        {sites.length === 0 && <SettingsRowBlock label="No AI websites added yet." />}
        {sites.map(site => (
          editingId === site.id ? (
            <SettingsRowBlock
              key={site.id}
              stacked
              className="gap-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editNameDraft}
                  onChange={e => setEditNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(site.id) }}
                  aria-label="Website name"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
                  autoFocus
                />
                <Button size="sm" variant="outline" className="h-8" onClick={() => handleSaveEdit(site.id)}>Save</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </SettingsRowBlock>
          ) : (
            <SettingsRowBlock
              key={site.id}
              label={<span className="block truncate">{site.name}</span>}
              description={<span className="block truncate">{site.url}</span>}
              control={(
                <>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => handleStartEdit(site)}>Rename</Button>
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => handleRemove(site.id)}>Remove</Button>
                </>
              )}
            />
          )
        ))}
        <SettingsRowBlock stacked className="gap-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="https://grok.com"
              aria-label="New website URL"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
            />
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Display name (optional)"
              aria-label="New website name"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
            />
            <Button type="button" size="sm" className="h-8" onClick={handleAdd} disabled={!newUrl.trim()}>
              Add Website
            </Button>
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>
    </>
  )
}

function WebSettingsSection() {
  const [prefs, setPrefs] = useState<WebSitePreferencesBlock>({ bookmarks: [], groups: [] })
  const [newSiteUrl, setNewSiteUrl] = useState('')
  const [newSiteName, setNewSiteName] = useState('')
  const [newSiteGroupId, setNewSiteGroupId] = useState<string>('__none__')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupParent, setNewGroupParent] = useState<string | null>(null)
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)
  const [editingSiteName, setEditingSiteName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')

  useEffect(() => { void readWebSitePreferencesOrch().then(setPrefs) }, [])

  const handleAddSite = async () => {
    const url = newSiteUrl.trim()
    if (!url) return
    const groupId = newSiteGroupId === '__none__' ? null : newSiteGroupId
    const entry = await addWebSiteOrch(newSiteName.trim() || url, url, groupId)
    setPrefs(prev => ({ ...prev, bookmarks: [...prev.bookmarks, entry] }))
    setNewSiteUrl('')
    setNewSiteName('')
  }

  const handleRemoveSite = async (id: string) => {
    await removeWebSiteOrch(id)
    setPrefs(prev => ({ ...prev, bookmarks: prev.bookmarks.filter(b => b.id !== id) }))
  }

  const handleSaveSiteName = async (id: string) => {
    const name = editingSiteName.trim()
    if (!name) return
    await updateWebSiteOrch(id, { name })
    setPrefs(prev => ({ ...prev, bookmarks: prev.bookmarks.map(b => b.id === id ? { ...b, name } : b) }))
    setEditingSiteId(null)
  }

  const handleAddGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    const group = await addWebSiteGroupOrch(name, newGroupParent)
    setPrefs(prev => ({ ...prev, groups: [...prev.groups, group] }))
    setNewGroupName('')
    setNewGroupParent(null)
  }

  const handleRemoveGroup = async (groupId: string) => {
    await removeWebSiteGroupOrch(groupId)
    setPrefs(prev => {
      const idsToRemove = new Set<string>()
      function collect(id: string) {
        idsToRemove.add(id)
        for (const g of prev.groups) if (g.parentGroupId === id) collect(g.id)
      }
      collect(groupId)
      return {
        groups: prev.groups.filter(g => !idsToRemove.has(g.id)),
        bookmarks: prev.bookmarks.map(b => b.groupId && idsToRemove.has(b.groupId) ? { ...b, groupId: null } : b),
      }
    })
  }

  const handleSaveGroupName = async (groupId: string) => {
    const name = editingGroupName.trim()
    if (!name) return
    await updateWebSiteGroupOrch(groupId, name)
    setPrefs(prev => ({ ...prev, groups: prev.groups.map(g => g.id === groupId ? { ...g, name } : g) }))
    setEditingGroupId(null)
  }

  return (
    <>
      <SettingsSectionHeaderBlock
        title="Web"
        description="Websites available in the Web tab, optionally organised into groups. Each entry gets its own isolated login session — add the same site twice for two accounts."
      />

      <SettingsGroupBlock heading="Groups" description="Groups work like folders for your sites.">
        {prefs.groups.length === 0 && <SettingsRowBlock label="No groups yet." />}
        {prefs.groups.map(group => (
          editingGroupId === group.id ? (
            <SettingsRowBlock key={group.id} stacked className="gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingGroupName}
                  onChange={e => setEditingGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveGroupName(group.id) }}
                  aria-label="Group name"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
                  autoFocus
                />
                <Button size="sm" variant="outline" className="h-8" onClick={() => handleSaveGroupName(group.id)}>Save</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingGroupId(null)}>Cancel</Button>
              </div>
            </SettingsRowBlock>
          ) : (
            <SettingsRowBlock
              key={group.id}
              label={<span className="block truncate">{group.name}</span>}
              description={group.parentGroupId
                ? `in ${prefs.groups.find(p => p.id === group.parentGroupId)?.name ?? '?'}`
                : undefined}
              control={(
                <>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name) }}>Rename</Button>
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => handleRemoveGroup(group.id)}>Remove</Button>
                </>
              )}
            />
          )
        ))}
        <SettingsRowBlock stacked className="gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddGroup() }}
              placeholder="New group name"
              aria-label="New group name"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
            />
            {prefs.groups.length > 0 && (
              <select
                value={newGroupParent ?? ''}
                onChange={e => setNewGroupParent(e.target.value || null)}
                className={SETTINGS_CONTROL_CLASS_BLOCK}
                aria-label="Parent group"
              >
                <option value="">Root level</option>
                {prefs.groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={handleAddGroup} disabled={!newGroupName.trim()}>Add</Button>
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>

      <SettingsGroupBlock heading="Sites">
        {prefs.bookmarks.length === 0 && <SettingsRowBlock label="No sites yet." />}
        {prefs.bookmarks.map(bm => (
          editingSiteId === bm.id ? (
            <SettingsRowBlock key={bm.id} stacked className="gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingSiteName}
                  onChange={e => setEditingSiteName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveSiteName(bm.id) }}
                  aria-label="Site name"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-0 flex-1')}
                  autoFocus
                />
                <Button size="sm" variant="outline" className="h-8" onClick={() => handleSaveSiteName(bm.id)}>Save</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingSiteId(null)}>Cancel</Button>
              </div>
            </SettingsRowBlock>
          ) : (
            <SettingsRowBlock
              key={bm.id}
              label={<span className="block truncate">{bm.name}</span>}
              description={(
                <>
                  <span className="block truncate">{bm.url}</span>
                  {bm.groupId && (
                    <span className="block text-muted-foreground/60">
                      {prefs.groups.find(g => g.id === bm.groupId)?.name ?? ''}
                    </span>
                  )}
                </>
              )}
              control={(
                <>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditingSiteId(bm.id); setEditingSiteName(bm.name) }}>Rename</Button>
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => handleRemoveSite(bm.id)}>Remove</Button>
                </>
              )}
            />
          )
        ))}
        <SettingsRowBlock stacked className="gap-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              type="url"
              value={newSiteUrl}
              onChange={e => setNewSiteUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddSite() }}
              placeholder="https://github.com"
              aria-label="New site URL"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
            />
            <input
              type="text"
              value={newSiteName}
              onChange={e => setNewSiteName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddSite() }}
              placeholder="Name (optional)"
              aria-label="New site name"
              className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
            />
            <Button size="sm" className="h-8" onClick={handleAddSite} disabled={!newSiteUrl.trim()}>
              Add Site
            </Button>
            {prefs.groups.length > 0 && (
              <select
                value={newSiteGroupId}
                onChange={e => setNewSiteGroupId(e.target.value)}
                className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
                aria-label="Group for new site"
              >
                <option value="__none__">No group</option>
                {prefs.groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>
        </SettingsRowBlock>
      </SettingsGroupBlock>
    </>
  )
}
