import { memo, useEffect, useRef, useState } from 'react'

/**
 * The dot grid, revealed around the pointer.
 *
 * Replaces `CanvasBloomBlock`, which was structurally wrong rather than badly
 * tuned: it sized a single element to the whole board — 4500x4500, 20MP, 81MP
 * at 2x retina — gave it a tiled dot background AND a gradient mask, then moved
 * it with `left`/`top`. Every pan frame invalidated layout and re-masked an
 * area that is transparent by construction everywhere except a ~340px circle.
 * Three attempts to optimize that shape failed, twice regressing frame rate
 * when fully zoomed out (see docs/contracts/ENERGY.md).
 *
 * This inverts it. The only thing that ever needs to exist is the revealed
 * circle, so the painted element is a fixed POOL x POOL square that follows the
 * pointer with `transform` alone:
 *
 *   - The clip container keeps the board's geometry but paints NOTHING. An
 *     empty `overflow: hidden` box costs layout on pan (which already happens)
 *     and zero raster.
 *   - The pool never resizes and its mask never changes during movement, so it
 *     rasterizes once and then only its transform updates. No layout, no paint.
 *   - It is smaller than the old element at EVERY zoom. That matters: at
 *     minScale 0.25 the board is only ~1125px across, which is why the earlier
 *     "always viewport-sized" fix was *bigger* than what it replaced and
 *     dropped frames zoomed out.
 *
 * Grid alignment: the pool's translate is snapped to whole multiples of
 * `dotSpacing`, so the dot pattern stays locked to the board origin and never
 * swims as the pointer moves. The reveal centre is therefore off by at most
 * half a spacing (~12px), which is invisible under a soft radial falloff — and
 * it buys us never touching `background-position`, a paint property.
 */

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  rect: ScreenRect
  /** Widened while hovering a card. */
  intensified?: boolean
  baseRadius?: number
  intensifiedRadius?: number
  /** Widened further while the pointer is down — the canvas leaning in. */
  pressRadius?: number
  dotSize?: number
  dotSpacing?: number
  dotColor?: string
  /** Board corner radius, so the reveal never bleeds past the rounded edge. */
  borderRadius?: number
}

/** Revealed dots are drawn slightly fatter than a hairline so they read. */
const POOL_DOT_SCALE = 1.6

/**
 * Fixed painted size. Must be at least 2x the largest radius; anything beyond
 * that is wasted raster. Constant across zoom so the cost never scales.
 */
const POOL = 880

function CanvasGridBlock({
  rect,
  intensified = false,
  baseRadius = 220,
  intensifiedRadius = 340,
  pressRadius = 420,
  dotSize = 1,
  dotSpacing = 24,
  dotColor = 'rgba(255,255,255,0.28)',
  borderRadius = 0,
}: Props) {
  const poolRef = useRef<HTMLDivElement | null>(null)
  const rectRef = useRef(rect)
  rectRef.current = rect

  // Last known pointer position in client coords. Kept in a ref so pointer
  // movement never re-renders React — the whole point of this rewrite.
  const pointerRef = useRef({ x: -99999, y: -99999 })
  const rafRef = useRef<number | null>(null)

  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    const apply = () => {
      rafRef.current = null
      const el = poolRef.current
      if (!el) return
      const r = rectRef.current
      const { x, y } = pointerRef.current

      const inside =
        x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height

      // Snap to the dot lattice so the pattern stays anchored to the board.
      const rawX = x - r.left - POOL / 2
      const rawY = y - r.top - POOL / 2
      const snappedX = Math.round(rawX / dotSpacing) * dotSpacing
      const snappedY = Math.round(rawY / dotSpacing) * dotSpacing

      el.style.transform = `translate3d(${snappedX}px, ${snappedY}px, 0)`
      el.style.opacity = inside ? '1' : '0'
    }

    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(apply)
    }

    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
      schedule()
    }
    const onLeave = () => {
      pointerRef.current = { x: -99999, y: -99999 }
      schedule()
    }
    const onDown = () => setPressed(true)
    const onUp = () => setPressed(false)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    document.addEventListener('pointerleave', onLeave)

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.removeEventListener('pointerleave', onLeave)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [dotSpacing])

  // Panning moves the board under a stationary pointer, so the pool has to be
  // repositioned on rect changes too — not just on pointer movement.
  useEffect(() => {
    const el = poolRef.current
    if (el) {
      const r = rect
      const { x, y } = pointerRef.current
      const inside =
        x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height
      const snappedX = Math.round((x - r.left - POOL / 2) / dotSpacing) * dotSpacing
      const snappedY = Math.round((y - r.top - POOL / 2) / dotSpacing) * dotSpacing
      el.style.transform = `translate3d(${snappedX}px, ${snappedY}px, 0)`
      el.style.opacity = inside ? '1' : '0'
    }

  }, [rect, dotSpacing])

  // Radius changes only on hover-a-card or press — never during movement — so
  // the mask repaint it triggers happens a handful of times, not 60x a second.
  const radius = pressed ? pressRadius : intensified ? intensifiedRadius : baseRadius
  const mask = `radial-gradient(circle ${radius}px at center, rgba(0,0,0,1) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0) 100%)`

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        borderRadius,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* Dots revealed around the pointer. Tried an always-visible resting grid
          underneath this (2026-08-12) and it read as clutter — the canvas wants
          to be empty until you reach into it. */}
      <div
        ref={poolRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: POOL,
          height: POOL,
          opacity: 0,
          transform: 'translate3d(-99999px, -99999px, 0)',
          transition: 'opacity 250ms ease, -webkit-mask-image 200ms ease',
          backgroundImage: `radial-gradient(circle, ${dotColor} ${dotSize * POOL_DOT_SCALE}px, transparent ${dotSize * POOL_DOT_SCALE + 0.5}px)`,
          backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
          WebkitMaskImage: mask,
          maskImage: mask,
          // Own layer: transform-only updates stay off the main thread, and the
          // dot raster is reused instead of regenerated. Same lesson as the moon
          // scene, where an explicit layer cut GPU cost by a third.
          willChange: 'transform',
        }}
      />
    </div>
  )
}

export default memo(CanvasGridBlock)
