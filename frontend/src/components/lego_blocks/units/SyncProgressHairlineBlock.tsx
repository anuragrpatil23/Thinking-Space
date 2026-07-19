import { useEffect, useRef, useState } from 'react'
import {
  subscribeActivities,
  type BackgroundActivity,
} from '../../../services/lego_blocks/units/backgroundActivityBlock'

/**
 * Top-edge progress hairline for ambient-channel background activities
 * (vault syncs). One quiet surface for every sync — automatic or manual,
 * fast or slow — instead of the right-corner banner.
 *
 * Placement: fixed at var(--ltm-safe-top) so it sits at the window top edge
 * on desktop and just below the status-bar veil on iPhone/iPad (the native
 * veil itself stays static per the locked iOS chrome decision).
 *
 * Motion is CSS-only (transform/opacity) so the shimmer keeps gliding on the
 * compositor thread even while the main thread is busy with the sync itself —
 * the whole point is explaining that hiccup. Fast syncs still get one full
 * fill-and-fade cycle (min ~600ms) so they read as a pulse, not a flicker.
 */

type Phase = 'idle' | 'active' | 'closing'

const CLOSE_MS = 600

function ambientProgress(activities: BackgroundActivity[]): number | null {
  let total = 0
  let completed = 0
  for (const a of activities) {
    if (typeof a.total !== 'number' || a.total <= 0) return null
    total += a.total
    completed += a.completed ?? 0
  }
  if (total === 0) return null
  return Math.min(1, Math.max(0, completed / total))
}

export default function SyncProgressHairlineBlock() {
  const [ambient, setAmbient] = useState<BackgroundActivity[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => subscribeActivities(all => {
    setAmbient(all.filter(a => a.channel === 'ambient'))
  }), [])

  const running = ambient.length > 0

  useEffect(() => {
    if (running) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setPhase('active')
      return
    }
    setPhase(prev => {
      if (prev !== 'active') return prev
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        setPhase('idle')
      }, CLOSE_MS)
      return 'closing'
    })
  }, [running])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  if (phase === 'idle') return null

  const progress = phase === 'closing' ? 1 : ambientProgress(ambient)
  const indeterminate = progress === null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[96] h-[2px] overflow-hidden"
      style={{
        top: 'var(--ltm-safe-top, 0px)',
        opacity: phase === 'closing' ? 0 : 1,
        transition: `opacity ${CLOSE_MS - 150}ms ease-in 150ms`,
      }}
      role="progressbar"
      aria-label="Syncing vault"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round((progress ?? 0) * 100)}
    >
      {indeterminate ? (
        <div
          className="h-full w-1/3 rounded-full animate-[ltm-hairline-sweep_1.1s_ease-in-out_infinite]"
          style={{ background: 'var(--ltm-profile-accent, #10b981)' }}
        />
      ) : (
        <div
          className="h-full w-full origin-left"
          style={{
            background: 'var(--ltm-profile-accent, #10b981)',
            transform: `scaleX(${progress})`,
            transition: 'transform 250ms ease-out',
          }}
        />
      )}
      <style>{`
        @keyframes ltm-hairline-sweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  )
}
