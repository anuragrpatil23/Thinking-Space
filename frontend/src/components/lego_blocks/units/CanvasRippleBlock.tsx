import { memo, useEffect, useState } from 'react'

/**
 * A ring that expands and fades from a point on the canvas.
 *
 * Fired when something lands — a card spawned, a card dropped. It is the one
 * bit of canvas feedback that is purely for pleasure, so it is built to cost
 * nothing: a single element per ripple animating `transform` and `opacity`
 * only, unmounted the moment it finishes. No ripple in flight means no element
 * in the DOM and nothing for the compositor to consider.
 *
 * Deliberately not a hover effect. Hover feedback is continuous and becomes
 * wallpaper; a ripple marks a discrete event, which is why it stays satisfying
 * on the hundredth card instead of turning into noise.
 */

export interface CanvasRipple {
  id: number
  /** Screen coordinates, matching the canvas overlay space. */
  x: number
  y: number
}

interface Props {
  ripples: CanvasRipple[]
  onDone: (id: number) => void
  color?: string
  /** Final diameter. */
  size?: number
  durationMs?: number
}

function Ripple({
  ripple,
  onDone,
  color,
  size,
  durationMs,
}: {
  ripple: CanvasRipple
  onDone: (id: number) => void
  color: string
  size: number
  durationMs: number
}) {
  // Mount at scale 0, flip to 1 on the next frame so the transition actually
  // runs — setting both in the same frame would jump straight to the end.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    const timer = window.setTimeout(() => onDone(ripple.id), durationMs)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [ripple.id, onDone, durationMs])

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: ripple.x - size / 2,
        top: ripple.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `1.5px solid ${color}`,
        pointerEvents: 'none',
        opacity: open ? 0 : 0.9,
        transform: open ? 'scale(1)' : 'scale(0.15)',
        // Fast out, slow settle — the ring should feel thrown, not inflated.
        transition: `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${durationMs}ms ease-out`,
        willChange: 'transform, opacity',
      }}
    />
  )
}

function CanvasRippleBlock({
  ripples,
  onDone,
  color = 'rgba(255,255,255,0.5)',
  size = 220,
  durationMs = 620,
}: Props) {
  if (ripples.length === 0) return null
  return (
    <>
      {ripples.map(r => (
        <Ripple
          key={r.id}
          ripple={r}
          onDone={onDone}
          color={color}
          size={size}
          durationMs={durationMs}
        />
      ))}
    </>
  )
}

export default memo(CanvasRippleBlock)
