import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react'

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  /** Board rect in container coordinates. */
  rect: ScreenRect
  /** Container viewport size, used to clip the board rect down to what's
   * actually on screen. */
  viewportWidth: number
  viewportHeight: number
  baseRadius?: number
  intensifiedRadius?: number
  dotSize?: number
  dotSpacing?: number
  dotColor?: string
}

export interface CanvasBloomHandle {
  /** Widen the glow while a tile is hovered. Imperative so hovering a tile
   * doesn't re-render the canvas tree — the radius is a CSS variable. */
  setIntensified: (intensified: boolean) => void
}

const CanvasBloomBlock = memo(
  forwardRef<CanvasBloomHandle, Props>(function CanvasBloomBlock({
  rect,
  viewportWidth,
  viewportHeight,
  baseRadius = 220,
  intensifiedRadius = 340,
  dotSize = 1,
  dotSpacing = 24,
  dotColor = 'rgba(255,255,255,0.28)',
}: Props, handleRef) {
  const ref = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(
    handleRef,
    () => ({
      setIntensified: (intensified: boolean) => {
        ref.current?.style.setProperty(
          '--bloom-radius',
          `${intensified ? intensifiedRadius : baseRadius}px`,
        )
      },
    }),
    [baseRadius, intensifiedRadius],
  )
  const rafRef = useRef<number | null>(null)
  const target = useRef({ x: -9999, y: -9999, opacity: 0 })
  const rectRef = useRef(rect)
  rectRef.current = rect
  // Element origin in container coords — the glow center is relative to it.
  const originRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const el = ref.current
        if (!el) return
        const o = originRef.current
        // bloom coords are relative to the bloom element's own top-left
        el.style.setProperty('--bloom-x', `${target.current.x - o.x}px`)
        el.style.setProperty('--bloom-y', `${target.current.y - o.y}px`)
        el.style.setProperty('--bloom-opacity', `${target.current.opacity}`)
      })
    }
    const isInside = (x: number, y: number) => {
      const r = rectRef.current
      return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height
    }
    const onMove = (e: MouseEvent) => {
      target.current.x = e.clientX
      target.current.y = e.clientY
      target.current.opacity = isInside(e.clientX, e.clientY) ? 1 : 0
      schedule()
    }
    const onLeave = () => {
      target.current.opacity = 0
      schedule()
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Size the element to the *intersection* of the board and the viewport, not
  // to either one alone. Sizing it to the world (4500 x 4500 = 20MP) repaints
  // and re-masks an area that is transparent by construction outside the
  // ~340px glow; sizing it to the viewport is worse when zoomed out, where the
  // whole board is only ~1125px across. The intersection is never larger than
  // either, so it is never worse than the original at any zoom.
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  const x0 = clamp(rect.left, viewportWidth)
  const y0 = clamp(rect.top, viewportHeight)
  const x1 = clamp(rect.left + rect.width, viewportWidth)
  const y1 = clamp(rect.top + rect.height, viewportHeight)
  originRef.current = { x: x0, y: y0 }

  // The dot grid repeats every `dotSpacing`, so anchoring modulo the spacing is
  // pixel-identical to anchoring at the raw board origin.
  const wrap = (v: number) => ((v % dotSpacing) + dotSpacing) % dotSpacing

  const mask = `radial-gradient(circle var(--bloom-radius, ${baseRadius}px) at var(--bloom-x, -9999px) var(--bloom-y, -9999px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0) 100%)`

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        left: x0,
        top: y0,
        width: Math.max(0, x1 - x0),
        height: Math.max(0, y1 - y0),
        pointerEvents: 'none',
        opacity: 'var(--bloom-opacity, 0)' as unknown as number,
        transition: 'opacity 250ms ease',
        backgroundImage: `radial-gradient(circle, ${dotColor} ${dotSize}px, transparent ${dotSize + 0.5}px)`,
        backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
        backgroundPosition: `${wrap(rect.left - x0)}px ${wrap(rect.top - y0)}px`,
        WebkitMaskImage: mask,
        maskImage: mask,
        overflow: 'hidden',
      }}
    />
  )
}),
)

export default CanvasBloomBlock
