import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAmbientSyncActivityBlock } from '../hooks/useAmbientSyncActivityBlock'

/**
 * Icon-only refresh pill that doubles as the vault-sync indicator — one
 * control that "naturally means refresh AND sync". Click still triggers the
 * cheap UI refresh; any vault sync past the visibility threshold animates
 * the same pill: the icon rotates inside a small accent progress circle
 * (determinate arc when file totals are known, sweeping arc otherwise), and
 * determinate syncs expand the capsule with a live processed/total file
 * count. When the sync ends the circle closes and fades — even instant
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
// The progress circle hugs the icon, not the capsule — so it survives the
// capsule widening for the file count.
const RING_R = 9
const RING_C = 2 * Math.PI * RING_R

export default function SyncRefreshButtonBlock({
  onClick,
  disabled,
  busy = false,
  className = '',
  title,
  ariaLabel,
}: Props) {
  const { running: syncRunning, progress, completedCount, totalCount } = useAmbientSyncActivityBlock()
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
  const showCount = syncRunning && completedCount !== null && totalCount !== null
  // Closing pulse renders the full circle; determinate syncs draw their arc.
  const arcFraction = closing ? 1 : indeterminate ? 0.3 : (progress ?? 0)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative ${showCount ? 'gap-1.5 px-2' : 'w-8'} ${className}`}
      aria-label={ariaLabel}
      aria-busy={active}
      title={title}
    >
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <RefreshCw
          className={`h-3 w-3 ${active ? 'animate-[ltm-syncbtn-spin_0.9s_linear_infinite]' : ''}`}
        />
        {showRing && (
          <svg
            viewBox="0 0 20 20"
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
              cx="10"
              cy="10"
              r={RING_R}
              fill="none"
              stroke="var(--ltm-profile-accent, #10b981)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - arcFraction)}
              style={{ transition: 'stroke-dashoffset 250ms ease-out' }}
            />
          </svg>
        )}
      </span>
      {showCount && (
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {completedCount.toLocaleString()}/{totalCount.toLocaleString()}
        </span>
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
