// What to call the vault in the UI.
//
// The vault has no configured display name — it is a folder the user picked, so
// its last path segment is its name ("Long-Term-Memory-iCloud"). That is what
// Obsidian's `obsidian://open?vault=` parameter has always used, and this block
// exists so the composer's path picker and the Obsidian link builder agree
// rather than each inferring it privately.
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

function normalizeVaultRootBlock(vaultRoot: string): string {
  return vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Last path segment of a vault root, or `null` for an empty/rootless path. */
export function vaultNameFromRootBlock(vaultRoot: string): string | null {
  const parts = normalizeVaultRootBlock(vaultRoot).split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : null
}

/** The configured vault's name, or `null` when no vault has been chosen yet.
 *  Callers pick their own fallback — a link builder and a picker label want
 *  different words for "we don't know". */
export function configuredVaultNameBlock(): string | null {
  const vaultRoot = getStoredVaultRoot()
  if (!vaultRoot) return null
  return vaultNameFromRootBlock(vaultRoot)
}
