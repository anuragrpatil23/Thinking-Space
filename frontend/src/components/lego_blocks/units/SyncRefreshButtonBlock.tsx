import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAmbientSyncActivityBlock } from '../hooks/useAmbientSyncActivityBlock'

/**
 * Icon-only refresh pill that doubles as the vault-sync indicator — one
 * control that "naturally means refresh AND sync". Click still triggers the
 * cheap UI refresh; any vault sync (startup scan, watcher, manual rebuild)
 * animates the same pill: the icon rotates and a thin accent ring traces the
 * capsule border (determinate arc when file totals are known, sweeping arc
 * otherwise). When the sync ends the ring closes and fades, so even instant
 * syncs read as one elegant pulse instead of a flicker.
 */

interface Props {
  onClick: () => void
  disabled?: boolean
  /** External busy state (the UI-refresh dispatch), OR'd with sync activity. */
  busy?: boolean
  className?: string
  title?: string
  ariaLabel?: string
}

const CLOSE_MS = 650
const RING_R = 15
const RING_C = 2 * Math.PI * RING_R

export default function SyncRefreshButtonBlock({
  onClick,
  disabled,
  busy = false,
  className = '',
  title,
  ariaLabel,
}: Props) {
  const { running: syncRunning, progress } = useAmbientSyncActivityBlock()
  const active = syncRunning || busy
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const wasActiveRef = useRef(false)

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setClosing(false)
      return
    }
    if (!wasActiveRef.current) return
    wasActiveRef.current = false
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setClosing(false)
    }, CLOSE_MS)
  }, [active])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const showRing = active || closing
  const indeterminate = active && progress === null
  // Closing pulse renders the full circle; determinate syncs draw their arc.
  const arcFraction = closing ? 1 : indeterminate ? 0.3 : (progress ?? 0)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative ${className}`}
      aria-label={ariaLabel}
      aria-busy={active}
      title={title}
    >
      <RefreshCw
        className={`h-3.5 w-3.5 ${active ? 'animate-[ltm-syncbtn-spin_0.9s_linear_infinite]' : ''}`}
      />
      {showRing && (
        <svg
          viewBox="0 0 32 32"
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full -rotate-90 ${
            indeterminate ? 'animate-[ltm-syncbtn-orbit_1.1s_linear_infinite]' : ''
          }`}
          style={{
            opacity: closing ? 0 : 1,
            transition: closing ? `opacity ${CLOSE_MS - 150}ms ease-in 150ms` : undefined,
          }}
        >
          <circle
            cx="16"
            cy="16"
            r={RING_R}
            fill="none"
            stroke="var(--ltm-profile-accent, #10b981)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - arcFraction)}
            style={{ transition: 'stroke-dashoffset 250ms ease-out' }}
          />
        </svg>
      )}
      <style>{`
        @keyframes ltm-syncbtn-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ltm-syncbtn-orbit {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
      `}</style>
    </button>
  )
}
