import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

// User preferences for what Thinking Space is allowed to write into the
// user's vault: `writeAiRaw` gates the raw-signal harvesters (Apple Screen
// Time mirror, GoodNotes reading log), `writeAiActivity` the AI-digest
// mirror. Prefs are keyed per vault root in main-process persistence
// (userData/state/vault-write-prefs.json) — one vault per profile, so this
// window's stored vault root scopes every call. Main is the source of truth
// because the electron startup path fires the harvesters before the renderer
// has mounted; this module is a thin async facade over the IPC bridge.
//
// On non-electron runtimes there is no vault to write into, so we report the
// toggle as effectively off and no-op the setter.

function getBridge() {
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.isElectron) return null
  if (typeof api.vaultWritesAiRawGetPersisted !== 'function') return null
  if (typeof api.vaultWritesAiRawSetPersisted !== 'function') return null
  return api
}

export function isVaultWritePrefsAvailable(): boolean {
  return getBridge() !== null
}

export async function getVaultWriteAiRawEnabled(): Promise<boolean> {
  const api = getBridge()
  if (!api) return false
  try {
    return await api.vaultWritesAiRawGetPersisted!(getStoredVaultRoot())
  } catch {
    return false
  }
}

export async function setVaultWriteAiRawEnabled(enabled: boolean): Promise<void> {
  const api = getBridge()
  if (!api) return
  await api.vaultWritesAiRawSetPersisted!(enabled, getStoredVaultRoot())
}

export async function getVaultWriteAiActivityEnabled(): Promise<boolean> {
  const api = getBridge()
  if (!api || typeof api.vaultWritesAiActivityGetPersisted !== 'function') return false
  try {
    return await api.vaultWritesAiActivityGetPersisted!(getStoredVaultRoot())
  } catch {
    return false
  }
}

export async function setVaultWriteAiActivityEnabled(enabled: boolean): Promise<void> {
  const api = getBridge()
  if (!api || typeof api.vaultWritesAiActivitySetPersisted !== 'function') return
  await api.vaultWritesAiActivitySetPersisted!(enabled, getStoredVaultRoot())
}
