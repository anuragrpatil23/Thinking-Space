// Central lookup for intelligence providers. Callers ask for a provider by
// id; the registry hands back the (singleton) implementation. Also owns the
// user's default-provider preference — stored in localStorage under a stable
// key so it survives across sessions.

import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'
import { openaiCompatProvider } from './providers/openaiCompatProviderBlock'
import { anthropicProvider } from './providers/anthropicProviderBlock'
import { claudeCliProvider } from './providers/claudeCliProviderBlock'
import type { IntelligenceProvider } from './providers/providerInterfaceBlock'
import {
  generationSourceForProviderBlock,
  type GenerationSource,
  type ProviderId,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

const PROVIDERS: Record<ProviderId, IntelligenceProvider> = {
  'openai-compat': openaiCompatProvider,
  'anthropic': anthropicProvider,
  'claude-cli': claudeCliProvider,
}

const KNOWN_IDS: readonly ProviderId[] = ['openai-compat', 'anthropic', 'claude-cli']

const FALLBACK_DEFAULT: ProviderId = 'openai-compat'

export function getProviderBlock(id: ProviderId): IntelligenceProvider {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`unknown intelligence provider: ${id}`)
  return p
}

export function listProvidersBlock(): IntelligenceProvider[] {
  return Object.values(PROVIDERS)
}

export function readDefaultProviderBlock(): ProviderId {
  const stored = getJsonStorageItem<string>(STORAGE_KEYS.intelligenceDefaultProvider, FALLBACK_DEFAULT)
  return (KNOWN_IDS as readonly string[]).includes(stored) ? (stored as ProviderId) : FALLBACK_DEFAULT
}

export function writeDefaultProviderBlock(id: ProviderId): void {
  setJsonStorageItem(STORAGE_KEYS.intelligenceDefaultProvider, id)
}

// Resolve which provider a request should run against, given the caller's
// explicit choice (or none). Falls back to first-configured when the default
// isn't set up — so users who only configured Claude get Claude, not a hard
// error, when they run a task.
export function resolveProviderBlock(explicit?: ProviderId): IntelligenceProvider {
  if (explicit) return getProviderBlock(explicit)
  const preferred = getProviderBlock(readDefaultProviderBlock())
  if (preferred.isConfigured()) return preferred
  for (const p of listProvidersBlock()) {
    if (p.isConfigured()) return p
  }
  return preferred
}

/** The generation source a run *right now* would use — driven by the same
 *  resolution `runContract` does (default provider, else first configured).
 *  Records tag themselves with this so a later provider switch (e.g. local →
 *  claude) can detect the mismatch and regenerate. */
export function currentGenerationSourceBlock(): GenerationSource {
  return generationSourceForProviderBlock(resolveProviderBlock().id)
}
