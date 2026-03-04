import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import AiSettingsOrch from '@/components/orchestrators/AiSettingsOrch'
import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { UI_THEME_OPTIONS_BLOCK, useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { USER_PROFILE_FILE_PATH_BLOCK, deriveUserProfileSymbolBlock } from '@/services/lego_blocks/units/userProfileBlock'
import { clearAppCacheOrch, hardRefreshOrch } from '@/services/orchestrators/appCacheOrch'
import {
  readMarkdownEditorSettingsOrch,
  writeMarkdownEditorSettingsOrch,
  type MarkdownEditorSettingsBlock,
} from '@/services/orchestrators/markdownEditorSettingsOrch'
import { isCapacitorNative, isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  getDefaultF9ExecutionSettingsOrch,
  readF9ExecutionSettingsOrch,
  writeF9ExecutionSettingsOrch,
} from '@/personal_extension/services/orchestrators/f9ExecutionSettingsOrch'
import {
  clearF9WebullCredentialsBlock,
  readF9WebullCredentialStatusBlock,
  saveF9WebullCredentialsBlock,
} from '@/personal_extension/services/lego_blocks/units/f9WebullConfigBlock'
import {
  clearGoogleDriveAuthOrch,
  connectGoogleDriveAuthOrch,
  getGoogleOauthClientIdOrch,
  readGoogleDriveAuthOrch,
  setGoogleOauthClientIdOrch,
} from '@/services/orchestrators/googleDriveAuthOrch'
import {
  DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK,
  type ExplorerFolderColorPreferenceBlock,
  type ExplorerIconStyleBlock,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import type { UIThemeId } from '@/services/orchestrators/uiThemeOrch'
import type { ThinkingSpaceRegistryEntryOrch } from '@/services/orchestrators/spaceRegistryOrch'

export type SettingsTabId = 'theme' | 'explorer' | 'ai' | 'google_docs_sheets' | 'f9' | 'cache' | 'vault'
export type SettingsTabWithProfileId = SettingsTabId | 'profile'

interface SettingsOrchProps {
  explorerIconStyle: ExplorerIconStyleBlock
  onExplorerIconStyleChange: (nextStyle: ExplorerIconStyleBlock) => void
  explorerFolderColorRules: ExplorerFolderColorPreferenceBlock[]
  onExplorerFolderColorRulesChange: (nextRules: ExplorerFolderColorPreferenceBlock[]) => Promise<void> | void
  onRequestVaultSwitch: () => void
  activeSpaceId: string
  thinkingSpaces: ThinkingSpaceRegistryEntryOrch[]
  onSwitchThinkingSpace: (spaceId: string) => void
  initialTab?: SettingsTabWithProfileId
}

function createExplorerColorRuleId(): string {
  return `explorer-color-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeExplorerFolderPathInput(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function createExplorerRuleKey(rule: Pick<ExplorerFolderColorPreferenceBlock, 'folderPath' | 'includeDescendants'>): string {
  return `${normalizeExplorerFolderPathInput(rule.folderPath)}::${rule.includeDescendants ? 'all' : 'single'}`
}

const TAB_OPTIONS: Array<{ id: SettingsTabWithProfileId; label: string }> = [
  { id: 'theme', label: 'Theme' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'profile', label: 'Profile' },
  { id: 'ai', label: 'AI' },
  { id: 'google_docs_sheets', label: 'Google Docs and Sheets' },
  { id: 'f9', label: 'F9' },
  { id: 'cache', label: 'Clear Cache' },
  { id: 'vault', label: 'Select Thinking Space' },
]

export default function SettingsOrch({
  explorerIconStyle,
  onExplorerIconStyleChange,
  explorerFolderColorRules,
  onExplorerFolderColorRulesChange,
  onRequestVaultSwitch,
  activeSpaceId,
  thinkingSpaces,
  onSwitchThinkingSpace,
  initialTab = 'theme',
}: SettingsOrchProps) {
  const { profile, loading: profileLoading, saveProfile, reloadProfile } = useUserProfileBlock()
  const { themeId, setThemeId } = useUIThemeBlock()
  const [activeTab, setActiveTab] = useState<SettingsTabWithProfileId>(initialTab)
  const [markdownEditorSettings, setMarkdownEditorSettings] = useState<MarkdownEditorSettingsBlock>(
    () => readMarkdownEditorSettingsOrch(),
  )
  const [f9ExecutionFolderPathInput, setF9ExecutionFolderPathInput] = useState<string>(
    () => readF9ExecutionSettingsOrch().executionFolderPath,
  )
  const [f9SavedExecutionFolderPath, setF9SavedExecutionFolderPath] = useState<string>(
    () => readF9ExecutionSettingsOrch().executionFolderPath,
  )
  const [f9WebullAppKeyInput, setF9WebullAppKeyInput] = useState('')
  const [f9WebullAppSecretInput, setF9WebullAppSecretInput] = useState('')
  const [f9WebullCredentialsConfigured, setF9WebullCredentialsConfigured] = useState(false)
  const [f9WebullAppKeyHint, setF9WebullAppKeyHint] = useState<string | null>(null)
  const [f9WebullSecureStorageAvailable, setF9WebullSecureStorageAvailable] = useState(false)
  const [googleOauthClientIdInput, setGoogleOauthClientIdInput] = useState(() => getGoogleOauthClientIdOrch() ?? '')
  const [googleDriveConnected, setGoogleDriveConnected] = useState(() => Boolean(readGoogleDriveAuthOrch()?.accessToken))
  const [googleDriveAuthBusy, setGoogleDriveAuthBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<SettingsTabId | null>(null)
  const [busySpaceSwitchId, setBusySpaceSwitchId] = useState<string | null>(null)
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
  const runtimeLabel = useMemo(() => {
    if (isElectron()) return 'desktop'
    if (isCapacitorNative()) return 'mobile'
    return 'web'
  }, [])
  const f9CredentialEditingSupported = isElectron()

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    let cancelled = false
    if (activeTab !== 'f9') return
    void readF9WebullCredentialStatusBlock()
      .then((status) => {
        if (cancelled) return
        setF9WebullCredentialsConfigured(status.configured)
        setF9WebullAppKeyHint(status.appKeyHint)
        setF9WebullSecureStorageAvailable(status.secureStorageAvailable)
      })
      .catch(() => {
        if (cancelled) return
        setF9WebullCredentialsConfigured(false)
        setF9WebullAppKeyHint(null)
        setF9WebullSecureStorageAvailable(false)
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

  const onSwitchVault = () => {
    const confirmed = window.confirm('Open Thinking Space selector and hot-switch to the selected space?')
    if (!confirmed) return
    setError(null)
    setMessage('Opening Thinking Space selector...')
    onRequestVaultSwitch()
  }

  const onSwitchRegisteredSpace = (space: ThinkingSpaceRegistryEntryOrch) => {
    if (space.spaceId === activeSpaceId) return
    const confirmed = window.confirm(`Switch to "${space.label}" without reloading the app?`)
    if (!confirmed) return
    setBusySpaceSwitchId(space.spaceId)
    setError(null)
    setMessage(`Switching to ${space.label}...`)
    try {
      onSwitchThinkingSpace(space.spaceId)
      setMessage(`Switched to ${space.label}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch Thinking Space')
    } finally {
      setBusySpaceSwitchId(null)
    }
  }

  const updateMarkdownEditorSettings = (nextSettings: MarkdownEditorSettingsBlock) => {
    setMarkdownEditorSettings(nextSettings)
    writeMarkdownEditorSettingsOrch(nextSettings)
  }

  const onSaveF9Settings = () => {
    const normalized = f9ExecutionFolderPathInput.trim()
    if (!normalized) {
      setError('F9 execution folder path cannot be empty.')
      return
    }
    setBusyAction('f9')
    setError(null)
    setMessage(null)
    try {
      const saved = writeF9ExecutionSettingsOrch({ executionFolderPath: normalized })
      setF9ExecutionFolderPathInput(saved.executionFolderPath)
      setF9SavedExecutionFolderPath(saved.executionFolderPath)
      setMessage('F9 execution folder path saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save F9 settings')
    } finally {
      setBusyAction(null)
    }
  }

  const onResetF9Settings = () => {
    setBusyAction('f9')
    setError(null)
    setMessage(null)
    try {
      const defaults = getDefaultF9ExecutionSettingsOrch()
      const saved = writeF9ExecutionSettingsOrch(defaults)
      setF9ExecutionFolderPathInput(saved.executionFolderPath)
      setF9SavedExecutionFolderPath(saved.executionFolderPath)
      setMessage('F9 execution folder path reset to default.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset F9 settings')
    } finally {
      setBusyAction(null)
    }
  }

  const onSaveF9WebullCredentials = async () => {
    if (!f9CredentialEditingSupported) {
      setError('Webull secure credentials are currently supported only in Electron desktop runtime.')
      return
    }
    const appKey = f9WebullAppKeyInput.trim()
    const appSecret = f9WebullAppSecretInput.trim()
    if (!appKey) {
      setError('Webull app key cannot be empty.')
      return
    }
    if (!appSecret) {
      setError('Webull app secret cannot be empty.')
      return
    }
    setBusyAction('f9')
    setError(null)
    setMessage(null)
    try {
      const status = await saveF9WebullCredentialsBlock({ appKey, appSecret })
      setF9WebullCredentialsConfigured(status.configured)
      setF9WebullAppKeyHint(status.appKeyHint)
      setF9WebullSecureStorageAvailable(status.secureStorageAvailable)
      setF9WebullAppSecretInput('')
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

  const onClearF9WebullCredentials = async () => {
    if (!f9CredentialEditingSupported) {
      setError('Webull secure credentials are currently supported only in Electron desktop runtime.')
      return
    }
    setBusyAction('f9')
    setError(null)
    setMessage(null)
    try {
      const status = await clearF9WebullCredentialsBlock()
      setF9WebullCredentialsConfigured(status.configured)
      setF9WebullAppKeyHint(status.appKeyHint)
      setF9WebullSecureStorageAvailable(status.secureStorageAvailable)
      setF9WebullAppKeyInput('')
      setF9WebullAppSecretInput('')
      setMessage('Webull credentials cleared from secure device storage.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear Webull credentials')
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
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
      <aside className="self-start">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-2">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Sections
          </p>
          <div className="space-y-1">
            {TAB_OPTIONS.map(tab => (
              <Button
                key={tab.id}
                type="button"
                variant={activeTab === tab.id ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </aside>

      <div className="space-y-4 min-w-0">
      {activeTab === 'theme' && (
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Personalize the interface look.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="ltm-settings-theme-select" className="text-sm font-medium">
                App Theme
              </label>
              <select
                id="ltm-settings-theme-select"
                value={themeId}
                onChange={(event) => setThemeId(event.target.value as UIThemeId)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              >
                {UI_THEME_OPTIONS_BLOCK.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 border-t border-border/50 pt-4">
              <h3 className="text-sm font-medium text-foreground">Markdown Editor</h3>
              <p className="text-xs text-muted-foreground">
                Configure how markdown is displayed in view mode.
              </p>
              <label className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2.5">
                <div className="space-y-0.5">
                  <div className="text-sm text-foreground">Preserve spaces in view mode</div>
                  <div className="text-xs text-muted-foreground">Keeps repeated and trailing spaces visible.</div>
                </div>
                <Switch
                  checked={markdownEditorSettings.preserveSpacesInViewMode}
                  onCheckedChange={(checked) => updateMarkdownEditorSettings({
                    ...markdownEditorSettings,
                    preserveSpacesInViewMode: checked,
                  })}
                  aria-label="Preserve spaces in view mode"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2.5">
                <div className="space-y-0.5">
                  <div className="text-sm text-foreground">Preserve new lines in view mode</div>
                  <div className="text-xs text-muted-foreground">Renders soft line breaks as visible line breaks.</div>
                </div>
                <Switch
                  checked={markdownEditorSettings.preserveNewlinesInViewMode}
                  onCheckedChange={(checked) => updateMarkdownEditorSettings({
                    ...markdownEditorSettings,
                    preserveNewlinesInViewMode: checked,
                  })}
                  aria-label="Preserve new lines in view mode"
                />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'explorer' && (
        <Card>
          <CardHeader>
            <CardTitle>Explorer</CardTitle>
            <CardDescription>
              Configure explorer icon style and custom folder color rules (saved in Thinking Space UI preferences).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="ltm-settings-explorer-icon-style-select" className="text-sm font-medium">
                Explorer Icon Style
              </label>
              <select
                id="ltm-settings-explorer-icon-style-select"
                value={explorerIconStyle}
                onChange={(event) => onExplorerIconStyleChange(event.target.value as ExplorerIconStyleBlock)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              >
                <option value="outline">Outline</option>
                <option value="filled">Filled</option>
              </select>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Folder Color Rules</h3>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onLoadLegacyExplorerColorRules}>
                    Load Legacy Preset
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={onAddExplorerColorRule}>
                    Add Rule
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each rule colors a folder icon by relative path. Enable descendants to apply the color to nested folders.
              </p>

              <div className="space-y-2">
                {explorerFolderColorRulesDraft.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    No custom rules yet. Add one to color explorer folders.
                  </div>
                )}
                {explorerFolderColorRulesDraft.map((rule) => (
                  <div key={rule.id} className="grid gap-2 rounded-md border border-border/60 p-2 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Folder Path</label>
                      <input
                        type="text"
                        value={rule.folderPath}
                        onChange={(event) => onUpdateExplorerColorRule(rule.id, { folderPath: event.target.value })}
                        placeholder="example/folder/path"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Color</label>
                      <input
                        type="color"
                        value={rule.color}
                        onChange={(event) => onUpdateExplorerColorRule(rule.id, { color: event.target.value })}
                        className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-1"
                        aria-label={`Color for ${rule.folderPath || 'new rule'}`}
                      />
                    </div>
                    <label className="inline-flex h-9 items-center gap-2 text-xs text-foreground">
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
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => onRemoveExplorerColorRule(rule.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
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
                onClick={onResetExplorerColorRules}
                disabled={busyAction === 'explorer' || !explorerRulesDirty}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'profile' && (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your profile is stored in your Thinking Space folder at <span className="font-mono">{USER_PROFILE_FILE_PATH_BLOCK}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="ltm-settings-profile-name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="ltm-settings-profile-name"
                type="text"
                value={profileNameInput}
                onChange={(event) => {
                  setProfileNameInput(event.target.value)
                  setProfileDirty(true)
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ltm-settings-profile-symbol" className="text-sm font-medium">
                Profile Symbol
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="ltm-settings-profile-symbol"
                  type="text"
                  value={profileSymbolInput}
                  onChange={(event) => {
                    setProfileSymbolInput(event.target.value)
                    setProfileDirty(true)
                  }}
                  placeholder={deriveUserProfileSymbolBlock(profileNameInput)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                />
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-sm font-semibold text-foreground">
                  {profileSymbolInput.trim() || deriveUserProfileSymbolBlock(profileNameInput)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="ltm-settings-profile-memories" className="text-sm font-medium">
                AI Memories
              </label>
              <textarea
                id="ltm-settings-profile-memories"
                value={profileMemoriesInput}
                onChange={(event) => {
                  setProfileMemoriesInput(event.target.value)
                  setProfileDirty(true)
                }}
                placeholder="One memory per line. AI can append to these later."
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              />
              <p className="text-xs text-muted-foreground">
                {profileLoading ? 'Loading profile…' : 'Memories are stored as plain text lines in your profile.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
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
          </CardContent>
        </Card>
      )}

      {activeTab === 'ai' && (
        <AiSettingsOrch />
      )}

      {activeTab === 'google_docs_sheets' && (
        <Card>
          <CardHeader>
            <CardTitle>Google Docs and Sheets</CardTitle>
            <CardDescription>
              Optional setup for Drive picker. Opening/editing Docs and Sheets works from the in-app Google view without this.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sign in once inside a Google Doc/Sheet view and that session is reused. Add OAuth client ID only if you want Pick from Drive.
            </p>
            <div className="space-y-2">
              <label htmlFor="ltm-settings-google-oauth-client-id" className="text-sm font-medium">
                Google OAuth Client ID
              </label>
              <input
                id="ltm-settings-google-oauth-client-id"
                type="text"
                value={googleOauthClientIdInput}
                onChange={(event) => setGoogleOauthClientIdInput(event.target.value)}
                placeholder="1234567890-xxxx.apps.googleusercontent.com"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
              <p className="text-xs text-muted-foreground">
                Required only for Connect Google / Pick from Drive. The placeholder is an example format.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Drive picker status: {googleDriveConnected ? 'connected' : 'not connected'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onSaveGoogleOauthClientId}
              >
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
          </CardContent>
        </Card>
      )}

      {activeTab === 'f9' && (
        <Card>
          <CardHeader>
            <CardTitle>F9 Settings</CardTitle>
            <CardDescription>
              Configure secure Webull credentials and where F9 stores execution files.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <h3 className="text-sm font-medium text-foreground">Webull API Credentials</h3>
              {!f9CredentialEditingSupported && (
                <p className="text-xs text-muted-foreground">
                  Secure credential entry is currently available only in the Electron desktop app.
                </p>
              )}
              {f9CredentialEditingSupported && !f9WebullSecureStorageAvailable && (
                <p className="text-xs text-destructive">
                  Secure storage is unavailable on this device/runtime. Webull credentials cannot be saved safely.
                </p>
              )}
              <div className="space-y-2">
                <label htmlFor="ltm-settings-f9-webull-app-key" className="text-sm font-medium">
                  Webull App Key
                </label>
                <input
                  id="ltm-settings-f9-webull-app-key"
                  type="text"
                  value={f9WebullAppKeyInput}
                  onChange={(event) => setF9WebullAppKeyInput(event.target.value)}
                  placeholder="Enter app key"
                  disabled={!f9CredentialEditingSupported}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="ltm-settings-f9-webull-app-secret" className="text-sm font-medium">
                  Webull App Secret
                </label>
                <input
                  id="ltm-settings-f9-webull-app-secret"
                  type="password"
                  value={f9WebullAppSecretInput}
                  onChange={(event) => setF9WebullAppSecretInput(event.target.value)}
                  placeholder="Enter app secret"
                  disabled={!f9CredentialEditingSupported}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Current status: {f9WebullCredentialsConfigured ? `configured (${f9WebullAppKeyHint ?? 'saved'})` : 'not configured'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => { void onSaveF9WebullCredentials() }}
                  disabled={busyAction === 'f9' || !f9CredentialEditingSupported}
                >
                  {busyAction === 'f9' ? 'Saving...' : 'Save Credentials'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void onClearF9WebullCredentials() }}
                  disabled={busyAction === 'f9' || !f9CredentialEditingSupported || !f9WebullCredentialsConfigured}
                >
                  Clear Credentials
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              <h3 className="text-sm font-medium text-foreground">Execution Storage</h3>
              <p className="text-xs text-muted-foreground">
                Configure where F9 stores `overall.json`, company index files, and per-position markdown files.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="ltm-settings-f9-execution-folder" className="text-sm font-medium">
                Execution Folder Path
              </label>
              <input
                id="ltm-settings-f9-execution-folder"
                type="text"
                value={f9ExecutionFolderPathInput}
                onChange={(event) => setF9ExecutionFolderPathInput(event.target.value)}
                placeholder="Absolute or Thinking Space-relative path"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Current saved value: <span className="font-mono">{f9SavedExecutionFolderPath}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={onSaveF9Settings}
                disabled={busyAction === 'f9'}
              >
                {busyAction === 'f9' ? 'Saving...' : 'Save F9 Path'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onResetF9Settings}
                disabled={busyAction === 'f9'}
              >
                Reset to Default
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'cache' && (
        <Card>
          <CardHeader>
            <CardTitle>Clear Cache</CardTitle>
            <CardDescription>
              Clears local app cache (IndexedDB + local settings cache) and reloads the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Thinking Space selection is preserved, but local caches will be rebuilt after refresh.
            </p>
            <p className="text-sm text-muted-foreground">
              Clear Cache removes local API/OAuth credentials stored in app cache (for example AI and Google Drive),
              so you may need to sign in again.
            </p>
            <Button type="button" onClick={onClearCache} disabled={busyAction === 'cache'}>
              {busyAction === 'cache' ? 'Clearing cache...' : 'Clear Cache'}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'vault' && (
        <Card>
          <CardHeader>
            <CardTitle>Select Thinking Space</CardTitle>
            <CardDescription>
              Open the folder selector for this {runtimeLabel} runtime. Thinking Space hot-switches without reloading the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Registered Spaces</p>
              {thinkingSpaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Thinking Spaces have been registered yet.</p>
              ) : (
                <div className="space-y-2">
                  {thinkingSpaces.map((space) => {
                    const active = space.spaceId === activeSpaceId
                    return (
                      <div
                        key={space.spaceId}
                        className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{space.label}</span>
                              {active && (
                                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="break-all font-mono text-xs text-muted-foreground">{space.root}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Runtime: {space.runtime} · Last opened: {new Date(space.lastOpenedAt).toLocaleString()}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={active ? 'outline' : 'default'}
                            disabled={active || busySpaceSwitchId === space.spaceId}
                            onClick={() => onSwitchRegisteredSpace(space)}
                          >
                            {busySpaceSwitchId === space.spaceId ? 'Switching...' : (active ? 'Current Space' : 'Switch')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Add or Select New Space</p>
              <p className="text-sm text-muted-foreground">
                Use the selector to connect a new Thinking Space root or recover from stale folder context.
              </p>
              <Button type="button" onClick={onSwitchVault}>
                Open Thinking Space Selector
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Switching Thinking Space folders does not delete API keys or credentials.
            </p>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
