import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  defaultProviderModelBlock,
  isAiProvider,
  type AiProvider,
} from '@/services/lego_blocks/integrations/aiProviderBlock'

export type AiSettingsScope =
  | 'chat'
  | 'markdown_editor'
  | 'new_thought'
  | 'todos'
  | 'steward_metadata'
  | 'ai_activity'

export const AI_SETTINGS_SCOPE_ORDER: AiSettingsScope[] = [
  'chat',
  'markdown_editor',
  'new_thought',
  'todos',
  'steward_metadata',
  'ai_activity',
]

export interface AiSettings {
  selectedProvider: AiProvider | null
  selectedModelByProvider: Partial<Record<AiProvider, string>>
  selectedProviderByScope: Partial<Record<AiSettingsScope, AiProvider>>
  selectedModelByScopeProvider: Partial<Record<string, string>>
  selectedThinkingByProvider: Partial<Record<AiProvider, boolean>>
  selectedThinkingByScopeProvider: Partial<Record<string, boolean>>
}

const DEFAULT_SETTINGS: AiSettings = {
  selectedProvider: null,
  selectedModelByProvider: {},
  selectedProviderByScope: {},
  selectedModelByScopeProvider: {},
  selectedThinkingByProvider: {},
  selectedThinkingByScopeProvider: {},
}

function sanitizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function sanitizeModelMap(raw: unknown): Partial<Record<AiProvider, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<Record<AiProvider, string>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isAiProvider(key)) continue
    const model = sanitizeModel(value)
    if (model) next[key] = model
  }
  return next
}

function sanitizeThinking(value: unknown): boolean | null {
  if (typeof value !== 'boolean') return null
  return value
}

function sanitizeProviderThinkingMap(raw: unknown): Partial<Record<AiProvider, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<Record<AiProvider, boolean>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isAiProvider(key)) continue
    const thinking = sanitizeThinking(value)
    if (thinking == null) continue
    next[key] = thinking
  }
  return next
}

function sanitizeScopeProviderMap(raw: unknown): Partial<Record<AiSettingsScope, AiProvider>> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<Record<AiSettingsScope, AiProvider>> = {}
  for (const [scope, provider] of Object.entries(raw)) {
    if (!isAiSettingsScope(scope)) continue
    if (!isAiProvider(provider)) continue
    next[scope] = provider
  }
  return next
}

export function isAiSettingsScope(value: unknown): value is AiSettingsScope {
  return value === 'chat'
    || value === 'markdown_editor'
    || value === 'new_thought'
    || value === 'todos'
    || value === 'steward_metadata'
    || value === 'ai_activity'
}

function scopeProviderKey(scope: AiSettingsScope, provider: AiProvider): string {
  return `${scope}:${provider}`
}

function parseScopeProviderKey(value: string): { scope: AiSettingsScope; provider: AiProvider } | null {
  const [scopeRaw, providerRaw] = value.split(':', 2)
  if (!isAiSettingsScope(scopeRaw)) return null
  if (!isAiProvider(providerRaw)) return null
  return { scope: scopeRaw, provider: providerRaw }
}

function sanitizeScopeProviderModelMap(raw: unknown): Partial<Record<string, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<Record<string, string>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!parseScopeProviderKey(key)) continue
    const model = sanitizeModel(value)
    if (!model) continue
    next[key] = model
  }
  return next
}

function sanitizeScopeProviderThinkingMap(raw: unknown): Partial<Record<string, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<Record<string, boolean>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!parseScopeProviderKey(key)) continue
    const thinking = sanitizeThinking(value)
    if (thinking == null) continue
    next[key] = thinking
  }
  return next
}

export function readAiSettingsBlock(): AiSettings {
  const raw = getJsonStorageItem<unknown>(STORAGE_KEYS.aiSettings, DEFAULT_SETTINGS)
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const parsed = raw as Partial<AiSettings>
  return {
    selectedProvider: isAiProvider(parsed.selectedProvider) ? parsed.selectedProvider : null,
    selectedModelByProvider: sanitizeModelMap(parsed.selectedModelByProvider),
    selectedProviderByScope: sanitizeScopeProviderMap(parsed.selectedProviderByScope),
    selectedModelByScopeProvider: sanitizeScopeProviderModelMap(parsed.selectedModelByScopeProvider),
    selectedThinkingByProvider: sanitizeProviderThinkingMap(parsed.selectedThinkingByProvider),
    selectedThinkingByScopeProvider: sanitizeScopeProviderThinkingMap(parsed.selectedThinkingByScopeProvider),
  }
}

export function writeAiSettingsBlock(next: AiSettings): AiSettings {
  const normalized: AiSettings = {
    selectedProvider: isAiProvider(next.selectedProvider) ? next.selectedProvider : null,
    selectedModelByProvider: sanitizeModelMap(next.selectedModelByProvider),
    selectedProviderByScope: sanitizeScopeProviderMap(next.selectedProviderByScope),
    selectedModelByScopeProvider: sanitizeScopeProviderModelMap(next.selectedModelByScopeProvider),
    selectedThinkingByProvider: sanitizeProviderThinkingMap(next.selectedThinkingByProvider),
    selectedThinkingByScopeProvider: sanitizeScopeProviderThinkingMap(next.selectedThinkingByScopeProvider),
  }
  setJsonStorageItem(STORAGE_KEYS.aiSettings, normalized)
  return normalized
}

export function setSelectedAiProviderBlock(provider: AiProvider | null): AiSettings {
  const current = readAiSettingsBlock()
  return writeAiSettingsBlock({
    ...current,
    selectedProvider: isAiProvider(provider) ? provider : null,
  })
}

