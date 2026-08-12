import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react'

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  /** Board rect in container coordinates. Anchors the dot grid and clips it. */
  rect: ScreenRect
  /** Container viewport size. The element is sized to this, not to the board. */
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

/**
 * Cursor glow over the board's dot grid.
 *
 * The element is sized to the *viewport*, not the world. Everything outside the
 * ~340px glow is masked to fully transparent, so a world-sized element (4500 x
 * 4500 = 20MP, 81MP at 2x retina) was rasterizing and masking an area that is
 * transparent by construction. Two properties reproduce the old geometry
 * exactly:
 *   - `background-position` anchors the dot grid to the board origin, so the
 *     dots still pan with the world instead of sticking to the screen.
 *   - `clip-path` reproduces the old element bounds, so dots still stop at the
 *     board edge and never bleed into the sky around it.
 */
const CanvasBloomBlock = memo(
  forwardRef<CanvasBloomHandle, Props>(function CanvasBloomBlock(
    {
      rect,
      viewportWidth,
      viewportHeight,
      baseRadius = 220,
      intensifiedRadius = 340,
      dotSize = 1,
      dotSpacing = 24,
      dotColor = 'rgba(255,255,255,0.28)',
    },
    handleRef,
  ) {
    const ref = useRef<HTMLDivElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const target = useRef({ x: -9999, y: -9999, opacity: 0 })
    const rectRef = useRef(rect)
    rectRef.current = rect

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

    useEffect(() => {
      const schedule = () => {
        if (rafRef.current != null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          const el = ref.current
          if (!el) return
          // The element now sits at the container origin, so the glow center in
          // element-local coords is just the pointer position — the previous
          // `- r.left` cancelled against the element's own offset.
          el.style.setProperty('--bloom-x', `${target.current.x}px`)
          el.style.setProperty('--bloom-y', `${target.current.y}px`)
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

    const mask = `radial-gradient(circle var(--bloom-radius, ${baseRadius}px) at var(--bloom-x, -9999px) var(--bloom-y, -9999px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0) 100%)`

    // The dot grid repeats every `dotSpacing`, so anchoring modulo the spacing
    // is pixel-identical to anchoring at the raw board origin, and keeps the
    // offset small when the board is panned far from the viewport.
    const wrap = (v: number) => ((v % dotSpacing) + dotSpacing) % dotSpacing

    // Reproduce the old element bounds as a clip. Insets are clamped to the
    // viewport so an off-screen board yields an empty clip (nothing painted),
    // which is what a zero-overlap element bounds gave before.
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
    const clipTop = clamp(rect.top, viewportHeight)
    const clipLeft = clamp(rect.left, viewportWidth)
    const clipRight = clamp(viewportWidth - (rect.left + rect.width), viewportWidth)
    const clipBottom = clamp(viewportHeight - (rect.top + rect.height), viewportHeight)

    return (
      <div
        ref={ref}
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: viewportWidth,
          height: viewportHeight,
          pointerEvents: 'none',
          opacity: 'var(--bloom-opacity, 0)' as unknown as number,
          transition: 'opacity 250ms ease',
          backgroundImage: `radial-gradient(circle, ${dotColor} ${dotSize}px, transparent ${dotSize + 0.5}px)`,
          backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
          backgroundPosition: `${wrap(rect.left)}px ${wrap(rect.top)}px`,
          clipPath: `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`,
          WebkitMaskImage: mask,
          maskImage: mask,
          overflow: 'hidden',
        }}
      />
    )
  }),
)

export default CanvasBloomBlock
