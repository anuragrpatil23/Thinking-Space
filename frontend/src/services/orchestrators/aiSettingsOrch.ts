import {
  AI_SETTINGS_SCOPE_ORDER,
  isAiSettingsScope,
  readAiSettingsBlock,
  resolveAiProviderForScopeBlock,
  resolveAiThinkingForProviderBlock,
  resolveAiThinkingForScopeProviderBlock,
  resolveAiThinkingOverrideForScopeProviderBlock,
  resolveContractThinkingBlock,
  resolveAiModelForScopeProviderBlock,
  resolveAiModelForProviderBlock,
  setSelectedAiThinkingBlock,
  setSelectedAiThinkingForScopeBlock,
  setSelectedAiProviderForScopeBlock,
  setSelectedAiModelForScopeBlock,
  setSelectedAiModelBlock,
  setSelectedAiProviderBlock,
  type AiSettingsScope,
  type AiSettings,
} from '@/services/lego_blocks/integrations/aiSettingsBlock'
import {
  AI_PROVIDER_ORDER,
  listProviderModelsBlock,
  listProvidersBlock,
  type AiProvider,
  type AiProviderStatus,
} from '@/services/lego_blocks/integrations/aiProviderBlock'
import { aiDebugBlock, aiDebugWarnBlock } from '@/services/lego_blocks/units/aiDebugBlock'

export interface ResolveAiSelectionInput {
  provider?: AiProvider | null
  model?: string | null
  scope?: AiSettingsScope | null
}

export type { AiSettingsScope, AiSettings }

export interface ResolvedAiSelection {
  provider: AiProvider
  model: string
  scope: AiSettingsScope | null
  providers: AiProviderStatus[]
}

function normalizeModel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function pickAvailableProvider(
  providers: AiProviderStatus[],
  preferred: Array<AiProvider | null | undefined>,
): AiProvider | null {
  const available = new Set(providers.filter(item => item.available).map(item => item.provider))
  if (available.size === 0) return null

  for (const candidate of preferred) {
    if (candidate && available.has(candidate)) return candidate
  }
  for (const provider of AI_PROVIDER_ORDER) {
    if (available.has(provider)) return provider
  }
  return providers.find(item => item.available)?.provider ?? null
}

export function getAiSettingsOrch(): AiSettings {
  return readAiSettingsBlock()
}

export function setAiSelectedProviderOrch(provider: AiProvider | null): AiSettings {
  return setSelectedAiProviderBlock(provider)
}

export function setAiProviderModelOrch(provider: AiProvider, model: string): AiSettings {
  return setSelectedAiModelBlock(provider, model)
}

export function setAiScopeProviderOrch(scope: AiSettingsScope, provider: AiProvider | null): AiSettings {
  return setSelectedAiProviderForScopeBlock(scope, provider)
}

export function setAiScopeProviderModelOrch(
  scope: AiSettingsScope,
  provider: AiProvider,
  model: string,
): AiSettings {
  return setSelectedAiModelForScopeBlock(scope, provider, model)
}

export function setAiProviderThinkingOrch(provider: AiProvider, enabled: boolean): AiSettings {
  return setSelectedAiThinkingBlock(provider, enabled)
}

export function setAiScopeProviderThinkingOrch(
  scope: AiSettingsScope,
  provider: AiProvider,
  enabled: boolean | null,
): AiSettings {
  return setSelectedAiThinkingForScopeBlock(scope, provider, enabled)
}

export function listAiModelOptionsOrch(provider: AiProvider): string[] {
  return listProviderModelsBlock(provider)
}

export function listAiModelScopesOrch(): AiSettingsScope[] {
  return [...AI_SETTINGS_SCOPE_ORDER]
}

export function resolveAiSelectionFromProvidersOrch(
  providers: AiProviderStatus[],
  input?: ResolveAiSelectionInput,
): ResolvedAiSelection | null {
  const settings = readAiSettingsBlock()
  const scope = isAiSettingsScope(input?.scope) ? input!.scope : null
  const provider = pickAvailableProvider(providers, [
    input?.provider,
    scope ? resolveAiProviderForScopeBlock(scope, settings) : null,
    settings.selectedProvider,
    ...AI_PROVIDER_ORDER,
  ])

  if (!provider) {
    aiDebugWarnBlock('selection_unresolved_no_available_provider', {
      input: input ?? null,
      settings,
      providers: providers.map((item) => ({
        provider: item.provider,
        available: item.available,
        model: item.model,
      })),
    })
    return null
  }

  if (!scope && settings.selectedProvider !== provider) {
    setSelectedAiProviderBlock(provider)
  }

  const requestedModel = normalizeModel(input?.model)
  if (requestedModel) {
    if (scope) setSelectedAiModelForScopeBlock(scope, provider, requestedModel)
    else setSelectedAiModelBlock(provider, requestedModel)
  }

  const model = requestedModel || (
    scope
      ? resolveAiModelForScopeProviderBlock(scope, provider, settings)
      : resolveAiModelForProviderBlock(provider, settings)
  )

  aiDebugBlock('selection_resolved', {
    input: input ?? null,
    scope,
    provider,
    model,
    requestedModel,
    selectedProviderSetting: settings.selectedProvider,
    providers: providers.map((item) => ({
      provider: item.provider,
      available: item.available,
      model: item.model,
    })),
  })

  return {
    provider,
    model,
    scope,
    providers,
  }
}

export async function resolveAiSelectionOrch(
  input?: ResolveAiSelectionInput,
): Promise<ResolvedAiSelection | null> {
  const providers = await listProvidersBlock()
  return resolveAiSelectionFromProvidersOrch(providers, input)
}

export function resolveAiModelForProviderOrch(provider: AiProvider): string {
  return resolveAiModelForProviderBlock(provider)
}

export function resolveAiModelForScopeProviderOrch(scope: AiSettingsScope, provider: AiProvider): string {
  return resolveAiModelForScopeProviderBlock(scope, provider)
}

export function resolveAiProviderForScopeOrch(scope: AiSettingsScope): AiProvider | null {
  return resolveAiProviderForScopeBlock(scope)
}

export function resolveAiThinkingForProviderOrch(provider: AiProvider): boolean {
  return resolveAiThinkingForProviderBlock(provider)
}

export function resolveAiThinkingForScopeProviderOrch(scope: AiSettingsScope, provider: AiProvider): boolean {
  return resolveAiThinkingForScopeProviderBlock(scope, provider)
}

/** Effective thinking state for INTERNAL contract runs in this scope — the
 *  stricter, explicit-opt-in rule. Differs from
 *  resolveAiThinkingForScopeProviderOrch, which answers for chat and defaults
 *  on. Surfaced so the UI can show what will actually happen. */
export function resolveContractThinkingOrch(scope: AiSettingsScope, provider: AiProvider): boolean {
  return resolveContractThinkingBlock(scope, provider)
}

export function resolveAiThinkingOverrideForScopeProviderOrch(
  scope: AiSettingsScope,
  provider: AiProvider,
): boolean | null {
  return resolveAiThinkingOverrideForScopeProviderBlock(scope, provider)
}
