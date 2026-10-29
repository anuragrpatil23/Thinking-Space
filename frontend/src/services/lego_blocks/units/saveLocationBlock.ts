// Where a save actually lands, in words a person recognises.
//
// "Saved" only says something happened; "Saved to iCloud" answers the worry
// people actually have — is it somewhere safe? (Google Docs' "Saved to Drive".)
// "Vault" is our word, not theirs, so the provider is named whenever the vault
// path gives it away, and anything else synced is still called the cloud.

/** Mirrors `BROWSER_VAULT_ROOT_BLOCK` (fsBlock); a unit can't import an integration. */
const BROWSER_VAULT_ROOT = 'browser-fs'

export type SaveLocationKindBlock = 'icloud' | 'google-drive' | 'dropbox' | 'onedrive' | 'cloud' | 'folder' | 'device'

export interface SaveLocationBlock {
  kind: SaveLocationKindBlock
  /** Completes "Saved …" — e.g. "to iCloud", "on this Mac". */
  phrase: string
  synced: boolean
}

export function saveLocationBlock(vaultRoot: string | null, platform: { isMac: boolean }): SaveLocationBlock {
  const root = vaultRoot ?? ''
  // The web build's vault is a folder the browser was handed (File System
  // Access). The browser never reveals its real path, so whether it is synced
  // is unknowable — claiming "this Mac" or "iCloud" would be a guess.
  if (root === BROWSER_VAULT_ROOT) return { kind: 'folder', phrase: 'to your folder', synced: false }
  if (/Mobile Documents|iCloud/i.test(root)) return { kind: 'icloud', phrase: 'to iCloud', synced: true }
  if (/GoogleDrive|Google Drive|My Drive/i.test(root)) return { kind: 'google-drive', phrase: 'to Google Drive', synced: true }
  if (/Dropbox/i.test(root)) return { kind: 'dropbox', phrase: 'to Dropbox', synced: true }
  if (/OneDrive/i.test(root)) return { kind: 'onedrive', phrase: 'to OneDrive', synced: true }
  // macOS File Provider mounts every other sync client here (Box, pCloud, …).
  if (/CloudStorage|Box Sync|pCloud|Sync\.com|Nextcloud|Syncthing/i.test(root)) {
    return { kind: 'cloud', phrase: 'to the cloud', synced: true }
  }
  return { kind: 'device', phrase: platform.isMac ? 'on this Mac' : 'on this device', synced: false }
}

/** The status line's states. `pending` is typed-but-not-yet-written: shown as
 *  "Saving…" like Docs does, because the debounce is an implementation detail
 *  and "unsaved" would read as an instruction to do something. */
export type SaveStatusKindBlock = 'idle' | 'pending' | 'saving' | 'saved' | 'failed'

export function saveStatusLabelBlock(status: SaveStatusKindBlock, location: SaveLocationBlock): string {
  switch (status) {
    case 'pending':
    case 'saving': return 'Saving…'
    case 'saved': return `Saved ${location.phrase}`
    case 'failed': return 'Not saved — retrying'
    default: return ''
  }
}
