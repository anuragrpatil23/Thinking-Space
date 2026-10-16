// Subscribe to vault file changes this app did not make — an agent saving a
// note, Obsidian, iCloud bringing in another device's edit. Rides the watcher
// App starts for vault live refresh (chokidar in main, ref-counted per root),
// so this adds a listener, not a watcher. Electron only; elsewhere a no-op.

import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { wasRecentSelfWriteBlock } from '@/services/lego_blocks/units/selfWriteTrackerBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

export type VaultExternalChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface VaultExternalChange {
  kind: VaultExternalChangeKind
  /** Absolute path as the watcher reported it. */
  path: string
  /** Vault-relative path, or null when it falls outside the stored vault root. */
  relPath: string | null
}

function toVaultRelative(absPath: string): string | null {
  const root = (getStoredVaultRoot() ?? '').replace(/\/+$/, '')
  if (!root) return null
  if (absPath === root) return ''
  return absPath.startsWith(`${root}/`) ? absPath.slice(root.length + 1) : null
}

export function subscribeExternalVaultChangesBlock(handler: (change: VaultExternalChange) => void): () => void {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!isElectron() || !api?.onVaultWatchEvent) return () => undefined
  return api.onVaultWatchEvent(event => {
    if (!event?.path || wasRecentSelfWriteBlock(event.path)) return
    handler({ kind: event.kind, path: event.path, relPath: toVaultRelative(event.path) })
  })
}
