import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  SETTINGS_CONTROL_CLASS_BLOCK,
  SETTINGS_PANE_WIDTH_BLOCK,
  SettingsGroupBlock,
  SettingsRowBlock,
  SettingsSectionHeaderBlock,
} from '@/components/lego_blocks/units/SettingsGroupBlock'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import AiTelemetryPanelBlock from '@/components/lego_blocks/integrations/AiTelemetryPanelBlock'
import AiConnectionsBlock from '@/components/lego_blocks/integrations/AiConnectionsBlock'
import AiPerAreaBlock from '@/components/lego_blocks/integrations/AiPerAreaBlock'
import IntelligenceRecentRequestsBlock from '@/components/lego_blocks/integrations/IntelligenceRecentRequestsBlock'
import IntelligenceTuningBlock from '@/components/lego_blocks/integrations/IntelligenceTuningBlock'
import { listProvidersOrch, type AiProvider, type AiProviderStatus } from '@/services/orchestrators/chatOrch'
import { isCapacitorNative, isElectron } from '@/services/orchestrators/runtimeOrch'
import { availability, diagnose, type DiagnosticsSnapshot } from '@/services/orchestrators/intelligenceOrch'
import {
  readDefaultProviderBlock,
  writeDefaultProviderBlock,
} from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import {
  clearImportedAiLoginsOrch,
  generateDesktopAiLoginTransferCodeOrch,
  getImportedAiLoginStateOrch,
  importAiLoginTransferCodeOrch,
} from '@/services/orchestrators/aiLoginTransferOrch'
import {
  listAiModelOptionsOrch,
  resolveAiModelForProviderOrch,
  resolveAiSelectionFromProvidersOrch,
  resolveAiThinkingForProviderOrch,
  setAiProviderModelOrch,
  setAiProviderThinkingOrch,
  setAiSelectedProviderOrch,
} from '@/services/orchestrators/aiSettingsOrch'
import {
  clearAiTelemetryEventsOrch,
  listAiTelemetryEventsOrch,
  type AiTelemetryEvent,
} from '@/services/orchestrators/aiTelemetryOrch'
import { useVisibleIntervalBlock } from '@/components/lego_blocks/hooks/shared/useVisibleIntervalBlock'

// Settings → AI, in the order it is used: which AI does the work (the app has
// two systems — chat & writing, and background tasks — each with its own
// default, shown side by side and said plainly), per-area overrides, how to
// reach each AI, what ran lately; the rarely-touched rest folded under Advanced.

