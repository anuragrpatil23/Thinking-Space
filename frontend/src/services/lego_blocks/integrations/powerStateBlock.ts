// Power gate for background model work.
//
// A session digest is a multi-minute local-model run — the debug console
// routinely shows 400–600s per session. That is a fine thing to spend while
// plugged in and a hostile thing to spend on battery, and it is flatly against
// the user's stated intent when macOS Low Power Mode is on. So automatic
// generation requires wall power; an explicit click still runs regardless.
//
// The gate is deliberately permissive when it cannot read the machine (web,
// iOS, a failed probe): a surface with no power API keeps today's behaviour
// rather than silently losing its digests.

export interface PowerStateSnapshot {
  onBattery: boolean
  lowPowerMode: boolean
  /** False when the platform has no power API or the probe failed. */
  known: boolean
}

export type HeavyWorkBlockReason = 'on-battery' | 'low-power-mode'

// Short TTL, no timer. Power state is only ever read on the path that is about
// to spend minutes of GPU, so the read cost is noise; the cache exists purely
// so a loop over 200 chains does not issue 200 IPC round-trips.
const TTL_MS = 15_000
let cached: { snapshot: PowerStateSnapshot; atMs: number } | null = null
let inflight: Promise<PowerStateSnapshot> | null = null

const UNKNOWN: PowerStateSnapshot = { onBattery: false, lowPowerMode: false, known: false }

/** Drop the cache so the next read hits the OS. For the settings UI and tests. */
export function invalidatePowerStateBlock(): void {
  cached = null
  inflight = null
}

export async function getPowerStateBlock(): Promise<PowerStateSnapshot> {
  const now = Date.now()
  if (cached && now - cached.atMs < TTL_MS) return cached.snapshot
  if (inflight) return inflight

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.powerStateGet) {
    cached = { snapshot: UNKNOWN, atMs: now }
    return UNKNOWN
  }

  inflight = api
    .powerStateGet()
    .then(state => {
      const snapshot: PowerStateSnapshot = {
        onBattery: !!state?.onBattery,
        lowPowerMode: !!state?.lowPowerMode,
        known: !!state?.known,
      }
      cached = { snapshot, atMs: Date.now() }
      return snapshot
    })
    .catch(() => {
      cached = { snapshot: UNKNOWN, atMs: Date.now() }
      return UNKNOWN
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/**
 * Whether an *automatic* heavy model run is allowed right now.
 *
 * Note that battery alone blocks, without waiting on `known`: `onBattery` comes
 * straight from Electron's powerMonitor and is trustworthy even when the Low
 * Power Mode probe fails. `known` only gates the low-power half.
 */
export async function heavyBackgroundWorkAllowedBlock(): Promise<
  { allowed: true } | { allowed: false; reason: HeavyWorkBlockReason }
> {
  const state = await getPowerStateBlock()
  if (state.known && state.lowPowerMode) return { allowed: false, reason: 'low-power-mode' }
  if (state.onBattery) return { allowed: false, reason: 'on-battery' }
  return { allowed: true }
}

export function heavyWorkBlockedLabelBlock(reason: HeavyWorkBlockReason): string {
  return reason === 'low-power-mode'
    ? 'Paused — Low Power Mode is on'
    : 'Paused — running on battery'
}
