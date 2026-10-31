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
import { listProvidersOrch, sendChatWithTelemetryOrch, type AiProvider, type AiProviderStatus } from '@/services/orchestrators/chatOrch'
import { isCapacitorNative, isElectron } from '@/services/orchestrators/runtimeOrch'
import { availability, diagnose, runContract, type DiagnosticsSnapshot } from '@/services/orchestrators/intelligenceOrch'
import { settingsPingContract } from '@/services/lego_blocks/units/intelligence/contracts/settingsPingContractBlock'
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

/** What a Test button found: the reply, the model and the time, or what went wrong. */
interface TestResultBlock {
  ok: boolean
  text: string
}

function StatusPillBlock({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        ok ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />
      {label}
    </span>
  )
}

function TestLineBlock({ result }: { result: TestResultBlock | 'running' | null }) {
  if (!result) return null
  return (
    <div className={cn('px-3.5 pb-3 text-[12px]', result === 'running' ? 'text-muted-foreground' : result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
      {result === 'running' ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Sending a test request…</span> : result.text}
    </div>
  )
}

const secondsBlock = (ms: number) => `${(ms / 1000).toFixed(1)} s`

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
  const [chatTest, setChatTest] = useState<TestResultBlock | 'running' | null>(null)
  const [backgroundTest, setBackgroundTest] = useState<TestResultBlock | 'running' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const say = useCallback((text: string, isError = false) => {
    if (isError) { setError(text); setMessage(null) } else { setMessage(text); setError(null) }
  }, [])
  // A confirmation fades on its own; an error stays until the next change
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  const loadProviders = useCallback(async (options?: { forceBackendRefresh?: boolean }): Promise<boolean> => {
    setLoadingProviders(true)
    try {
      const items = await listProvidersOrch({ forceBackendRefresh: !!options?.forceBackendRefresh })
      setProviders(items)
      const selection = resolveAiSelectionFromProvidersOrch(items)
      setSelectedProvider(selection?.provider ?? null)
      setModelInput(selection?.model ?? '')
      setSavedModel(selection?.model ?? '')
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
  const selectedProviderStatus = providers.find(p => p.provider === selectedProvider) ?? null
  const [savedModel, setSavedModel] = useState('')
  const modelDirty = Boolean(selectedProvider) && modelInput.trim() !== savedModel
  const backgroundStatus = useMemo(() => snapshot?.providers.find(p => p.id === backgroundProvider) ?? null, [snapshot, backgroundProvider])
  const labelOf = (provider: AiProvider | null) => providers.find(p => p.provider === provider)?.label ?? provider ?? '—'

  const onProviderChange = (provider: AiProvider) => {
    setAiSelectedProviderOrch(provider)
    setSelectedProvider(provider)
    setModelInput(resolveAiModelForProviderOrch(provider))
    setSavedModel(resolveAiModelForProviderOrch(provider))
    say(`Chat & writing now use ${labelOf(provider)}.`)
  }

  const onSaveModel = () => {
    if (!selectedProvider) return
    const normalized = modelInput.trim()
    if (!normalized) { say('Model cannot be empty.', true); return }
    try {
      setAiProviderModelOrch(selectedProvider, normalized)
      setModelInput(resolveAiModelForProviderOrch(selectedProvider))
      setSavedModel(resolveAiModelForProviderOrch(selectedProvider))
      say(`Default model for ${labelOf(selectedProvider)} set to ${normalized}.`)
    } catch (err) {
      say(errorMessage(err, 'Failed to save the model'), true)
    }
  }

  // A real request, as small as it gets: proof that this AI answers, and how fast
  const onTestChat = async () => {
    if (!selectedProvider) return
    setChatTest('running')
    const started = performance.now()
    try {
      const { response } = await sendChatWithTelemetryOrch(
        selectedProvider,
        [{ role: 'user', content: 'Reply with: ready' }],
        { model: savedModel || undefined },
        { useCase: 'settings-test' },
      )
      const reply = (response.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
      setChatTest({ ok: Boolean(reply), text: `${reply ? `Answered "${reply}"` : 'Answered with nothing'} · ${response.model || savedModel} · ${secondsBlock(performance.now() - started)}` })
    } catch (err) {
      setChatTest({ ok: false, text: `Failed: ${errorMessage(err, 'no answer')}` })
    }
  }

  const onTestBackground = async () => {
    setBackgroundTest('running')
    const started = performance.now()
    const result = await runContract(settingsPingContract, { at: new Date().toISOString() }, { provider: backgroundProvider, refresh: true, timeoutMs: 120_000, priority: 'interactive' })
    const took = secondsBlock(performance.now() - started)
    setBackgroundTest(result.ok
      ? { ok: true, text: `Answered "${String(result.value)}" · ${result.model} · ${took}` }
      : { ok: false, text: `Failed: ${result.error.message} · ${took}` })
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

      {message && (
        <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400')}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{message}
        </p>
      )}
      {error && <p className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'text-[13px] text-destructive')}>{error}</p>}

      {loadingProviders ? (
        <SettingsGroupBlock heading="Chat & writing">
          <SettingsRowBlock label={<span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detecting providers…</span>} />
        </SettingsGroupBlock>
      ) : providers.length === 0 ? (
        <SettingsGroupBlock heading="Chat & writing">
          <SettingsRowBlock label="No providers detected." description="Set one up under Connections." />
        </SettingsGroupBlock>
      ) : (
        <SettingsGroupBlock
          heading="Chat & writing"
          description="What you ask for: the Chat tab, inline assist in the editor, New Note."
        >
            <div>
            <SettingsRowBlock
              label="Default"
              description="Every area below, unless it says otherwise."
              control={(
                <span className="flex items-center gap-2">
                  {selectedProviderStatus && (
                    <StatusPillBlock ok={selectedProviderStatus.available} label={selectedProviderStatus.available ? 'Ready' : 'Unavailable'} />
                  )}
                  <Button size="sm" variant="outline" disabled={!selectedProvider || chatTest === 'running'} onClick={() => { void onTestChat() }}>Test</Button>
                  {modelDirty && (
                    <Button size="sm" onClick={onSaveModel} disabled={!modelInput.trim()}>Save</Button>
                  )}
                  <select
                    value={selectedProvider ?? ''}
                    onChange={(event) => onProviderChange(event.target.value as AiProvider)}
                    aria-label="Chat and writing provider"
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-40')}
                  >
                    {providers.map(p => (
                      <option key={p.provider} value={p.provider} disabled={!p.available}>{p.label}{p.available ? '' : ' (unavailable)'}</option>
                    ))}
                  </select>
                  <input
                    value={modelInput}
                    onChange={(event) => setModelInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && modelDirty) onSaveModel() }}
                    disabled={!selectedProvider}
                    list="ai-default-models"
                    aria-label="Chat and writing model"
                    placeholder={selectedProvider === 'opensource-ai' ? 'Model id' : 'Model'}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-64', modelDirty && 'border-sky-500/70')}
                  />
                  <datalist id="ai-default-models">{knownModels.map(m => <option key={m} value={m} />)}</datalist>
                </span>
              )}
            />
            <TestLineBlock result={chatTest} />
            </div>

          <AiPerAreaBlock
            providers={providers}
            onMessage={say}
            scopes={['chat', 'markdown_editor', 'new_thought', 'todos', 'steward_metadata']}
          />
        </SettingsGroupBlock>
      )}

      {nativeRuntime && (
        <SettingsGroupBlock
          heading="Background tasks"
          description="What the app does on its own: session titles, digests, the Feed's AI reader."
        >
              <div>
              <SettingsRowBlock
                label="Default"
                description="Every background task. The model comes from the provider."
                control={(
                  <span className="flex items-center gap-2">
                  {backgroundStatus && (
                    <StatusPillBlock
                      ok={backgroundStatus.available}
                      label={backgroundStatus.available ? 'Ready' : backgroundStatus.configured ? 'Unreachable' : 'Not set up'}
                      title={backgroundStatus.available ? undefined : backgroundStatus.reason ?? undefined}
                    />
                  )}
                  <Button size="sm" variant="outline" disabled={backgroundTest === 'running'} onClick={() => { void onTestBackground() }}>Test</Button>
                  <select
                    value={backgroundProvider}
                    onChange={(event) => {
                      const id = event.target.value as ProviderId
                      writeDefaultProviderBlock(id)
                      setBackgroundProvider(id)
                      say(`Background tasks now use ${BACKGROUND_PROVIDER_LABELS[id]}.`)
                    }}
                    aria-label="Background tasks provider"
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-40')}
                  >
                    {(Object.keys(BACKGROUND_PROVIDER_LABELS) as ProviderId[]).map(id => (
                      <option key={id} value={id}>{BACKGROUND_PROVIDER_LABELS[id]}</option>
                    ))}
                  </select>
                  <span className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'inline-flex w-64 items-center truncate text-muted-foreground')} title="The model comes from the provider (for the local server: Connections)">
                    {backgroundStatus?.defaultModel ?? '—'}
                  </span>
                  </span>
                )}
              />
              <TestLineBlock result={backgroundTest} />
              </div>
          {backgroundProvider === 'openai-compat' && (
            <SettingsRowBlock
              as="label"
              label="Thinking"
              description="Whether the local model reasons first. The default for every background task; each one below can turn it on or off. Off is faster."
              control={(
                <Switch
                  checked={thinkingOn}
                  onCheckedChange={(checked) => {
                    setAiProviderThinkingOrch('opensource-ai', checked)
                    setThinkingOn(checked)
                    say(`Background thinking ${checked ? 'on' : 'off'} by default.`)
                  }}
                  aria-label="Thinking for background tasks"
                />
              )}
            />
          )}
          <AiPerAreaBlock
            providers={providers}
            onMessage={say}
            scopes={['ai_activity', 'feed']}
            mode="background"
            localBackground={backgroundProvider === 'openai-compat'}
          />
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
