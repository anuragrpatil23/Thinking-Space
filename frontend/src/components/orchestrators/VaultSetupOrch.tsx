import { useState } from 'react'
import { FolderOpen, Check, Server } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { selectAndSetVaultRoot } from '@/services/orchestrators/runtimeOrch'
import {
  isElectron,
  isCapacitorNative,
  isBrowserFSAvailable,
  pickAndInitBrowserVaultFS,
  setVaultFSInstance,
  setVaultRoot,
} from '@/services/lego_blocks/integrations/fsBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { probeBackendConnectionBlock } from '@/services/lego_blocks/units/backendConnectionBlock'
import {
  deriveUserProfileSymbolBlock,
  readCachedUserProfileBlock,
} from '@/services/lego_blocks/units/userProfileBlock'
import { ensureUserProfileOrch } from '@/services/orchestrators/userProfileOrch'
import { registerPlugin } from '@capacitor/core'

// Native folder picker plugin (defined in AppDelegate.swift)
interface FolderPickerPluginDef {
  pickFolder(): Promise<{ url: string; accessing: boolean }>
  restoreBookmark(): Promise<{ url: string; accessing: boolean }>
}

const FolderPicker = registerPlugin<FolderPickerPluginDef>('FolderPicker')

interface Props {
  onComplete: (vaultRoot: string) => void
}

