import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAmbientSyncActivityBlock } from '../hooks/useAmbientSyncActivityBlock'

/**
 * Icon-only refresh pill that doubles as the vault-sync indicator — one
 * control that "naturally means refresh AND sync". Click still triggers the
 * cheap UI refresh; any vault sync past the visibility threshold animates
 * the same pill: the icon rotates and an accent progress stroke traces the
 * BUTTON BORDER (a circle at rest, a capsule when the pill widens with the
 * live processed/total file count — pathLength normalizes progress across
 * both shapes). Indeterminate syncs march a dash segment around the border.
 * When the sync ends the stroke completes and fades, so even instant syncs
 * read as one elegant pulse instead of a flicker.
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
const STROKE_W = 1.25

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
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

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

  // The border stroke needs real pixel dimensions (the pill widens for the
  // count) — measured only while the ring is visible.
  useLayoutEffect(() => {
    if (!showRing) return
    const el = buttonRef.current
    if (!el) return
    const measure = () => setDims({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showRing])

  const indeterminate = active && progress === null
  const showCount = syncRunning && completedCount !== null && totalCount !== null
  // Closing pulse renders the full border; determinate syncs draw their arc.
  const arcFraction = closing ? 1 : indeterminate ? 0.3 : (progress ?? 0)

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative ${showCount ? 'gap-1.5 px-2.5' : 'w-8'} ${className}`}
      aria-label={ariaLabel}
      aria-busy={active}
      title={title}
    >
      <RefreshCw
        className={`h-3.5 w-3.5 shrink-0 transition-colors duration-300 ${
          active ? 'animate-[ltm-syncbtn-spin_1.1s_linear_infinite]' : ''
        }`}
        style={active ? { color: 'var(--ltm-profile-accent, #10b981)' } : undefined}
      />
      {showCount && (
        <span className="animate-[ltm-syncbtn-count-in_0.25s_ease-out] text-[10px] font-medium tabular-nums text-muted-foreground">
          {completedCount.toLocaleString()}/{totalCount.toLocaleString()}
        </span>
      )}
      {showRing && dims && (
        <svg
          width={dims.w}
          height={dims.h}
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: closing ? 0 : 1,
            transition: closing ? `opacity ${CLOSE_MS - 150}ms ease-in 150ms` : undefined,
          }}
        >
          <rect
            x={STROKE_W / 2}
            y={STROKE_W / 2}
            width={dims.w - STROKE_W}
            height={dims.h - STROKE_W}
            rx={(dims.h - STROKE_W) / 2}
            fill="none"
            stroke="var(--ltm-profile-accent, #10b981)"
            strokeOpacity={0.9}
            strokeWidth={STROKE_W}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={indeterminate ? '26 74' : '100'}
            strokeDashoffset={indeterminate ? undefined : 100 * (1 - arcFraction)}
            className={indeterminate ? 'animate-[ltm-syncbtn-march_1.2s_linear_infinite]' : ''}
            style={indeterminate ? undefined : { transition: 'stroke-dashoffset 250ms ease-out' }}
          />
        </svg>
      )}
      <style>{`
        @keyframes ltm-syncbtn-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ltm-syncbtn-march {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -100; }
        }
        @keyframes ltm-syncbtn-count-in {
          from { opacity: 0; transform: translateX(-2px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </button>
  )
}