const BACKGROUND_PROVIDER_LABELS: Record<ProviderId, string> = {
  'openai-compat': 'Local model',
  anthropic: 'Claude API',
  'claude-cli': 'Claude Code CLI',
}

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
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [probing, setProbing] = useState(false)
  const [backgroundProvider, setBackgroundProvider] = useState<ProviderId>(() => readDefaultProviderBlock())
  const [thinkingOn, setThinkingOn] = useState(() => resolveAiThinkingForProviderOrch('opensource-ai'))
  const [transferCodeInput, setTransferCodeInput] = useState('')
  const [generatingTransferCode, setGeneratingTransferCode] = useState(false)
  const [telemetryEvents, setTelemetryEvents] = useState<AiTelemetryEvent[]>([])
  const [loadingTelemetry, setLoadingTelemetry] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const say = useCallback((text: string, isError = false) => {
    if (isError) { setError(text); setMessage(null) } else { setMessage(text); setError(null) }
  }, [])

  const loadProviders = useCallback(async (options?: { forceBackendRefresh?: boolean }): Promise<boolean> => {
    setLoadingProviders(true)
    try {
      const items = await listProvidersOrch({ forceBackendRefresh: !!options?.forceBackendRefresh })
      setProviders(items)
      const selection = resolveAiSelectionFromProvidersOrch(items)
      setSelectedProvider(selection?.provider ?? null)
      setModelInput(selection?.model ?? '')
      setError(null)
      return true
    } catch (err) {
      setError(errorMessage(err, 'Failed to load AI providers'))
      return false
    } finally {
      setLoadingProviders(false)
    }
  }, [])

  // Background-task providers: configured, reachable, default model
  const probe = useCallback(async (force = false) => {
    if (!nativeRuntime) return
    setProbing(true)
    try {
      if (force) await Promise.all((['openai-compat', 'anthropic', 'claude-cli'] as ProviderId[]).map(id => availability(id).catch(() => null)))
      setSnapshot(await diagnose())
    } finally {
      setProbing(false)
    }
  }, [nativeRuntime])

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
    void probe(false)
    loadTelemetry()
  }, [loadProviders, probe, loadTelemetry])

  // The chat log only refreshes while Advanced is open (no timer otherwise)
  useVisibleIntervalBlock(loadTelemetry, advancedOpen ? 3000 : null)

  const knownModels = selectedProvider ? listAiModelOptionsOrch(selectedProvider) : []
  const backgroundStatus = useMemo(() => snapshot?.providers.find(p => p.id === backgroundProvider) ?? null, [snapshot, backgroundProvider])
  const labelOf = (provider: AiProvider | null) => providers.find(p => p.provider === provider)?.label ?? provider ?? '—'

  const onProviderChange = (provider: AiProvider) => {
    setAiSelectedProviderOrch(provider)
    setSelectedProvider(provider)
    setModelInput(resolveAiModelForProviderOrch(provider))
    say(`Chat & writing now use ${labelOf(provider)}.`)
  }

  const onSaveModel = () => {
    if (!selectedProvider) return
    const normalized = modelInput.trim()
    if (!normalized) { say('Model cannot be empty.', true); return }
    try {
      setAiProviderModelOrch(selectedProvider, normalized)
      setModelInput(resolveAiModelForProviderOrch(selectedProvider))
      say(`Default model for ${labelOf(selectedProvider)} set to ${normalized}.`)
    } catch (err) {
      say(errorMessage(err, 'Failed to save the model'), true)
    }
  }

  const onConnectionsChanged = async () => {
    await loadProviders()
    await probe(true)
  }

  const onHardRefreshProviders = async () => {
    setHardRefreshingProviders(true)
    try {
      if (await loadProviders({ forceBackendRefresh: true })) say('Provider status refreshed from the backend.')
    } finally {
      setHardRefreshingProviders(false)
    }
  }

  const onGenerateTransferCode = async () => {
    setGeneratingTransferCode(true)
    try {
      setTransferCodeInput(await generateDesktopAiLoginTransferCodeOrch())
      say('Desktop AI login transfer code generated.')
    } catch (err) {
      say(errorMessage(err, 'Failed to generate a transfer code from the desktop login'), true)
    } finally {
      setGeneratingTransferCode(false)
    }
  }

  const onImportTransferCode = async () => {
    try {
      importAiLoginTransferCodeOrch(transferCodeInput)
      await loadProviders()
      const imported = getImportedAiLoginStateOrch()
      const names = [imported.hasClaudeOauth ? 'Claude OAuth' : null, imported.hasCodexOauth ? 'Codex OAuth' : null].filter(Boolean)
      say(names.length > 0 ? `Imported ${names.join(' + ')} desktop login.` : 'Transfer code imported.')
    } catch (err) {
      say(errorMessage(err, 'Failed to import the transfer code'), true)
    }
  }

  const onClearImportedLogins = async () => {
    try {
      clearImportedAiLoginsOrch()
      await loadProviders()
      say('Imported desktop AI logins cleared.')
    } catch (err) {
      say(errorMessage(err, 'Failed to clear imported desktop logins'), true)
    }
  }

  return (
    <>
      <SettingsSectionHeaderBlock
        title="AI"
        description="Which AI does the work, and how the app reaches it."
      />

      {message && <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'text-[13px] text-emerald-700 dark:text-emerald-300')}>{message}</p>}
      {error && <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'text-[13px] text-destructive')}>{error}</p>}

      <SettingsGroupBlock
        heading="Which AI"
        description="The app has two kinds of AI work, each with its own default. Areas below can override either."
      >
        {loadingProviders ? (
          <SettingsRowBlock label={<span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detecting providers…</span>} />
        ) : providers.length === 0 ? (
          <SettingsRowBlock label="No providers detected." description="Set one up under Connections." />
        ) : (
          <>
            <SettingsRowBlock
              label="Chat, editor & writing"
              description="The Chat tab, inline assist in the editor, New Note."
              stacked
              className="gap-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedProvider ?? ''}
                  onChange={(event) => onProviderChange(event.target.value as AiProvider)}
                  aria-label="Chat and writing provider"
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[12rem]')}
                >
                  {providers.map(p => (
                    <option key={p.provider} value={p.provider} disabled={!p.available}>{p.label}{p.available ? '' : ' (unavailable)'}</option>
                  ))}
                </select>
                <input
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  disabled={!selectedProvider}
                  list="ai-default-models"
                  aria-label="Chat and writing model"
                  placeholder={selectedProvider === 'opensource-ai' ? 'Model id, e.g. qwen/qwen3.5-35b-a3b' : 'Model'}
                  className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[16rem] flex-1')}
                />
                <datalist id="ai-default-models">{knownModels.map(m => <option key={m} value={m} />)}</datalist>
                <Button size="sm" onClick={onSaveModel} disabled={!selectedProvider || !modelInput.trim()}>Save model</Button>
              </div>
            </SettingsRowBlock>

            {nativeRuntime && (
              <SettingsRowBlock
                label="Background tasks"
                description={(
                  <>
                    Session titles, digests, the Feed&apos;s AI reader.
                    {backgroundStatus && (
                      <span className={cn('block', backgroundStatus.available ? '' : 'text-red-600 dark:text-red-400')}>
                        {backgroundStatus.available
                          ? `Ready${backgroundStatus.defaultModel ? ` · ${backgroundStatus.defaultModel}` : ''}`
                          : backgroundStatus.reason ?? (backgroundStatus.configured ? 'Not reachable' : 'Not set up: see Connections')}
                      </span>
                    )}
                  </>
                )}
                control={(
                  <select
                    value={backgroundProvider}
                    onChange={(event) => {
                      const id = event.target.value as ProviderId
                      writeDefaultProviderBlock(id)
                      setBackgroundProvider(id)
                      say(`Background tasks now use ${BACKGROUND_PROVIDER_LABELS[id]}.`)
                    }}
                    aria-label="Background tasks provider"
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[12rem]')}
                  >
                    {(Object.keys(BACKGROUND_PROVIDER_LABELS) as ProviderId[]).map(id => (
                      <option key={id} value={id}>{BACKGROUND_PROVIDER_LABELS[id]}</option>
                    ))}
                  </select>
                )}
              />
            )}

            <SettingsRowBlock
              as="label"
              label="Thinking (local model)"
              description="Whether the local model reasons before it answers, for both kinds of work. Off is faster; areas below can override it."
              control={(
                <Switch
                  checked={thinkingOn}
                  onCheckedChange={(checked) => {
                    setAiProviderThinkingOrch('opensource-ai', checked)
                    setThinkingOn(checked)
                    say(`Local model thinking ${checked ? 'on' : 'off'} by default.`)
                  }}
                  aria-label="Thinking for the local model"
                />
              )}
            />
          </>
        )}
      </SettingsGroupBlock>

      {!loadingProviders && providers.length > 0 && (
        <SettingsGroupBlock heading="Per area" description="Each area follows the defaults above unless you change it here.">
          <AiPerAreaBlock providers={providers} onMessage={say} />
        </SettingsGroupBlock>
      )}

      {nativeRuntime && (
        <SettingsGroupBlock heading="Connections" description="How the app reaches each AI. Kept on this device only.">
          <AiConnectionsBlock
            snapshot={snapshot}
            refreshing={probing}
            onRefresh={() => { void probe(true) }}
            onChanged={onConnectionsChanged}
            onMessage={say}
          />
        </SettingsGroupBlock>
      )}

      {nativeRuntime && (
        <SettingsGroupBlock heading="Recent requests" description="Background tasks as they run: model, thinking, tokens and time.">
          <SettingsRowBlock stacked>
            <IntelligenceRecentRequestsBlock />
          </SettingsRowBlock>
        </SettingsGroupBlock>
      )}

      <div className={SETTINGS_PANE_WIDTH_BLOCK}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(v => !v)}
          aria-expanded={advancedOpen}
          className="inline-flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-90')} />
          Advanced
        </button>
      </div>

      {advancedOpen && (
        <>
          {nativeRuntime && (
            <SettingsGroupBlock
              heading="Intelligence tuning"
              description="What a local digest costs, and the measurements behind each choice. Judgement calls that depend on your machine and model."
            >
              <SettingsRowBlock stacked>
                <IntelligenceTuningBlock />
              </SettingsRowBlock>
            </SettingsGroupBlock>
          )}

          <AiTelemetryPanelBlock
            events={telemetryEvents}
            loading={loadingTelemetry}
            onRefresh={loadTelemetry}
            onClear={() => { clearAiTelemetryEventsOrch(); setTelemetryEvents([]) }}
          />

          {nativeRuntime && (
            <SettingsGroupBlock heading="Desktop login transfer code" description="Move a Claude or Codex login from the desktop app to this device.">
              <SettingsRowBlock stacked className="gap-2">
                <textarea
                  value={transferCodeInput}
                  onChange={(event) => setTransferCodeInput(event.target.value)}
                  aria-label="Desktop login transfer code"
                  className="min-h-[110px] w-full rounded-md border border-input bg-background px-2 py-2 font-mono text-xs outline-none focus:border-ring"
                  placeholder="Paste a transfer code from the desktop app's AI settings"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {isElectron() && (
                    <Button size="sm" variant="outline" disabled={generatingTransferCode} onClick={() => { void onGenerateTransferCode() }}>
                      {generatingTransferCode ? 'Generating…' : 'Generate from desktop login'}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => { void onImportTransferCode() }}>Import code</Button>
                  <Button size="sm" variant="outline" onClick={() => { void onClearImportedLogins() }}>Clear imported logins</Button>
                </div>
              </SettingsRowBlock>
            </SettingsGroupBlock>
          )}

          <SettingsGroupBlock heading="Backend">
            <SettingsRowBlock
              label="Hard refresh"
              description="Ask the backend for every provider's status again, past its cache."
              control={(
                <Button size="sm" variant="outline" disabled={loadingProviders || hardRefreshingProviders} onClick={() => { void onHardRefreshProviders() }}>
                  {hardRefreshingProviders ? 'Refreshing…' : 'Hard refresh'}
                </Button>
              )}
            />
          </SettingsGroupBlock>
        </>
      )}
    </>
  )
}
