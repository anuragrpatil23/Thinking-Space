import { useEffect, useRef } from 'react'

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  rect: ScreenRect
  baseRadius?: number
  intensifiedRadius?: number
  intensified?: boolean
  dotSize?: number
  dotSpacing?: number
  dotColor?: string
}

export default function CanvasBloomBlock({
  rect,
  baseRadius = 220,
  intensifiedRadius = 340,
  intensified = false,
  dotSize = 1,
  dotSpacing = 24,
  dotColor = 'rgba(255,255,255,0.28)',
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const target = useRef({ x: -9999, y: -9999, opacity: 0 })
  const rectRef = useRef(rect)
  rectRef.current = rect

  useEffect(() => {
    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const el = ref.current
        if (!el) return
        const r = rectRef.current
        // bloom coords are relative to the bloom element, which is positioned at the rect
        el.style.setProperty('--bloom-x', `${target.current.x - r.left}px`)
        el.style.setProperty('--bloom-y', `${target.current.y - r.top}px`)
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

  const radius = intensified ? intensifiedRadius : baseRadius
  const mask = `radial-gradient(circle ${radius}px at var(--bloom-x, -9999px) var(--bloom-y, -9999px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0) 100%)`

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        opacity: 'var(--bloom-opacity, 0)' as unknown as number,
        transition: 'opacity 250ms ease',
        backgroundImage: `radial-gradient(circle, ${dotColor} ${dotSize}px, transparent ${dotSize + 0.5}px)`,
        backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
        WebkitMaskImage: mask,
        maskImage: mask,
        overflow: 'hidden',
      }}
    />
  )
}
