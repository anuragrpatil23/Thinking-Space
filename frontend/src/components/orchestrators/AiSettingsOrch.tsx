import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import AiTelemetryPanelBlock from '@/components/lego_blocks/integrations/AiTelemetryPanelBlock'
import IntelligenceDiagnosticsBlock from '@/components/lego_blocks/integrations/IntelligenceDiagnosticsBlock'
import { listProvidersOrch, type AiProvider, type AiProviderStatus } from '@/services/orchestrators/chatOrch'
import { isCapacitorNative, isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  clearNativeAiLoginsOrch,
  getNativeAiLoginStateOrch,
  setNativeOpenSourceAiLoginOrch,
  setNativeAzureLoginOrch,
  setNativeClaudeLoginOrch,
  setNativeOpenAiLoginOrch,
} from '@/services/orchestrators/aiCredentialsOrch'
import {
  clearImportedAiLoginsOrch,
  generateDesktopAiLoginTransferCodeOrch,
  getImportedAiLoginStateOrch,
  importAiLoginTransferCodeOrch,
} from '@/services/orchestrators/aiLoginTransferOrch'
import {
  listAiModelOptionsOrch,
  listAiModelScopesOrch,
  resolveAiProviderForScopeOrch,
  resolveAiThinkingForProviderOrch,
  resolveAiThinkingForScopeProviderOrch,
  resolveAiThinkingOverrideForScopeProviderOrch,
  resolveAiModelForScopeProviderOrch,
  resolveAiModelForProviderOrch,
  setAiProviderThinkingOrch,
  setAiScopeProviderThinkingOrch,
  setAiScopeProviderOrch,
  setAiScopeProviderModelOrch,
  resolveAiSelectionFromProvidersOrch,
  setAiProviderModelOrch,
  setAiSelectedProviderOrch,
  type AiSettingsScope,
} from '@/services/orchestrators/aiSettingsOrch'
import {
  clearAiTelemetryEventsOrch,
  listAiTelemetryEventsOrch,
  type AiTelemetryEvent,
} from '@/services/orchestrators/aiTelemetryOrch'

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

