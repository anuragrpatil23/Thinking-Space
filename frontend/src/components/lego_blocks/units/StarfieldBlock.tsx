import { useEffect, useRef } from 'react'

type Star = {
  x: number
  y: number
  r: number
  alpha: number
}

type ShootingStar = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

interface StarfieldProps {
  starColor?: string
  shootingColor?: string
}

// Tuning: stars are static — no twinkle animation, no per-frame redraw while
// idle. The RAF loop only spins while a shooting star is in flight (~1.5s).
// Shooting stars are deliberately rare; they're a flourish, not the focus.
const SHOOT_MIN_GAP_MS = 30_000
const SHOOT_MAX_GAP_MS = 60_000

/** `#rgb` / `#rrggbb` → [r, g, b], so the shooting-star gradient can build
 *  rgba() stops from the same color the static stars use. Falls back to the
 *  charcoal default for anything else — every caller passes a hex today. */
function toRgbTriple(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  if (full.length !== 6 || !/^[0-9a-f]{6}$/i.test(full)) return [31, 41, 55]
  const value = Number.parseInt(full, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export default function Starfield({
  starColor = '#1f2937',
  shootingColor,
}: StarfieldProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const starColorRef = useRef(starColor)
  starColorRef.current = starColor
  const shootingColorRef = useRef(shootingColor ?? starColor)
  shootingColorRef.current = shootingColor ?? starColor

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = media.matches
    const onMediaChange = (e: MediaQueryListEvent) => {
      reduced = e.matches
      // If the user just turned reduce-motion on, cancel any in-flight RAF
      // and any pending shooting-star timer.
      if (reduced) {
        stopRaf()
        clearShootTimer()
        drawStarsOnly()
      } else {
        scheduleNextShoot()
      }
    }
    media.addEventListener?.('change', onMediaChange)

    let width = 0
    let height = 0
    let dpr = 1
    let stars: Star[] = []
    let shooting: ShootingStar[] = []
    let raf = 0
    let shootTimer: ReturnType<typeof setTimeout> | null = null

    const stopRaf = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }
    const clearShootTimer = () => {
      if (shootTimer != null) {
        clearTimeout(shootTimer)
        shootTimer = null
      }
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const area = width * height
      const count = Math.max(60, Math.floor(area * 0.00008))
      stars = Array.from({ length: count }).map(() => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2 + 0.4,
        // Pick a stable alpha per star — varied brightness without animating it.
        alpha: Math.random() * 0.6 + 0.25,
      }))
      drawStarsOnly()
    }

    const drawStars = () => {
      ctx.fillStyle = starColorRef.current
      for (const s of stars) {
        ctx.globalAlpha = s.alpha
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const drawStarsOnly = () => {
      ctx.clearRect(0, 0, width, height)
      drawStars()
    }

    const drawShootingStars = () => {
      shooting = shooting.filter(star => {
        star.x += star.vx
        star.y += star.vy
        star.life += 1

        const t = 1 - star.life / star.maxLife
        const tail = 40 + t * 40
        const grad = ctx.createLinearGradient(
          star.x,
          star.y,
          star.x - star.vx * (tail / 8),
          star.y - star.vy * (tail / 8),
        )
        // Honor shootingColor/starColor. This used to hardcode the charcoal
        // default, so a shooting star flashed near-black across the cream
        // paper backdrop no matter what the theme asked for (2026-08-02).
        const [sr, sg, sb] = toRgbTriple(shootingColorRef.current)
        grad.addColorStop(0, `rgba(${sr},${sg},${sb},${0.55 * t})`)
        grad.addColorStop(1, `rgba(${sr},${sg},${sb},0)`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(star.x, star.y)
        ctx.lineTo(star.x - star.vx * (tail / 8), star.y - star.vy * (tail / 8))
        ctx.stroke()

        return star.life < star.maxLife && star.y < height + 80
      })
    }

    const animate = () => {
      ctx.clearRect(0, 0, width, height)
      drawStars()
      drawShootingStars()
      if (shooting.length > 0) {
        raf = requestAnimationFrame(animate)
      } else {
        raf = 0
      }
    }

    const spawnShootingStar = () => {
      if (reduced || document.hidden) return
      const fromLeft = Math.random() < 0.5
      const startX = fromLeft ? -50 : width + 50
      const startY = Math.random() * height * 0.4
      const vx = fromLeft ? 7 + Math.random() * 4 : -7 - Math.random() * 4
      const vy = 3 + Math.random() * 2
      const maxLife = 60 + Math.random() * 30
      shooting.push({ x: startX, y: startY, vx, vy, life: 0, maxLife })
      if (!raf) raf = requestAnimationFrame(animate)
    }

    const scheduleNextShoot = () => {
      clearShootTimer()
      if (reduced) return
      const gap = SHOOT_MIN_GAP_MS + Math.random() * (SHOOT_MAX_GAP_MS - SHOOT_MIN_GAP_MS)
      shootTimer = setTimeout(() => {
        spawnShootingStar()
        scheduleNextShoot()
      }, gap)
    }

    resize()
    if (!reduced) scheduleNextShoot()

    // Pause everything while the window is hidden — no animation, no shoot
    // scheduling. Resume on visibility.
    const onVisibility = () => {
      if (document.hidden) {
        stopRaf()
        clearShootTimer()
      } else if (!reduced) {
        scheduleNextShoot()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onResize = () => resize()
    window.addEventListener('resize', onResize)

    return () => {
      stopRaf()
      clearShootTimer()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      media.removeEventListener?.('change', onMediaChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  )
}