export default function VaultSetup({ onComplete }: Props) {
  const cachedProfile = readCachedUserProfileBlock()
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileNameInput, setProfileNameInput] = useState(cachedProfile.name)
  const [profileSymbolInput, setProfileSymbolInput] = useState(cachedProfile.symbol)

  const isElectronApp = isElectron()
  const isCapacitor = isCapacitorNative()
  const isNativeApp = isElectronApp || isCapacitor
  const hasBrowserFS = !isNativeApp && isBrowserFSAvailable()
  const hasBackendOption = !isNativeApp
  const isBackendReconnect = getStoredVaultRoot() === 'web-backend'

  const profilePreviewSymbol = profileSymbolInput.trim() || deriveUserProfileSymbolBlock(profileNameInput)

  const validateProfile = (): boolean => {
    if (profileNameInput.trim()) return true
    setError('Please enter your name before selecting a Thinking Space folder.')
    return false
  }

  const seedVaultProfile = async () => {
    await ensureUserProfileOrch({
      name: profileNameInput.trim(),
      symbol: profileSymbolInput.trim(),
    })
  }

  // Electron: use native folder picker via IPC
  const handleElectronSelect = async () => {
    if (!validateProfile()) return
    setSelecting(true)
    setError(null)
    try {
      const selected = await selectAndSetVaultRoot()
      if (selected) {
        await seedVaultProfile()
        onComplete(selected)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select folder')
    } finally {
      setSelecting(false)
    }
  }

  // Capacitor (iOS): open native folder picker showing local + iCloud
  const handleCapacitorSelect = async () => {
    if (!validateProfile()) return
    setSelecting(true)
    setError(null)
    try {
      const result = await FolderPicker.pickFolder()
      // Store the absolute path — CapacitorVaultFS will use it directly
      // Prefix with cap-picker: so we know it's a picker-selected absolute path
      const vaultMarker = `cap-picker:${result.url}`
      setVaultRoot(vaultMarker)
      await seedVaultProfile()
      onComplete(vaultMarker)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('cancel')) {
        setError(msg)
      }
    } finally {
      setSelecting(false)
    }
  }

  // Browser: use File System Access API
  const handleBrowserFolderPick = async () => {
    if (!validateProfile()) return
    setSelecting(true)
    setError(null)
    try {
      const browserFS = await pickAndInitBrowserVaultFS()
      setVaultFSInstance(browserFS)
      setVaultRoot('browser-fs')
      await seedVaultProfile()
      onComplete('browser-fs')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        setError(err instanceof Error ? err.message : 'Failed to open folder')
      }
    } finally {
      setSelecting(false)
    }
  }

  // Web: connect/refresh FastAPI backend and verify vault access.
  const handleBackendConnect = async () => {
    if (!validateProfile()) return
    setSelecting(true)
    setError(null)
    try {
      const probe = await probeBackendConnectionBlock(true)
      if (!probe.connected) {
        throw new Error(probe.error || 'Backend is reachable but Thinking Space folder is unavailable')
      }
      setVaultRoot('web-backend')
      await seedVaultProfile()
      onComplete('web-backend')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to backend')
    } finally {
      setSelecting(false)
    }
  }

  const handleNativeSelect = isElectronApp ? handleElectronSelect : handleCapacitorSelect

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl items-start justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <FolderOpen className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Select Thinking Space</h1>
        <p className="mt-3 text-base text-muted-foreground">
          {isNativeApp
            ? 'Choose your existing notes folder, or create a new folder where you want to store your notes.'
            : 'Choose how to connect to your Thinking Space folder.'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Recommended: select a cloud-synced folder so your notes stay available across your devices.
        </p>

        <div className="mt-6 space-y-3 text-left">
          <div className="space-y-1.5">
            <label htmlFor="ltm-vault-setup-profile-name" className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Your Name
            </label>
            <input
              id="ltm-vault-setup-profile-name"
              type="text"
              value={profileNameInput}
              onChange={(event) => setProfileNameInput(event.target.value)}
              placeholder="Enter your name"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ltm-vault-setup-profile-symbol" className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Profile Symbol
            </label>
            <div className="flex items-center gap-2">
              <input
                id="ltm-vault-setup-profile-symbol"
                type="text"
                value={profileSymbolInput}
                onChange={(event) => setProfileSymbolInput(event.target.value)}
                placeholder={deriveUserProfileSymbolBlock(profileNameInput)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/25 text-sm font-semibold text-foreground">
                {profilePreviewSymbol}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              This will be used for comments and profile displays. Saved in your Thinking Space folder under `.thinking-space/profile.json`.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {isNativeApp && (
            <Button size="lg" onClick={handleNativeSelect} disabled={selecting}>
              {selecting ? 'Selecting...' : (
                <>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Select Thinking Space
                </>
              )}
            </Button>
          )}

          {hasBrowserFS && (
            <Button size="lg" onClick={handleBrowserFolderPick} disabled={selecting}>
              {selecting ? 'Opening...' : (
                <>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Select Thinking Space Folder
                </>
              )}
            </Button>
          )}

          {hasBackendOption && (
            <div className="space-y-2 text-left">
              <Button
                size="lg"
                variant={hasBrowserFS ? 'outline' : 'default'}
                onClick={() => { void handleBackendConnect() }}
                disabled={selecting}
                className="w-full"
              >
                <Server className="mr-2 h-4 w-4" />
                {selecting
                  ? (isBackendReconnect ? 'Refreshing Backend...' : 'Connecting Backend...')
                  : (isBackendReconnect ? 'Refresh Backend Connection' : 'Connect to Backend')}
              </Button>
              <p className="text-xs text-muted-foreground">
                Backend mode does not use a browser folder picker. The Thinking Space folder path is configured on the backend via
                `LTM_VAULT_ROOT` or `THINK_SPACE_VAULT_ROOT`.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}

        <div className="mt-8 rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-left sm:px-4">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Learn more
            </summary>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Think of your notes folder as a database, with Thinking Space as the helpful layer on top that makes
                creation, management, and usage easier with AI of your choice. It aims to remove boring, tedious,
                and repetitive parts of knowledge-base creation so your notes become your long-term memory.
                All your thoughts compound.
              </p>
              <p>
                Thinking Space does not impose any way of thinking or organization. It stays yours. It provides
                helpful tools out of the box.
              </p>
              <p>
                Thinking Space was designed to be extendable with AI and is open source. You are encouraged to
                download the source, use AI to add features, and tinker with it to make it your own.
              </p>

              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>Works alongside Obsidian — no conflicts</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>All data stays on your machine — nothing is uploaded</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>You can change the Thinking Space folder later in settings</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>Changing folders does not delete notes from your previous folder</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>When you switch folders, Thinking Space hot-switches without reload and refreshes local cache for the selected folder</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>Clear Cache removes local app cache and local API/OAuth credentials, but does not delete your notes</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                <span>Electron F9 secure credentials are kept unless you clear them from F9 settings</span>
              </div>
              {hasBrowserFS && (
                <div className="flex items-start gap-2">
                  <Check className="mt-1 h-3 w-3 shrink-0 text-green-500" />
                  <span>Select Thinking Space Folder works without any server — your browser reads files directly</span>
                </div>
              )}

              <p className="pt-1 text-foreground/80">Humans are beautiful.</p>
            </div>
          </details>
        </div>
      </div>
      </div>
    </div>
  )
}
