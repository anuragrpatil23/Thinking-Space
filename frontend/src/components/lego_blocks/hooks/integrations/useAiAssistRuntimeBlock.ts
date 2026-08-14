import { useCallback, useEffect, useState } from 'react'
import type { AiProvider } from '@/services/orchestrators/chatOrch'
import { runAiAssistOrch, type AiAssistAction, type RunAiAssistResult } from '@/services/orchestrators/aiAssistOrch'
import {
  listAiModelOptionsOrch,
  resolveAiSelectionOrch,
  resolveAiThinkingForScopeProviderOrch,
  setAiScopeProviderOrch,
  setAiScopeProviderModelOrch,
  setAiScopeProviderThinkingOrch,
} from '@/services/orchestrators/aiSettingsOrch'
import {
  listAiAssistPromptHistoryOrch,
  recordAiAssistPromptHistoryOrch,
  type AiAssistPromptHistoryEntryBlock,
} from '@/services/orchestrators/aiAssistPromptHistoryOrch'
import type { AiSettingsScope } from '@/services/lego_blocks/integrations/aiSettingsBlock'
import { resolveModelProfileBlock } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

export interface AiAssistResultPill {
  tone: 'neutral' | 'success' | 'error'
  text: string
}

export interface AiAssistProviderOption {
  provider: AiProvider
  label: string
  available: boolean
}

export interface AiAssistRuntimeBlockState {
  aiSelectionLoading: boolean
  selectedProvider: AiProvider | null
  selectedModel: string | null
  providerOptions: AiAssistProviderOption[]
  setSelectedProvider: (provider: AiProvider) => void
  selectedModelOptions: string[]
  setSelectedModel: (model: string) => void
  showThinkToggle: boolean
  thinkEnabled: boolean
  setThinkEnabled: (enabled: boolean) => void
  assistRunningAction: AiAssistAction | null
  assistError: string | null
  assistResultPill: AiAssistResultPill | null
  assistSuggestion: RunAiAssistResult | null
  customPromptHistory: AiAssistPromptHistoryEntryBlock[]
  runAssistAction: (action: AiAssistAction, content: string, customPrompt?: string) => Promise<RunAiAssistResult | null>
  applyAssistSuggestion: (onApply: (nextContent: string) => void, overrideContent?: string) => boolean
  dismissAssistSuggestion: () => void
  clearAssistState: () => void
}

export interface UseAiAssistRuntimeBlockOptions {
  scope: AiSettingsScope
  useCase: string
  syncedModelScopes?: AiSettingsScope[]
  syncedProviderScopes?: AiSettingsScope[]
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

/** Toggle visibility comes from the shared model quirks table rather than a
 *  substring list local to this hook — one place to update when a family
 *  lands. Unknown local models stay default-open via the unknownLocal entry's
 *  thinkingToggleVisible. */
function modelSupportsThinkingToggleBlock(provider: AiProvider | null, model: string | null): boolean {
  if (provider !== 'opensource-ai') return false
  const normalized = (model ?? '').trim()
  if (!normalized || normalized.toLowerCase() === 'local-model') return true
  return resolveModelProfileBlock(normalized, 'openai-compat').thinkingToggleVisible
}

export function useAiAssistRuntimeBlock(options: UseAiAssistRuntimeBlockOptions): AiAssistRuntimeBlockState {
  const [aiSelectionLoading, setAiSelectionLoading] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null)
  const [selectedModel, setSelectedModelState] = useState<string | null>(null)
  const [providerOptions, setProviderOptions] = useState<AiAssistProviderOption[]>([])
  const [selectedModelOptions, setSelectedModelOptions] = useState<string[]>([])
  const [thinkEnabled, setThinkEnabledState] = useState(true)
  const [assistRunningAction, setAssistRunningAction] = useState<AiAssistAction | null>(null)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [assistResultPill, setAssistResultPill] = useState<AiAssistResultPill | null>(null)
  const [assistSuggestion, setAssistSuggestion] = useState<RunAiAssistResult | null>(null)
  const [customPromptHistory, setCustomPromptHistory] = useState<AiAssistPromptHistoryEntryBlock[]>([])