export default function AiSettingsOrch() {
  const nativeRuntime = isElectron() || isCapacitorNative()
  const [providers, setProviders] = useState<AiProviderStatus[]>([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [hardRefreshingProviders, setHardRefreshingProviders] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null)
  const [modelInput, setModelInput] = useState('')
  const [scopeModelInputs, setScopeModelInputs] = useState<Partial<Record<AiSettingsScope, string>>>({})
  const [savingModel, setSavingModel] = useState(false)
  const [claudeApiKeyInput, setClaudeApiKeyInput] = useState('')
  const [openAiApiKeyInput, setOpenAiApiKeyInput] = useState('')
  const [azureApiKeyInput, setAzureApiKeyInput] = useState('')
  const [azureEndpointInput, setAzureEndpointInput] = useState('')
  const [azureDeploymentInput, setAzureDeploymentInput] = useState('')
  const [azureApiVersionInput, setAzureApiVersionInput] = useState('')
  const [openSourceAiBaseUrlInput, setOpenSourceAiBaseUrlInput] = useState('')
  const [openSourceAiApiKeyInput, setOpenSourceAiApiKeyInput] = useState('')
  const [openSourceAiModelInput, setOpenSourceAiModelInput] = useState('')
  const [transferCodeInput, setTransferCodeInput] = useState('')
  const [generatingTransferCode, setGeneratingTransferCode] = useState(false)
  const [telemetryEvents, setTelemetryEvents] = useState<AiTelemetryEvent[]>([])
  const [loadingTelemetry, setLoadingTelemetry] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const availableProviders = useMemo(() => providers.filter(item => item.available), [providers])
  const selectedProviderStatus = selectedProvider
    ? providers.find(item => item.provider === selectedProvider) ?? null
    : null
  const selectedKnownModels = selectedProvider ? listAiModelOptionsOrch(selectedProvider) : []
  const scopes = useMemo(() => listAiModelScopesOrch(), [])

  const scopeLabels: Record<AiSettingsScope, string> = {
    chat: 'Chat tab',
    markdown_editor: 'Markdown editor',
    new_thought: 'New Note tab',
    todos: 'New Note todo mode',
    steward_metadata: 'Steward metadata',
  }

  const scopeDescriptions: Record<AiSettingsScope, string> = {
    chat: 'Conversation replies in Chat route.',
    markdown_editor: 'Inline AI assist inside markdown editor.',
    new_thought: 'AI assist for New Note content drafting.',
    todos: 'AI assist for todo text cleanup and clarity.',
    steward_metadata: 'Steward metadata proposal generation.',
  }

  const hydrateScopeInputs = useCallback((items: AiProviderStatus[]) => {
    const next: Partial<Record<AiSettingsScope, string>> = {}
    for (const scope of scopes) {
      const selection = resolveAiSelectionFromProvidersOrch(items, { scope })
      next[scope] = selection?.model ?? ''
    }
    setScopeModelInputs(next)
  }, [scopes])

  const hydrateNativeLoginInputs = useCallback(() => {
    const state = getNativeAiLoginStateOrch()
    setClaudeApiKeyInput(state.claudeApiKey)
    setOpenAiApiKeyInput(state.openAiApiKey)
    setAzureApiKeyInput(state.azureApiKey)
    setAzureEndpointInput(state.azureEndpoint)
    setAzureDeploymentInput(state.azureDeployment)
    setAzureApiVersionInput(state.azureApiVersion)
    setOpenSourceAiBaseUrlInput(state.openSourceAiBaseUrl)
    setOpenSourceAiApiKeyInput(state.openSourceAiApiKey)
    setOpenSourceAiModelInput(state.openSourceAiModel)
  }, [])

  const loadProviders = useCallback(async (options?: { forceBackendRefresh?: boolean }): Promise<boolean> => {
    setLoadingProviders(true)
    try {
      const items = await listProvidersOrch({ forceBackendRefresh: !!options?.forceBackendRefresh })
      setProviders(items)
      const selection = resolveAiSelectionFromProvidersOrch(items)
      setSelectedProvider(selection?.provider ?? null)
      setModelInput(selection?.model ?? '')
      hydrateScopeInputs(items)
      setError(null)
      return true
    } catch (err) {
      setError(errorMessage(err, 'Failed to load AI providers'))
      return false
    } finally {
      setLoadingProviders(false)
    }
  }, [hydrateScopeInputs])

  const loadTelemetry = useCallback(() => {
    setLoadingTelemetry(true)
    try {
      setTelemetryEvents(listAiTelemetryEventsOrch(200))
    } finally {
      setLoadingTelemetry(false)
    }
  }, [])

  useEffect(() => {
    void loadProviders()
    loadTelemetry()
    if (nativeRuntime) {
      hydrateNativeLoginInputs()
    }
  }, [hydrateNativeLoginInputs, loadProviders, loadTelemetry, nativeRuntime])

  useEffect(() => {
    const id = window.setInterval(() => {
      loadTelemetry()
    }, 3000)
    return () => {
      window.clearInterval(id)
    }
  }, [loadTelemetry])

  const onProviderChange = (provider: AiProvider) => {
    setAiSelectedProviderOrch(provider)
    setSelectedProvider(provider)
    setModelInput(resolveAiModelForProviderOrch(provider))
    hydrateScopeInputs(providers)
    setMessage(`Default provider set to ${provider}.`)
    setError(null)
  }

  const onHardRefreshProviders = async () => {
    setHardRefreshingProviders(true)
    try {
      const ok = await loadProviders({ forceBackendRefresh: true })
      if (ok) {
        setMessage('Provider status hard-refreshed from backend.')
        setError(null)
      }
    } finally {
      setHardRefreshingProviders(false)
    }
  }

  const onSaveModel = async () => {
    if (!selectedProvider) return
    const normalized = modelInput.trim()
    if (!normalized) {
      setError('Model cannot be empty.')
      return
    }
    setSavingModel(true)
    try {
      setAiProviderModelOrch(selectedProvider, normalized)
      setModelInput(resolveAiModelForProviderOrch(selectedProvider))
      setMessage(`Default model for ${selectedProvider} updated.`)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to save model setting'))
    } finally {
      setSavingModel(false)
    }
  }

  const onSaveScopeModel = async (scope: AiSettingsScope, provider: AiProvider | null) => {
    if (!provider) return
    const normalized = (scopeModelInputs[scope] ?? '').trim()
    if (!normalized) {
      setError(`Model cannot be empty for ${scopeLabels[scope]}.`)
      return
    }
    setSavingModel(true)
    try {
      setAiScopeProviderModelOrch(scope, provider, normalized)
      setScopeModelInputs((prev) => ({
        ...prev,
        [scope]: resolveAiModelForScopeProviderOrch(scope, provider),
      }))
      setMessage(`${scopeLabels[scope]} model updated (${provider}).`)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, `Failed to save ${scopeLabels[scope]} model setting`))
    } finally {
      setSavingModel(false)
    }
  }

  const onToggleProviderThinking = (provider: AiProvider, enabled: boolean) => {
    setAiProviderThinkingOrch(provider, enabled)
    setMessage(`${provider} thinking ${enabled ? 'enabled' : 'disabled'} by default.`)
    setError(null)
  }

  const onToggleScopeThinking = (
    scope: AiSettingsScope,
    provider: AiProvider,
    enabled: boolean | null,
  ) => {
    setAiScopeProviderThinkingOrch(scope, provider, enabled)
    setMessage(
      enabled == null
        ? `${scopeLabels[scope]} thinking reset to provider default.`
        : `${scopeLabels[scope]} thinking ${enabled ? 'enabled' : 'disabled'}.`,
    )
    setError(null)
  }

  const onSaveNativeLogins = async () => {
    try {
      setNativeClaudeLoginOrch(claudeApiKeyInput)
      setNativeOpenAiLoginOrch(openAiApiKeyInput)
      setNativeAzureLoginOrch({
        apiKey: azureApiKeyInput,
        endpoint: azureEndpointInput,
        deployment: azureDeploymentInput,
        apiVersion: azureApiVersionInput,
      })
      setNativeOpenSourceAiLoginOrch({
        baseUrl: openSourceAiBaseUrlInput,
        apiKey: openSourceAiApiKeyInput,
        model: openSourceAiModelInput,
      })
      hydrateNativeLoginInputs()
      await loadProviders()
      setMessage('Native AI logins updated.')
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to update native AI logins'))
    }
  }

  const onClearNativeLogins = async () => {
    try {
      clearNativeAiLoginsOrch()
      hydrateNativeLoginInputs()
      await loadProviders()
      setMessage('Native AI logins cleared.')
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to clear native AI logins'))
    }
  }

  const onGenerateTransferCode = async () => {
    setGeneratingTransferCode(true)
    try {
      const code = await generateDesktopAiLoginTransferCodeOrch()
      setTransferCodeInput(code)
      setMessage('Desktop AI login transfer code generated.')
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to generate transfer code from desktop login'))
    } finally {
      setGeneratingTransferCode(false)
    }
  }

  const onImportTransferCode = async () => {
    try {
      importAiLoginTransferCodeOrch(transferCodeInput)
      await loadProviders()
      const imported = getImportedAiLoginStateOrch()
      const importedProviders = [
        imported.hasClaudeOauth ? 'Claude OAuth' : null,
        imported.hasCodexOauth ? 'Codex OAuth' : null,
      ].filter(Boolean)
      setMessage(
        importedProviders.length > 0
          ? `Imported ${importedProviders.join(' + ')} desktop login.`
          : 'Transfer code imported.',
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to import transfer code'))
    }
  }

  const onClearImportedLogins = async () => {
    try {
      clearImportedAiLoginsOrch()
      await loadProviders()
      setMessage('Imported desktop AI logins cleared.')
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Failed to clear imported desktop logins'))
    }
  }

  const onClearTelemetry = () => {
    clearAiTelemetryEventsOrch()
    setTelemetryEvents([])
  }

  return (
    <div className="space-y-4">
      {(message || error) && (
        <div className="space-y-2">
          {message && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      )}

      {nativeRuntime && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Native App AI Logins</CardTitle>
            <CardDescription>
              Stored locally on this device for Electron/Capacitor runtime calls (no backend required).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Claude API Key</div>
              <input
                value={claudeApiKeyInput}
                onChange={(event) => setClaudeApiKeyInput(event.target.value)}
                type="password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="sk-ant-..."
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">OpenAI API Key (Codex)</div>
              <input
                value={openAiApiKeyInput}
                onChange={(event) => setOpenAiApiKeyInput(event.target.value)}
                type="password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Azure OpenAI API Key</div>
              <input
                value={azureApiKeyInput}
                onChange={(event) => setAzureApiKeyInput(event.target.value)}
                type="password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Azure API key"
              />
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                value={azureEndpointInput}
                onChange={(event) => setAzureEndpointInput(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Azure endpoint"
              />
              <input
                value={azureDeploymentInput}
                onChange={(event) => setAzureDeploymentInput(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Deployment"
              />
              <input
                value={azureApiVersionInput}
                onChange={(event) => setAzureApiVersionInput(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="API version"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Open Source AI (LM Studio/OpenAI-Compatible)
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  value={openSourceAiBaseUrlInput}
                  onChange={(event) => setOpenSourceAiBaseUrlInput(event.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="http://127.0.0.1:1234/v1"
                />
                <input
                  value={openSourceAiApiKeyInput}
                  onChange={(event) => setOpenSourceAiApiKeyInput(event.target.value)}
                  type="password"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Optional API key"
                />
                <input
                  value={openSourceAiModelInput}
                  onChange={(event) => setOpenSourceAiModelInput(event.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Model id (optional — auto-detected from server)"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => { void onSaveNativeLogins() }}>
                Save Native Logins
              </Button>
              <Button size="sm" variant="outline" onClick={() => { void onClearNativeLogins() }}>
                Clear Native Logins
              </Button>
            </div>

            <div className="h-px bg-border/70" />

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Intelligence Subsystem
              </div>
              <div className="text-xs text-muted-foreground">
                Internal AI tasks (session titles, structured extracts, tool loops) run through a shared intelligence layer.
                Pick the default provider and monitor recent activity below. This is not user chat.
              </div>
              <IntelligenceDiagnosticsBlock />
            </div>

            <div className="h-px bg-border/70" />

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Desktop Login Transfer Code
              </div>
              <textarea
                value={transferCodeInput}
                onChange={(event) => setTransferCodeInput(event.target.value)}
                className="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                placeholder="Paste transfer code from Electron AI Settings"
              />
              <div className="flex flex-wrap items-center gap-2">
                {isElectron() && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generatingTransferCode}
                    onClick={() => { void onGenerateTransferCode() }}
                  >
                    {generatingTransferCode ? 'Generating…' : 'Generate from Desktop Login'}
                  </Button>
                )}
                <Button size="sm" onClick={() => { void onImportTransferCode() }}>
                  Import Transfer Code
                </Button>
                <Button size="sm" variant="outline" onClick={() => { void onClearImportedLogins() }}>
                  Clear Imported Desktop Logins
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Global AI Defaults</CardTitle>
              <CardDescription>
                Provider + fallback model used across AI actions. You can override provider and model per tab below.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={loadingProviders || hardRefreshingProviders}
              onClick={() => { void onHardRefreshProviders() }}
            >
              {hardRefreshingProviders ? 'Hard Refreshing…' : 'Hard Refresh Backend'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingProviders ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Detecting providers...
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
              No providers detected.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Provider
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {providers.map((provider) => (
                    <Button
                      key={provider.provider}
                      size="sm"
                      variant={selectedProvider === provider.provider ? 'default' : 'outline'}
                      disabled={!provider.available}
                      onClick={() => onProviderChange(provider.provider)}
                    >
                      {provider.label}
                      {!provider.available && <span className="ml-1 text-xs opacity-70">unavailable</span>}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Model
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={modelInput}
                    onChange={(event) => setModelInput(event.target.value)}
                    disabled={!selectedProvider || savingModel}
                    placeholder={
                      selectedProvider === 'opensource-ai'
                        ? 'LM Studio API Model Identifier (e.g. qwen/qwen3.5-35b-a3b)'
                        : (selectedProviderStatus?.model || 'Select a provider first')
                    }
                    className="min-w-[18rem] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={() => { void onSaveModel() }} disabled={!selectedProvider || savingModel}>
                    {savingModel ? 'Saving...' : 'Save Model'}
                  </Button>
                </div>
                {selectedKnownModels.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Suggested:
                    {selectedKnownModels.map(model => (
                      <button
                        key={model}
                        type="button"
                        className="rounded-md border border-border/70 px-2 py-0.5 text-foreground hover:bg-muted"
                        onClick={() => setModelInput(model)}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedProvider === 'opensource-ai' && (
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Open Source AI Thinking
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
                    <span className="text-sm text-foreground">Enable thinking by default</span>
                    <Switch
                      checked={resolveAiThinkingForProviderOrch('opensource-ai')}
                      onCheckedChange={(checked) => onToggleProviderThinking('opensource-ai', checked)}
                    />
                  </label>
                  <div className="text-xs text-muted-foreground">
                    Used when a scope does not define its own override.
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Available providers: {availableProviders.map(item => item.provider).join(', ') || 'none'}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Per-Tab Provider + Model Overrides
                </div>
                <div className="space-y-2">
                  {scopes.map((scope) => (
                    <div key={scope} className="rounded-md border border-border/60 bg-muted/20 p-3">
                      {(() => {
                        const selection = resolveAiSelectionFromProvidersOrch(providers, { scope })
                        const scopeProviderOverride = resolveAiProviderForScopeOrch(scope)
                        const scopeProvider = selection?.provider ?? null
                        const knownModels = scopeProvider ? listAiModelOptionsOrch(scopeProvider) : []

                        return (
                          <>
                            <div className="mb-1 text-xs font-medium text-foreground">{scopeLabels[scope]}</div>
                            <div className="mb-2 text-xs text-muted-foreground">{scopeDescriptions[scope]}</div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              {providers.map((provider) => (
                                <Button
                                  key={`${scope}-${provider.provider}`}
                                  size="sm"
                                  variant={scopeProvider === provider.provider ? 'default' : 'outline'}
                                  disabled={!provider.available || savingModel}
                                  onClick={() => {
                                    setAiScopeProviderOrch(scope, provider.provider)
                                    setScopeModelInputs((prev) => ({
                                      ...prev,
                                      [scope]: resolveAiModelForScopeProviderOrch(scope, provider.provider),
                                    }))
                                    setMessage(`${scopeLabels[scope]} provider set to ${provider.provider}.`)
                                    setError(null)
                                  }}
                                >
                                  {provider.label}
                                  {!provider.available && <span className="ml-1 text-xs opacity-70">unavailable</span>}
                                </Button>
                              ))}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!scopeProviderOverride || savingModel}
                                onClick={() => {
                                  setAiScopeProviderOrch(scope, null)
                                  const nextSelection = resolveAiSelectionFromProvidersOrch(providers, { scope })
                                  setScopeModelInputs((prev) => ({
                                    ...prev,
                                    [scope]: nextSelection?.model ?? '',
                                  }))
                                  setMessage(`${scopeLabels[scope]} provider reset to global.`)
                                  setError(null)
                                }}
                              >
                                Use Global Provider
                              </Button>
                            </div>
                            <div className="mb-2 text-xs text-muted-foreground">
                              Effective provider: <span className="text-foreground">{scopeProvider ?? 'none'}</span>
                              {scopeProviderOverride
                                ? <span> (override)</span>
                                : <span> (global)</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={scopeModelInputs[scope] ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value
                                  setScopeModelInputs((prev) => ({ ...prev, [scope]: value }))
                                }}
                                disabled={!scopeProvider || savingModel}
                                className="min-w-[18rem] rounded-md border border-input bg-background px-3 py-2 text-sm"
                                placeholder={scopeProvider ? resolveAiModelForScopeProviderOrch(scope, scopeProvider) : 'No provider available'}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { void onSaveScopeModel(scope, scopeProvider) }}
                                disabled={!scopeProvider || savingModel}
                              >
                                {savingModel ? 'Saving...' : 'Save'}
                              </Button>
                              {scopeProvider && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setAiScopeProviderModelOrch(scope, scopeProvider, '')
                                    setScopeModelInputs((prev) => ({
                                      ...prev,
                                      [scope]: resolveAiModelForScopeProviderOrch(scope, scopeProvider),
                                    }))
                                    setMessage(`${scopeLabels[scope]} model reset to provider/global default.`)
                                    setError(null)
                                  }}
                                  disabled={savingModel}
                                >
                                  Use Provider Default
                                </Button>
                              )}
                            </div>
                            {scopeProvider === 'opensource-ai' && (
                              <div className="mt-2 rounded-md border border-border/60 bg-background px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-xs text-muted-foreground">
                                    Thinking override for {scopeLabels[scope]}
                                  </div>
                                  <Switch
                                    checked={resolveAiThinkingForScopeProviderOrch(scope, 'opensource-ai')}
                                    onCheckedChange={(checked) => onToggleScopeThinking(scope, 'opensource-ai', checked)}
                                  />
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <div className="text-xs text-muted-foreground">
                                    {resolveAiThinkingOverrideForScopeProviderOrch(scope, 'opensource-ai') == null
                                      ? 'Using provider default.'
                                      : 'Scope override active.'}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={resolveAiThinkingOverrideForScopeProviderOrch(scope, 'opensource-ai') == null}
                                    onClick={() => onToggleScopeThinking(scope, 'opensource-ai', null)}
                                  >
                                    Use Provider Default
                                  </Button>
                                </div>
                              </div>
                            )}
                            {knownModels.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                Suggested:
                                {knownModels.map((model) => (
                                  <button
                                    key={`${scope}-${scopeProvider ?? 'none'}-${model}`}
                                    type="button"
                                    className="rounded-md border border-border/70 px-2 py-0.5 text-foreground hover:bg-muted"
                                    onClick={() => {
                                      setScopeModelInputs((prev) => ({ ...prev, [scope]: model }))
                                    }}
                                  >
                                    {model}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AiTelemetryPanelBlock
        events={telemetryEvents}
        loading={loadingTelemetry}
        onRefresh={loadTelemetry}
        onClear={onClearTelemetry}
      />
    </div>
  )
}
