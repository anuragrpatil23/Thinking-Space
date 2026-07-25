import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Keeps the display awake while the user is reading — the GoodNotes model.
 *
 * Reading is the one activity where the OS's idle timer is actively wrong: you
 * sit still for minutes at a time, so the screen dims and locks exactly when
 * you're most engaged, and Low Power Mode shortens that window further. Every
 * other surface in the app involves typing or tapping, so the idle timer is
 * right there and we leave it alone.
 *
 * Counter-based leases so overlapping readers compose (two split-view notes,
 * or a note that re-mounts mid-transition): the display is only released when
 * the last reader lets go. Mirrors `nativeChromeImmersionBlock`.
 *
 * Platform routing:
 * - iOS/iPadOS: native `UIApplication.isIdleTimerDisabled` via `IdleTimerPlugin`.
 *   WKWebView does not expose the Screen Wake Lock API, so this is the only path.
 * - Everything else: `navigator.wakeLock` when present, otherwise a no-op.
 *   A desktop plugged into power doesn't need this, so a silent no-op is the
 *   right failure mode — never surface an error for a comfort feature.
 */

interface IdleTimerPluginBlock {
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>
}

const IdleTimer = registerPlugin<IdleTimerPluginBlock>('IdleTimer')

let leaseCount = 0
let webWakeLock: WakeLockSentinel | null = null
let visibilityHandlerAttached = false

function isIosSurfaceBlock(): boolean {
  return Capacitor.getPlatform() === 'ios'
}

async function applyWakeStateBlock(active: boolean): Promise<void> {
  if (isIosSurfaceBlock()) {
    try {
      await IdleTimer.setEnabled({ enabled: active })
    } catch {
      // Older build without the native plugin — reading still works, the
      // screen just dims as usual. Not worth surfacing.
    }
    return
  }

  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
  if (!wakeLock) return

  if (active) {
    if (webWakeLock && !webWakeLock.released) return
    try {
      webWakeLock = await wakeLock.request('screen')
    } catch {
      // Denied (background tab, unsupported, battery saver). Fine — no-op.
      webWakeLock = null
    }
    return
  }

  const sentinel = webWakeLock
  webWakeLock = null
  if (sentinel && !sentinel.released) {
    try {
      await sentinel.release()
    } catch {
      /* already gone */
    }
  }
}

/**
 * The browser drops a wake lock whenever the document is hidden, and does NOT
 * restore it on return — so without this, switching apps once silently kills
 * the lock for the rest of the reading session. iOS clears
 * `isIdleTimerDisabled` on backgrounding too, but the native plugin re-applies
 * it itself, so this only has work to do on the web path.
 */
function ensureVisibilityReacquireBlock(): void {
  if (visibilityHandlerAttached || typeof document === 'undefined') return
  visibilityHandlerAttached = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (leaseCount <= 0) return
    void applyWakeStateBlock(true)
  })
}

/** Acquire a keep-awake lease; returns an idempotent release function. */
export function acquireScreenWakeLockBlock(): () => void {
  ensureVisibilityReacquireBlock()
  leaseCount += 1
  if (leaseCount === 1) void applyWakeStateBlock(true)

  let released = false
  return () => {
    if (released) return
    released = true
    leaseCount = Math.max(0, leaseCount - 1)
    if (leaseCount === 0) void applyWakeStateBlock(false)
  }
}

export function isScreenWakeLockHeldBlock(): boolean {
  return leaseCount > 0
}
