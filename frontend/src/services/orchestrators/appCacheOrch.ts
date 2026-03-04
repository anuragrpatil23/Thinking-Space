import { deleteAllThinkingSpaceDbs } from '@/services/lego_blocks/integrations/dbBlock'
import { STORAGE_KEYS, clearAllSpaceStorageBlock, getStoredVaultRoot } from './storageOrch'

const LAST_SYNC_STORAGE_KEY_ORCH = 'thinkingspace:lastSyncTimestamp'
const FS_HANDLE_DB_NAME_ORCH = 'ltm-fs-handles'

export interface ClearAppCacheOptionsOrch {
  preserveVaultRoot?: boolean
}

function removeStorageKeyOrch(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch {
    // Ignore local storage errors in restricted runtimes.
  }
}

function setStorageKeyOrch(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    // Ignore local storage errors in restricted runtimes.
  }
}

async function deleteIndexedDbOrch(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

export async function clearAppCacheOrch(options: ClearAppCacheOptionsOrch = {}): Promise<void> {
  const preserveVaultRoot = options.preserveVaultRoot ?? true
  const vaultRoot = preserveVaultRoot ? getStoredVaultRoot() : null

  clearAllSpaceStorageBlock()
  for (const key of Object.values(STORAGE_KEYS)) {
    removeStorageKeyOrch(key)
  }
  removeStorageKeyOrch(LAST_SYNC_STORAGE_KEY_ORCH)

  if (preserveVaultRoot && vaultRoot) {
    setStorageKeyOrch(STORAGE_KEYS.vaultRoot, vaultRoot)
  }

  await Promise.all([
    deleteAllThinkingSpaceDbs().catch(() => {}),
    deleteIndexedDbOrch(FS_HANDLE_DB_NAME_ORCH).catch(() => {}),
  ])
}

export function hardRefreshOrch(): void {
  window.location.reload()
}
