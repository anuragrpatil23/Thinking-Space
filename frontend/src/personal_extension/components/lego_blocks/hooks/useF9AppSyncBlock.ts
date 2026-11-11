// F9 sync, app-wide: whenever the app comes to the front, on any tab, what is
// due is synced. Built not to be felt:
//   - the engine is loaded lazily (it is not part of startup);
//   - the check waits until the app has been in front for a few seconds and the
//     main thread is idle; going to the back again before then cancels it;
//   - the engine itself checks at most every ten minutes.
// "Refresh everything" (the rail icon's menu) is Sync now for yours.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { REFRESH_ALL_EVENT_BLOCK } from '@/services/lego_blocks/units/refreshAllEventBlock'
import type { F9SyncEngineBlock, F9SyncSnapshotBlock } from '@/personal_extension/services/orchestrators/f9SyncOrch'
import { registerPrivateF9SyncBlock } from '../units/privatePersonalBlock'

const SETTLE_MS = 4000

let engine: Promise<F9SyncEngineBlock> | null = null

/**
 * The sync engine with every dataset added: the one place it is put together.
 * Loaded once, on first use, never at startup.
 */
export function loadF9SyncEngineBlock(): Promise<F9SyncEngineBlock> {
  engine ??= Promise.all([
    import('@/personal_extension/services/orchestrators/f9SyncOrch'),
    import('@/personal_extension/services/orchestrators/f9SyncDatasetsOrch'),
  ]).then(async ([{ f9SyncOrch }, { registerF9SyncDatasetsOrch }]) => {
    registerF9SyncDatasetsOrch(f9SyncOrch)
    await registerPrivateF9SyncBlock(f9SyncOrch)
    return f9SyncOrch
  })
  return engine
}

const noSubscribe = () => () => undefined
const noSnapshot = (): F9SyncSnapshotBlock | null => null

/** The engine and its live state, for anything that shows or starts a sync; null until loaded. */
export function useF9SyncBlock(): { engine: F9SyncEngineBlock | null; snap: F9SyncSnapshotBlock | null } {
  const [loaded, setLoaded] = useState<F9SyncEngineBlock | null>(null)
  useEffect(() => {
    let live = true
    void loadF9SyncEngineBlock().then((e) => { if (live) setLoaded(e) })
    return () => { live = false }
  }, [])
  const snap = useSyncExternalStore(loaded?.subscribe ?? noSubscribe, loaded?.read ?? noSnapshot)
  return { engine: loaded, snap }
}

export function useF9AppSyncBlock(): void {
  useEffect(() => {
    // Desktop only: every dataset fetches through the Electron main process
    if (!window.electronAPI?.isElectron) return
    let settle: number | null = null
    let idle: number | null = null
    const cancel = () => {
      if (settle !== null) window.clearTimeout(settle)
      if (idle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle)
      settle = idle = null
    }
    const schedule = () => {
      cancel()
      if (document.visibilityState !== 'visible') return
      settle = window.setTimeout(() => {
        settle = null
        const go = () => { idle = null; void loadF9SyncEngineBlock().then(e => e.syncDue()) }
        if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(go, { timeout: 10_000 })
        else go()
      }, SETTLE_MS)
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? schedule() : cancel())
    const onRefreshAll = () => { void loadF9SyncEngineBlock().then(e => e.syncNow('yours')) }
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(REFRESH_ALL_EVENT_BLOCK, onRefreshAll)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(REFRESH_ALL_EVENT_BLOCK, onRefreshAll)
    }
  }, [])
}
