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
  // The web build stores the token `browser-fs`, not a path — its last segment
  // is not a name, and it was showing in the composer's breadcrumb as if it
  // were one (2026-10-29). The browser does reveal the opened folder's *name*
  // (never its path); fsBlock reports it here when the folder connects.
  if (vaultRoot === BROWSER_VAULT_ROOT) return browserVaultFolderName
  return vaultNameFromRootBlock(vaultRoot)
}

/** Mirrors `BROWSER_VAULT_ROOT_BLOCK` (fsBlock); a unit can't import an integration. */
const BROWSER_VAULT_ROOT = 'browser-fs'
let browserVaultFolderName: string | null = null

/** Called by fsBlock when a browser-opened folder connects. */
export function setBrowserVaultFolderNameBlock(name: string | null): void {
  browserVaultFolderName = name?.trim() || null
}
