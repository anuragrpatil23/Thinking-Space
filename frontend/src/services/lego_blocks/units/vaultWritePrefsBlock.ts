import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

// User preferences for what Thinking Space is allowed to write into the
// user's vault. Currently a single toggle — `writeAiRaw` — that gates the
// raw-signal harvesters (Apple Screen Time mirror, GoodNotes reading log).
// The main process is the source of truth (userData/state/vault-write-prefs.json)
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
  await api.vaultWritesAiRawSetPersisted!(enabled)
}
