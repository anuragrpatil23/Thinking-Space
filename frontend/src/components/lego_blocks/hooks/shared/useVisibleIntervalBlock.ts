import { useEffect, useRef } from 'react'

/**
 * `setInterval` that only runs while the document is visible.
 *
 * A repeating timer is the single most reliable way to keep a CPU out of its
 * deep idle states, so the energy contract requires every interval to be gated
 * on something (docs/contracts/ENERGY.md). Most callers in this codebase were
 * already gated on *mount* — a poller inside a page that is only rendered on
 * that page — which is necessary but not sufficient: an app left open in a
 * background window, or an iPad with the screen off, keeps every one of them
 * ticking against a surface nobody is looking at.
 *
 * On resume the callback fires immediately (unless `runOnResume` is false), so
 * whatever it computes is never stale on the frame the user comes back to.
 * That matters for the clock-tickers: they exist to refresh elapsed-time text,
 * and the first thing a returning user sees must not be a frozen timestamp
 * from when they left.
 *
 * @param callback  invoked on each tick; re-reads a ref, so changing the
 *                  function identity does NOT restart the timer
 * @param intervalMs  tick period, or `null` to disable entirely
 */
export function useVisibleIntervalBlock(
  callback: () => void,
  intervalMs: number | null,
  options?: { runOnResume?: boolean },
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const runOnResume = options?.runOnResume ?? true

  useEffect(() => {
    if (intervalMs === null) return

    let id: number | null = null

    const stop = () => {
      if (id === null) return
      window.clearInterval(id)
      id = null
    }

    const start = () => {
      if (id !== null) return
      id = window.setInterval(() => callbackRef.current(), intervalMs)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (runOnResume) callbackRef.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, runOnResume])
}