  const syncSelection = useCallback(async () => {
    const selection = await resolveAiSelectionOrch({ scope: options.scope })
    setSelectedProvider(selection?.provider ?? null)
    setSelectedModelState(selection?.model ?? null)
    setProviderOptions(
      selection?.providers.map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        available: provider.available,
      })) ?? [],
    )
    if (selection?.provider) {
      const providerKnownModels = listAiModelOptionsOrch(selection.provider)
      const providerResolvedModel = selection.providers.find(item => item.provider === selection.provider)?.model?.trim() ?? ''
      const resolvedSelectionModel = selection.model.trim()
      const ordered = [resolvedSelectionModel, providerResolvedModel, ...providerKnownModels]
      const deduped = Array.from(new Set(ordered.filter(model => model.length > 0)))
      setSelectedModelOptions(deduped)
    } else {
      setSelectedModelOptions([])
    }
    const nextThinkEnabled = selection?.provider === 'opensource-ai'
      ? resolveAiThinkingForScopeProviderOrch(options.scope, 'opensource-ai')
      : true
    setThinkEnabledState(nextThinkEnabled)
    return selection
  }, [options.scope])

  useEffect(() => {
    let cancelled = false
    setAiSelectionLoading(true)
    syncSelection()
      .catch(() => {
        if (cancelled) return
        setSelectedProvider(null)
        setSelectedModelState(null)
        setProviderOptions([])
        setSelectedModelOptions([])
      })
      .finally(() => {
        if (!cancelled) setAiSelectionLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [syncSelection])

  useEffect(() => {
    let cancelled = false
    listAiAssistPromptHistoryOrch(40)
      .then((entries) => {
        if (!cancelled) setCustomPromptHistory(entries)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[useAiAssistRuntimeBlock] Failed to load custom prompt history:', error)
        setCustomPromptHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setThinkEnabled = useCallback((enabled: boolean) => {
    setThinkEnabledState(enabled)
    setAiScopeProviderThinkingOrch(options.scope, 'opensource-ai', enabled)
  }, [options.scope])

  const setSelectedProviderValue = useCallback((provider: AiProvider) => {
    const scopesToUpdate = Array.from(new Set<AiSettingsScope>([
      options.scope,
      ...(options.syncedProviderScopes ?? []),
    ]))
    for (const scope of scopesToUpdate) {
      setAiScopeProviderOrch(scope, provider)
    }
    void syncSelection()
  }, [options.scope, options.syncedProviderScopes, syncSelection])

  const setSelectedModel = useCallback((model: string) => {
    if (!selectedProvider) return
    const normalizedModel = model.trim()
    if (!normalizedModel) return
    const scopesToUpdate = Array.from(new Set<AiSettingsScope>([
      options.scope,
      ...(options.syncedModelScopes ?? []),
    ]))
    for (const scope of scopesToUpdate) {
      setAiScopeProviderModelOrch(scope, selectedProvider, normalizedModel)
    }
    setSelectedModelState(normalizedModel)
    setSelectedModelOptions((current) => (
      current.includes(normalizedModel)
        ? current
        : [normalizedModel, ...current]
    ))
  }, [options.scope, options.syncedModelScopes, selectedProvider])

  const runAssistAction = useCallback(async (action: AiAssistAction, content: string, customPrompt?: string) => {
    if (assistRunningAction) return null
    const normalizedCustomPrompt = (customPrompt ?? '').trim()
    if (!content.trim()) {
      setAssistError('Add some text before running AI assist.')
      setAssistResultPill({ tone: 'error', text: 'Add some text first' })
      setAssistSuggestion(null)
      return null
    }
    if (action === 'custom' && !normalizedCustomPrompt) {
      setAssistError('Add a prompt before running AI assist.')
      setAssistResultPill({ tone: 'error', text: 'Prompt is required' })
      setAssistSuggestion(null)
      return null
    }

    setAssistRunningAction(action)
    setAssistError(null)
    setAssistResultPill(null)
    setAssistSuggestion(null)

    try {
      if (action === 'custom') {
        try {
          const nextPromptHistory = await recordAiAssistPromptHistoryOrch(normalizedCustomPrompt)
          setCustomPromptHistory(nextPromptHistory.slice(0, 40))
        } catch (historyError) {
          console.warn('[useAiAssistRuntimeBlock] Failed to persist custom prompt history:', historyError)
        }
      }
      const selection = await syncSelection()
      if (!selection) {
        throw new Error('No AI provider available. Configure one in AI Settings.')
      }
      const result = await runAiAssistOrch({
        provider: selection.provider,
        model: selection.model,
        scope: options.scope,
        useCase: options.useCase,
        action,
        content,
        customPrompt: normalizedCustomPrompt,
        think: selection.provider === 'opensource-ai' ? thinkEnabled : undefined,
      })
      if (!result.changed) {
        setAssistError(null)
        setAssistResultPill({ tone: 'neutral', text: `No ${action} changes suggested` })
        return null
      }
      setAssistSuggestion(result)
      setAssistResultPill({ tone: 'success', text: `${action} suggestion ready` })
      return result
    } catch (err) {
      const nextError = errorMessage(err, 'AI assist failed')
      setAssistError(nextError)
      setAssistResultPill({ tone: 'error', text: 'AI assist failed' })
      return null
    } finally {
      setAssistRunningAction(null)
    }
  }, [assistRunningAction, options.scope, options.useCase, syncSelection, thinkEnabled])

  const applyAssistSuggestion = useCallback((onApply: (nextContent: string) => void, overrideContent?: string): boolean => {
    if (!assistSuggestion) return false
    onApply(overrideContent ?? assistSuggestion.suggestedContent)
    setAssistSuggestion(null)
    setAssistError(null)
    setAssistResultPill({ tone: 'success', text: 'Applied inline' })
    return true
  }, [assistSuggestion])

  const dismissAssistSuggestion = useCallback(() => {
    setAssistSuggestion(null)
  }, [])

  const clearAssistState = useCallback(() => {
    setAssistError(null)
    setAssistSuggestion(null)
    setAssistRunningAction(null)
    setAssistResultPill(null)
  }, [])

  useEffect(() => {
    if (!assistResultPill) return
    const timeoutId = window.setTimeout(() => {
      setAssistResultPill(null)
    }, 3200)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [assistResultPill])

  return {
    aiSelectionLoading,
    selectedProvider,
    selectedModel,
    providerOptions,
    setSelectedProvider: setSelectedProviderValue,
    selectedModelOptions,
    setSelectedModel,
    showThinkToggle: modelSupportsThinkingToggleBlock(selectedProvider, selectedModel),
    thinkEnabled,
    setThinkEnabled,
    assistRunningAction,
    assistError,
    assistResultPill,
    assistSuggestion,
    customPromptHistory,
    runAssistAction,
    applyAssistSuggestion,
    dismissAssistSuggestion,
    clearAssistState,
  }
}