export function setSelectedAiModelBlock(provider: AiProvider, model: string): AiSettings {
  const normalized = sanitizeModel(model)
  const current = readAiSettingsBlock()
  const nextModels = { ...current.selectedModelByProvider }
  if (normalized) {
    nextModels[provider] = normalized
  } else {
    delete nextModels[provider]
  }
  return writeAiSettingsBlock({
    ...current,
    selectedModelByProvider: nextModels,
  })
}

export function setSelectedAiThinkingBlock(provider: AiProvider, enabled: boolean): AiSettings {
  const current = readAiSettingsBlock()
  const nextThinking = { ...current.selectedThinkingByProvider, [provider]: !!enabled }
  return writeAiSettingsBlock({
    ...current,
    selectedThinkingByProvider: nextThinking,
  })
}

export function setSelectedAiProviderForScopeBlock(
  scope: AiSettingsScope,
  provider: AiProvider | null,
): AiSettings {
  const current = readAiSettingsBlock()
  const nextMap = { ...current.selectedProviderByScope }

  if (provider && isAiProvider(provider)) {
    nextMap[scope] = provider
  } else {
    delete nextMap[scope]
  }

  return writeAiSettingsBlock({
    ...current,
    selectedProviderByScope: nextMap,
  })
}

export function setSelectedAiModelForScopeBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  model: string,
): AiSettings {
  const normalized = sanitizeModel(model)
  const current = readAiSettingsBlock()
  const nextMap = { ...current.selectedModelByScopeProvider }
  const key = scopeProviderKey(scope, provider)

  if (normalized) {
    nextMap[key] = normalized
  } else {
    delete nextMap[key]
  }

  return writeAiSettingsBlock({
    ...current,
    selectedModelByScopeProvider: nextMap,
  })
}

export function setSelectedAiThinkingForScopeBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  enabled: boolean | null,
): AiSettings {
  const current = readAiSettingsBlock()
  const nextMap = { ...current.selectedThinkingByScopeProvider }
  const key = scopeProviderKey(scope, provider)

  if (typeof enabled === 'boolean') {
    nextMap[key] = enabled
  } else {
    delete nextMap[key]
  }

  return writeAiSettingsBlock({
    ...current,
    selectedThinkingByScopeProvider: nextMap,
  })
}

export function resolveAiModelForProviderBlock(provider: AiProvider, settings?: AiSettings): string {
  const snapshot = settings ?? readAiSettingsBlock()
  const configured = sanitizeModel(snapshot.selectedModelByProvider[provider])
  return configured || defaultProviderModelBlock(provider)
}

export function resolveAiModelForScopeProviderBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  settings?: AiSettings,
): string {
  const snapshot = settings ?? readAiSettingsBlock()
  const scoped = sanitizeModel(snapshot.selectedModelByScopeProvider[scopeProviderKey(scope, provider)])
  if (scoped) return scoped
  return resolveAiModelForProviderBlock(provider, snapshot)
}

export function resolveAiProviderForScopeBlock(
  scope: AiSettingsScope,
  settings?: AiSettings,
): AiProvider | null {
  const snapshot = settings ?? readAiSettingsBlock()
  const scopedProvider = snapshot.selectedProviderByScope[scope]
  if (scopedProvider && isAiProvider(scopedProvider)) return scopedProvider
  return null
}

function defaultThinkingForProvider(provider: AiProvider): boolean {
  if (provider === 'opensource-ai') return true
  return true
}

export function resolveAiThinkingForProviderBlock(provider: AiProvider, settings?: AiSettings): boolean {
  const snapshot = settings ?? readAiSettingsBlock()
  const configured = snapshot.selectedThinkingByProvider[provider]
  if (typeof configured === 'boolean') return configured
  return defaultThinkingForProvider(provider)
}

export function resolveAiThinkingOverrideForScopeProviderBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  settings?: AiSettings,
): boolean | null {
  const snapshot = settings ?? readAiSettingsBlock()
  const configured = snapshot.selectedThinkingByScopeProvider[scopeProviderKey(scope, provider)]
  return typeof configured === 'boolean' ? configured : null
}

export function resolveAiThinkingForScopeProviderBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  settings?: AiSettings,
): boolean {
  const scoped = resolveAiThinkingOverrideForScopeProviderBlock(scope, provider, settings)
  if (typeof scoped === 'boolean') return scoped
  return resolveAiThinkingForProviderBlock(provider, settings)
}

/** Whether hidden reasoning runs for INTERNAL contract runs (chain digest, day
 *  atom, range summary) in this scope.
 *
 *  Deliberately stricter than resolveAiThinkingForScopeProviderBlock, which
 *  answers the same question for chat and defaults to ON. A contract run is a
 *  single shot against a fixed token budget, so an untouched setting has to
 *  mean OFF here or every digest silently gets slower and can be truncated by
 *  its own reasoning trail. Only an explicit opt-in — at scope or provider
 *  level — turns it on.
 *
 *  This is THE definition of that rule. Both the orchestrator that acts on it
 *  and the Settings UI that displays it must call this, or the switch ends up
 *  claiming "on" while runs are off. */
export function resolveContractThinkingBlock(
  scope: AiSettingsScope,
  provider: AiProvider,
  settings?: AiSettings,
): boolean {
  const snapshot = settings ?? readAiSettingsBlock()
  const scoped = resolveAiThinkingOverrideForScopeProviderBlock(scope, provider, snapshot)
  if (typeof scoped === 'boolean') return scoped
  const providerLevel = snapshot.selectedThinkingByProvider[provider]
  if (typeof providerLevel === 'boolean') return providerLevel
  return false
}
