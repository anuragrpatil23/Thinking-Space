// Live latest-session telemetry for the explorer — polls the telemetry
// orchestrator so dots and the count strip track the agent as it works.
// The orchestrator preserves object identity when nothing changed, so the
// poll doesn't cause re-renders on quiet minutes.

import { useEffect, useState } from 'react'
import {
  loadSessionTelemetry,
  type SessionTelemetry,
} from '@/services/orchestrators/sessionTelemetryOrch'

const POLL_MS = 60_000

export function useSessionTelemetryBlock(enabled = true): SessionTelemetry | null {
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTelemetry(null)
      return
    }
    let disposed = false
    const tick = () => {
      void loadSessionTelemetry()
        .then(value => {
          if (!disposed) setTelemetry(value)
        })
        .catch(() => {
          if (!disposed) setTelemetry(null)
        })
    }
    tick()
    const interval = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', tick)
    }
  }, [enabled])

  return telemetry
}
