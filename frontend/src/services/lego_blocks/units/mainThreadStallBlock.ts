/**
 * Main-thread stall detector. Schedules a fast-cadence heartbeat; when the
 * actual gap between ticks exceeds `stallMs`, we infer the main thread is
 * pinned and emit a synthetic "Working…" activity. When ticks recover to
 * normal cadence for `recoverMs`, we end it.
 *
 * This is the safety net for background paths that aren't explicitly
 * instrumented via backgroundActivityBlock.
 */

import {
  startActivity,
  type BackgroundActivityHandle,
} from './backgroundActivityBlock'

export interface StallDetectorOptions {
  /** Frame-gap (ms) above which we consider the main thread stalled. */
  stallMs?: number
  /** How long ticks must remain normal before we end the stall activity. */
  recoverMs?: number
  /** Tick cadence (ms). Lower = faster detection, slightly more wakeups. */
  tickIntervalMs?: number
  /** Label shown when stall is detected with no labeled activity in flight. */
  label?: string
}

export function startStallDetector(options: StallDetectorOptions = {}): () => void {
  const stallMs = options.stallMs ?? 350
  const recoverMs = options.recoverMs ?? 400
  const tickIntervalMs = options.tickIntervalMs ?? 100
  const label = options.label ?? 'Working…'

  let lastTick = performance.now()
  let stallHandle: BackgroundActivityHandle | null = null
  let lastStallSeenAt = 0
  let disposed = false

  const tick = () => {
    if (disposed) return
    const now = performance.now()
    const gap = now - lastTick
    lastTick = now

    // Subtract the scheduled cadence to get the actual overrun.
    const overrun = gap - tickIntervalMs

    if (overrun > stallMs) {
      lastStallSeenAt = now
      if (!stallHandle) {
        stallHandle = startActivity({
          kind: 'stall',
          label,
          detail: 'Main thread is busy',
        })
      }
    } else if (stallHandle && now - lastStallSeenAt > recoverMs) {
      stallHandle.end()
      stallHandle = null
    }
  }

  // STOPPED WHILE HIDDEN, not just reset. This is a 10 Hz heartbeat that exists
  // only to notice main-thread jank, and a periodic timer is the one thing that
  // reliably keeps a CPU out of its deep idle states — running it against a
  // webview nobody is looking at is pure battery burn. There is also nothing to
  // detect: a hidden document isn't rendering, and the throttled timer would
  // report phantom stalls anyway (which is what the old reset was papering
  // over). Matters most on iPad, where this is the app's only unconditional
  // wakeup source and idle draw is the whole ballgame.
  let intervalId: number | null = null

  const startTicking = () => {
    if (intervalId !== null || disposed) return
    lastTick = performance.now()
    intervalId = window.setInterval(tick, tickIntervalMs)
  }

  const stopTicking = () => {
    if (intervalId === null) return
    window.clearInterval(intervalId)
    intervalId = null
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      startTicking()
      if (stallHandle) {
        stallHandle.end()
        stallHandle = null
      }
    } else {
      stopTicking()
      if (stallHandle) {
        stallHandle.end()
        stallHandle = null
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (document.visibilityState === 'visible') startTicking()

  return () => {
    disposed = true
    stopTicking()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (stallHandle) {
      stallHandle.end()
      stallHandle = null
    }
  }
}
