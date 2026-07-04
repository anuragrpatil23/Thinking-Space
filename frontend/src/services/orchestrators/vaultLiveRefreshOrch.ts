/**
 * Vault live refresh — keeps the IndexedDB cache in sync with external file
 * changes without requiring a manual refresh.
 *
 * Two signals feed a single debounced `smartSync` driver:
 *  1. Window focus / document visibility — universal, fires when the user
 *     returns to Thinking Space after editing files elsewhere.
 *  2. Electron filesystem watcher (chokidar in the main process) — emits
 *     IPC events while the app is open, for true live updates.
 *
 * Non-Electron platforms rely solely on #1.
 */

import { smartSync } from './vaultSyncOrch'
import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { wasRecentSelfWriteBlock } from '@/services/lego_blocks/units/selfWriteTrackerBlock'
import { setManagedVaultGitignorePrefixes } from '@/services/lego_blocks/units/vaultGitignoreBlock'
import { getSyncExcludedPathPrefixes } from '@/services/lego_blocks/units/vaultSyncExclusionsBlock'

type Trigger = 'focus' | 'visibility' | 'fs'

interface RefreshOptions {
  /** Minimum gap (ms) between focus-driven syncs. */
  focusThrottleMs?: number
  /** Debounce (ms) for collapsing fs-event bursts. */
  fsDebounceMs?: number
  /** Optional callback fired after each successful refresh. */
  onSynced?: (trigger: Trigger) => void
}

export function startVaultLiveRefresh(
  getVaultRoot: () => string | null,
  options: RefreshOptions = {},
): () => void {
  const focusThrottleMs = options.focusThrottleMs ?? 5000
  const fsDebounceMs = options.fsDebounceMs ?? 800
  let lastFocusRunAt = 0
  let fsTimer: number | null = null
  let inFlight = false
  let disposed = false

  const run = async (trigger: Trigger) => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      await smartSync()
      options.onSynced?.(trigger)
    } catch (err) {
      console.warn('[vaultLiveRefresh] sync failed', err)
    } finally {
      inFlight = false
    }
  }

  const onFocusOrVisible = (trigger: Trigger) => {
    if (disposed) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastFocusRunAt < focusThrottleMs) return
    lastFocusRunAt = now
    void run(trigger)
  }

  const onWindowFocus = () => onFocusOrVisible('focus')
  const onVisibilityChange = () => onFocusOrVisible('visibility')

  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)

  let unsubscribeFsWatch: (() => void) | null = null
  if (isElectron() && window.electronAPI?.vaultWatchStart && window.electronAPI?.onVaultWatchEvent) {
    const root = getVaultRoot()
    if (root) {
      window.electronAPI.vaultWatchStart(root).catch((err) =>
        console.warn('[vaultLiveRefresh] failed to start fs watch', err),
      )
      // Ensure the vault .gitignore has the app-managed baseline (`ai-raw/`,
      // `ai-activity/`, …) plus any dynamic prefixes contributed by extensions
      // like Webull. Fire-and-forget: this is best-effort — a missing entry
      // in .gitignore doesn't stop the app, and any writer error is already
      // swallowed inside setManagedVaultGitignorePrefixes.
      void setManagedVaultGitignorePrefixes(getSyncExcludedPathPrefixes()).catch(() => undefined)
      unsubscribeFsWatch = window.electronAPI.onVaultWatchEvent((event) => {
        // Suppress events caused by this app's own writes — every internal
        // save (markdown editor, capability runner, auto-heal rewrites, etc.)
        // already routes the new content through the in-process cache. The
        // chokidar echo would otherwise re-walk the vault for nothing.
        if (event?.path && wasRecentSelfWriteBlock(event.path)) return
        if (fsTimer !== null) window.clearTimeout(fsTimer)
        fsTimer = window.setTimeout(() => {
          fsTimer = null
          void run('fs')
        }, fsDebounceMs)
      })
    }
  }

  return () => {
    disposed = true
    window.removeEventListener('focus', onWindowFocus)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (fsTimer !== null) {
      window.clearTimeout(fsTimer)
      fsTimer = null
    }
    if (unsubscribeFsWatch) unsubscribeFsWatch()
    if (isElectron() && window.electronAPI?.vaultWatchStop) {
      const root = getVaultRoot()
      if (root) window.electronAPI.vaultWatchStop(root).catch(() => { /* noop */ })
    }
  }
}
