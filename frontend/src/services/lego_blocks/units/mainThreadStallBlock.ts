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
  getActivities,
  startActivity,
  type BackgroundActivityHandle,
} from './backgroundActivityBlock'

/** What labelled work is running, so a stall names its suspect instead of
 *  saying only "busy". Unlabelled work shows as nothing — label it. */
function inFlightLabelsBlock(): string {
  return getActivities()
    .filter(activity => activity.kind !== 'stall')
    .map(activity => (activity.detail ? `${activity.label} (${activity.detail})` : activity.label))
    .join(', ')
}

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
  let stallStartedAt = 0
  let longestGapMs = 0
  let suspects = ''
  let disposed = false

  // One line per stall in the debug console: how long the thread was held,
  // the single worst freeze, and what was in flight. Info, not warn — a warn
  // raises a toast, and the banner already showed.
  const endStall = (reason: string) => {
    if (!stallHandle) return
    stallHandle.end()
    stallHandle = null
    console.info(`[stall] main thread busy ~${Math.round(lastStallSeenAt - stallStartedAt + longestGapMs)}ms, worst freeze ${Math.round(longestGapMs)}ms, during: ${suspects || 'nothing labelled'}${reason ? ` (${reason})` : ''}`)
  }

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
        stallStartedAt = now - gap
        longestGapMs = 0
        suspects = inFlightLabelsBlock()
        // Ambient: spins the refresh pill like a sync rather than raising
        // the banner — a stall is worth seeing, not worth interrupting.
        stallHandle = startActivity({
          kind: 'stall',
          channel: 'ambient',
          label,
          detail: suspects ? `Main thread is busy · ${suspects}` : 'Main thread is busy',
        })
      } else {
        const more = inFlightLabelsBlock()
        if (more && !suspects.includes(more)) suspects = suspects ? `${suspects}, ${more}` : more
      }
      longestGapMs = Math.max(longestGapMs, gap)
    } else if (stallHandle && now - lastStallSeenAt > recoverMs) {
      endStall('')
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
      endStall('cut short: app shown')
    } else {
      stopTicking()
      endStall('cut short: app hidden')
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (document.visibilityState === 'visible') startTicking()

  return () => {
    disposed = true
    stopTicking()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    endStall('')
  }
}
