import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

// User preferences for what Thinking Space is allowed to write into the
// user's vault: `writeAiRaw` gates the raw-signal harvesters (Apple Screen
// Time mirror), `writeAiActivity` the AI-digest mirror. Prefs are keyed per
// vault root in main-process persistence (userData/state/vault-write-prefs.json)
// — one vault per profile, so this window's stored vault root scopes every
// call. Main is the source of truth because the electron startup path fires
// the harvesters before the renderer has mounted; this module is a thin async
// facade over the IPC bridge.
//
// Only Electron can *read* these prefs, and the individual getters report
// false without the bridge — correct for the harvesters, which are Electron-
// only anyway. `getVaultWriteAiActivityAnyEnabled` deliberately does NOT
// inherit that: see the note on it.

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

// True when the vault accepts *any* AI-Activity write — either the raw-signal
// harvesters (`writeAiRaw`) or the AI-derived digests mirror (`writeAiActivity`)
// is on. This is the gate for first-party authored durable data living in the
// `ai-activity/` folder — hand-logged manual sessions and in-app reading spans
// — which ride the folder's write permission generally rather than being stuck
// behind the digests-mirror opt-in specifically.
//
// **An unreadable preference is permissive.** The prefs live in Electron's
// main process, so iPhone/iPad/web have no way to read them; inheriting the
// getters' `false` would mean reading is never logged on the iPad, which is
// where most reading happens. That is the same rule powerStateBlock follows
// for Low Power Mode (`known: false` disables the gate, not the feature): a
// gate that cannot see its input must not silently disable a feature on a
// surface that has no problem. The permission it stands in for is a *desktop*
// concern — whether harvesters may write into a vault the desktop manages.
export async function getVaultWriteAiActivityAnyEnabled(): Promise<boolean> {
  if (!isVaultWritePrefsAvailable()) return true
  const [raw, digests] = await Promise.all([
    getVaultWriteAiRawEnabled(),
    getVaultWriteAiActivityEnabled(),
  ])
  return raw || digests
}
