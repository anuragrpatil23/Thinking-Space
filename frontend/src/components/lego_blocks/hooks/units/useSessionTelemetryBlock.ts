// Live latest-session telemetry for the explorer — polls the telemetry
// orchestrator so dots and the count strip track the agent as it works.
// The orchestrator preserves object identity when nothing changed, so the
// poll doesn't cause re-renders on quiet minutes.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadSessionTelemetry,
  type SessionTelemetry,
} from '@/services/orchestrators/sessionTelemetryOrch'
import { useVisibleIntervalBlock } from '../shared/useVisibleIntervalBlock'

const POLL_MS = 60_000

export function useSessionTelemetryBlock(enabled = true): SessionTelemetry | null {
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null)

  const disposedRef = useRef(false)
  useEffect(() => {
    disposedRef.current = false
    return () => { disposedRef.current = true }
  }, [])

  const tick = useCallback(() => {
    void loadSessionTelemetry()
      .then(value => {
        if (!disposedRef.current) setTelemetry(value)
      })
      .catch(() => {
        if (!disposedRef.current) setTelemetry(null)
      })
  }, [])

  useEffect(() => {
    if (!enabled) {
      setTelemetry(null)
      return
    }
    tick()
    // `focus` is kept alongside the hook's own visibility handling: in Electron
    // a blurred-but-visible window never fires `visibilitychange`, so this is
    // the event that catches "user came back to the window".
    window.addEventListener('focus', tick)
    return () => window.removeEventListener('focus', tick)
  }, [enabled, tick])

  useVisibleIntervalBlock(tick, enabled ? POLL_MS : null)

  return telemetry
}
