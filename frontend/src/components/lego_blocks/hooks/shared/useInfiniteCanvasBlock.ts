import { useCallback, useEffect, useRef, useState } from 'react'

export interface CanvasTransform {
  x: number
  y: number
  scale: number
}

export type CanvasEdge = 'top' | 'right' | 'bottom' | 'left'

function prefersReducedMotionBlock(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * UIScrollView's resistance curve, used verbatim rather than reinvented.
 *
 * Asymptotic: you can drag forever and it approaches `c * dim` without ever
 * reaching it, so there is no wall to hit and no travel cap to tune. The
 * derivative at zero is `c`, meaning content moves at 55% of the pointer the
 * instant you cross the edge and stiffens continuously from there — that
 * "heavy from the first pixel" quality is most of what reads as native. Free
 * travel followed by a sudden wall is what reads as a web page.
 */
function rubberBandBlock(distance: number, dimension: number, c = 0.55): number {
  const sign = distance < 0 ? -1 : 1
  const x = Math.abs(distance)
  return sign * ((x * dimension * c) / (dimension + c * x))
}

export interface UseInfiniteCanvasOptions {
  worldWidth?: number
  worldHeight?: number
  minScale?: number
  maxScale?: number
  initialScale?: number
  /** When true, the effective min scale never drops below the value that fits
   * the entire world into the current viewport — i.e. the user can't zoom out
   * past "the whole board is visible". Use for surfaces that should behave
   * like a bounded canvas (Webull F9) instead of an infinite-feeling space. */
  clampMinScaleToFit?: boolean
  /** Fires when a pan attempt is clamped at the board boundary. Only fires
   * for wheel/trackpad pan; not for programmatic resetZoom / centerOnWorld /
   * zoom-driven clamping. */
  onEdgeHit?: (edge: CanvasEdge) => void
  /** Initial focus + fit. When set, the hook computes an initial scale that
   *  fits `contentWidth × contentHeight` into the viewport (clamped to
   *  min/max scale, ~0.95 of the smaller axis so there's a small margin) and
   *  centers (worldX, worldY) in the viewport. Applied once after the first
   *  viewport measurement — so small viewports (iPhone) don't open at scale 1
   *  with the content half-offscreen. */
  initialFocus?: {
    worldX: number
    worldY: number
    contentWidth?: number
    contentHeight?: number
  }
}

export interface UseInfiniteCanvasResult {
  transform: CanvasTransform
  containerRef: React.RefObject<HTMLDivElement>
  /** Attach to a wrapper around the board. The hook writes the rubber-band
   *  offset straight to its `style.transform`; it must carry no other
   *  transform of its own. */
  overscrollRef: React.RefObject<HTMLDivElement>
  resetZoom: () => void
  centerOnWorld: (worldX: number, worldY: number) => void
  worldWidth: number
  worldHeight: number
  minScale: number
  maxScale: number
  /** Cached viewport size (updates on resize only). Use this instead of
   * reading containerRef.current.clientWidth in render — that forces a
   * synchronous layout flush every frame during pan/zoom. */
  viewportWidth: number
  viewportHeight: number
}

export function useInfiniteCanvasBlock(
  opts: UseInfiniteCanvasOptions = {},
): UseInfiniteCanvasResult {
  const worldWidth = opts.worldWidth ?? 4500
  const worldHeight = opts.worldHeight ?? 3000
  const baseMinScale = opts.minScale ?? 0.25
  const maxScale = opts.maxScale ?? 1.5
  const initialScale = opts.initialScale ?? 1
  const clampMinScaleToFit = opts.clampMinScaleToFit ?? false

  const containerRef = useRef<HTMLDivElement | null>(null)

  // --- Rubber band -------------------------------------------------------
  //
  // Replaces the edge-flash aurora. Pushing past the board's limit stretches
  // the content with resistance and springs it back on release, so the edge is
  // reported through the pointer rather than through a light you might not be
  // looking at.
  //
  // Presentation-only by construction: the overscroll offset is written
  // straight to a wrapper element's `style.transform` and NEVER enters
  // `transform` state. Tile culling, the minimap, coordinate math and
  // persistence therefore keep seeing the clamped value and need to know
  // nothing about this. It also means the release spring runs without a single
  // React render — a 60fps spring routed through setState would re-render every
  // tile for the duration, which is the cost this whole effort is removing.
  const overscrollRef = useRef<HTMLDivElement | null>(null)
  const overscrollRafRef = useRef<number | null>(null)
  const overscrollRafActiveRef = useRef(false)
  const overscrollValueRef = useRef({ x: 0, y: 0 })

  const writeOverscroll = useCallback((x: number, y: number) => {
    overscrollValueRef.current = { x, y }
    const el = overscrollRef.current
    if (!el) return
    el.style.transform = x === 0 && y === 0 ? '' : `translate3d(${x}px, ${y}px, 0)`
  }, [])

  const cancelOverscrollSpring = useCallback(() => {
    if (overscrollRafRef.current !== null) {
      cancelAnimationFrame(overscrollRafRef.current)
      overscrollRafRef.current = null
    }
    overscrollRafActiveRef.current = false
  }, [])

  /**
   * Springs the overscroll offset back to zero.
   *
   * Critically damped (damping ratio exactly 1) so it settles without
   * overshoot — a bouncy return is the single clearest tell of a web page
   * imitating a native scroll view. Runs on rAF rather than a CSS transition
   * because it has to be interruptible: grabbing the canvas mid-spring must
   * pick up from wherever the content currently is, not snap or stutter.
   */
  const startOverscrollSpring = useCallback(() => {
    cancelOverscrollSpring()
    const start = overscrollValueRef.current
    if (start.x === 0 && start.y === 0) return

    if (prefersReducedMotionBlock()) {
      writeOverscroll(0, 0)
      return
    }

    const OMEGA = 22 // rad/s — ~300ms to visually settle
    let last = performance.now()
    let px = start.x
    let py = start.y
    let vx = 0
    let vy = 0

    overscrollRafActiveRef.current = true
    const step = (now: number) => {
      // Clamp dt so a dropped frame or a backgrounded tab cannot fling the
      // spring past its rest position on resume.
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now

      const ax = -2 * OMEGA * vx - OMEGA * OMEGA * px
      const ay = -2 * OMEGA * vy - OMEGA * OMEGA * py
      vx += ax * dt
      vy += ay * dt
      px += vx * dt
      py += vy * dt

      if (Math.abs(px) < 0.1 && Math.abs(py) < 0.1 && Math.hypot(vx, vy) < 1) {
        writeOverscroll(0, 0)
        overscrollRafRef.current = null
        overscrollRafActiveRef.current = false
        return
      }
      writeOverscroll(px, py)
      overscrollRafRef.current = requestAnimationFrame(step)
    }
    overscrollRafRef.current = requestAnimationFrame(step)
  }, [cancelOverscrollSpring, writeOverscroll])
  const [transform, setTransform] = useState<CanvasTransform>(() => ({
    x: -worldWidth / 2 + (typeof window !== 'undefined' ? window.innerWidth / 2 : 0),
    y: -worldHeight / 2 + (typeof window !== 'undefined' ? window.innerHeight / 2 : 0),
    scale: initialScale,
  }))

  const transformRef = useRef(transform)
  transformRef.current = transform

  const onEdgeHitRef = useRef(opts.onEdgeHit)
  onEdgeHitRef.current = opts.onEdgeHit

  // Cached container rect + viewport size. Reading getBoundingClientRect /
  // clientWidth on every wheel event forces a synchronous layout flush, which
  // murders pan/zoom smoothness at trackpad's 120Hz event rate. We update
  // this cache only on mount and resize via ResizeObserver.
  // The ref holds left/top for hit-testing in wheel handler (no re-render
  // needed); state holds width/height so consumers can use them in render
  // without re-querying the DOM.
  const viewportRef = useRef({ left: 0, top: 0, width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  // When clampMinScaleToFit is on, the floor for zoom-out is the scale at
  // which the entire world fits inside the current viewport — keeps the user
  // from panning into infinite sky on bounded surfaces like F9.
  const minScale = (() => {
    if (!clampMinScaleToFit || viewportSize.width === 0 || viewportSize.height === 0) {
      return baseMinScale
    }
    const fitScale = Math.min(viewportSize.width / worldWidth, viewportSize.height / worldHeight)
    return Math.max(baseMinScale, fitScale)
  })()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Block iOS Safari's native two-finger scroll / pinch-zoom on the canvas
    // so our pointer-based pan + pinch get the gesture instead. `touch-action:
    // none` opts the whole subtree out of browser-default touch gestures —
    // children (tiles, buttons, scrollers) can opt back in with their own
    // touch-action where needed.
    el.style.touchAction = 'none'
    const measure = () => {
      const r = el.getBoundingClientRect()
      viewportRef.current = { left: r.left, top: r.top, width: r.width, height: r.height }
      setViewportSize(prev =>
        prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [])

  // Clamp the pan so panning can't run off into infinity. Two modes:
  //   - Default (Home): allow one viewport worth of overscroll past each edge,
  //     so the user can drag the board fully off-screen if they want.
  //   - clampMinScaleToFit (F9): tight clamp — the board edges meet the
  //     viewport edges, never crossing them. Combined with the fit floor on
  //     `minScale` above, this guarantees the board always fills the viewport
  //     and you can never see "sky" outside it.
  // Reads cached viewport dims — does NOT force layout.
  const clampTransform = useCallback(
    (t: CanvasTransform): CanvasTransform => {
      const { width: viewW, height: viewH } = viewportRef.current
      const boardW = worldWidth * t.scale
      const boardH = worldHeight * t.scale
      let x: number
      let y: number
      if (clampMinScaleToFit) {
        const minX = viewW - boardW
        const minY = viewH - boardH
        // When the board is smaller than the viewport on an axis (shouldn't
        // happen with the fit-floor on minScale, but guard anyway), pin the
        // board centered instead of pinning to the left edge.
        x = boardW <= viewW ? (viewW - boardW) / 2 : Math.min(0, Math.max(minX, t.x))
        y = boardH <= viewH ? (viewH - boardH) / 2 : Math.min(0, Math.max(minY, t.y))
      } else {
        x = Math.min(viewW, Math.max(-boardW, t.x))
        y = Math.min(viewH, Math.max(-boardH, t.y))
      }
      return { ...t, x, y }
    },
    [worldWidth, worldHeight, clampMinScaleToFit],
  )

  // When the effective min scale rises (e.g. viewport just laid out, or the
  // window shrank), pull the current transform up to it so the user is never
  // stuck "below" the new floor.
  useEffect(() => {
    setTransform(prev => {
      if (prev.scale >= minScale) return prev
      const factor = minScale / prev.scale
      const cx = viewportSize.width / 2
      const cy = viewportSize.height / 2
      return clampTransform({
        scale: minScale,
        x: cx - (cx - prev.x) * factor,
        y: cy - (cy - prev.y) * factor,
      })
    })
  }, [minScale, viewportSize.width, viewportSize.height, clampTransform])

  // Apply initialFocus once after the viewport has been measured. Done in an
  // effect (not initial useState) because we need the actual viewport dims to
  // pick a sane scale; on first paint the container hasn't laid out yet.
  const initialFocusAppliedRef = useRef(false)
  const initialFocusOpt = opts.initialFocus
  useEffect(() => {
    if (initialFocusAppliedRef.current) return
    if (!initialFocusOpt) return
    if (viewportSize.width === 0 || viewportSize.height === 0) return
    const cw = initialFocusOpt.contentWidth ?? worldWidth
    const ch = initialFocusOpt.contentHeight ?? worldHeight
    const fitScale = Math.min(viewportSize.width / cw, viewportSize.height / ch) * 0.95
    const scale = Math.min(maxScale, Math.max(minScale, fitScale))
    const x = viewportSize.width / 2 - initialFocusOpt.worldX * scale
    const y = viewportSize.height / 2 - initialFocusOpt.worldY * scale
    setTransform(clampTransform({ x, y, scale }))
    initialFocusAppliedRef.current = true
  }, [viewportSize, initialFocusOpt, worldWidth, worldHeight, minScale, maxScale, clampTransform])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const v = viewportRef.current
      if (v.width === 0) return
      const cx = e.clientX - v.left
      const cy = e.clientY - v.top
      const prev = transformRef.current

      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        const newScale = Math.min(maxScale, Math.max(minScale, prev.scale * factor))
        const realFactor = newScale / prev.scale
        setTransform(clampTransform({
          scale: newScale,
          x: cx - (cx - prev.x) * realFactor,
          y: cy - (cy - prev.y) * realFactor,
        }))
      } else {
        const desired = {
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }
        const clamped = clampTransform(desired)
        setTransform(clamped)
        const cb = onEdgeHitRef.current
        if (cb) {
          // Detect which edge the clamp truncated against. clamped.x > desired.x
          // means the clamp lifted x back up — desired had pushed below the lower
          // bound (-boardW), i.e. the user tried to pan further right than the
          // board's right edge. Symmetric for the other three.
          if (clamped.x > desired.x) cb('right')
          else if (clamped.x < desired.x) cb('left')
          if (clamped.y > desired.y) cb('bottom')
          else if (clamped.y < desired.y) cb('top')
        }
      }
    },
    [maxScale, minScale, clampTransform],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Multi-pointer gesture state. One pointer = pan; two pointers = pinch
  // (zoom around the midpoint while panning by the midpoint delta). Touch +
  // mouse + pen all unify under PointerEvent so we don't have to maintain
  // separate iOS / Android / desktop paths.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const pointers = new Map<number, { x: number; y: number }>()
    let mode: 'idle' | 'pan-pending' | 'pan' | 'pinch' = 'idle'
    let panStart = { x: 0, y: 0 }
    let panStartTransform: CanvasTransform = transformRef.current
    let pinchStartDist = 0
    let pinchStartMid = { x: 0, y: 0 }
    let pinchStartTransform: CanvasTransform = transformRef.current

    const midOf = (pts: Array<{ x: number; y: number }>) => ({
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    })
    const distOf = (pts: Array<{ x: number; y: number }>) => {
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      return Math.hypot(dx, dy)
    }
    const viewportLocal = (x: number, y: number) => {
      const v = viewportRef.current
      return { x: x - v.left, y: y - v.top }
    }

    const startPinch = () => {
      const pts = [...pointers.values()]
      if (pts.length < 2) return
      pinchStartDist = distOf(pts) || 1
      pinchStartMid = viewportLocal(midOf(pts).x, midOf(pts).y)
      pinchStartTransform = transformRef.current
      mode = 'pinch'
    }

    const onDown = (e: PointerEvent) => {
      // Grabbing mid-spring must continue from wherever the content is now.
      // A non-interruptible return animation is the clearest "this is a web
      // page" tell there is.
      cancelOverscrollSpring()
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-canvas-backdrop="true"]')) return
      if (
        target.closest(
          '[data-canvas-tile="true"], [data-canvas-anchor-element="true"], button, input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return
      }
      const isTouch = e.pointerType === 'touch'
      // Mouse / pen still pans with a single button press — that's the
      // ergonomic desktop pattern. Touch requires TWO fingers for any canvas
      // gesture (pan + pinch), so a single tap can scroll a tile or open
      // something without accidentally dragging the world. Tracking starts on
      // the second touch finger; the first one only registers as "fingers
      // down: 1" without entering pan mode.
      if (e.pointerType === 'mouse' && e.button !== 0) return

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (!isTouch && pointers.size === 1) {
        // Don't capture or preventDefault yet: doing so on pointerdown
        // retargets the eventual click/dblclick to the container, which
        // silently kills the backdrop's double-click-to-create-post-it and
        // mousedown-to-unfocus handlers. Pan only begins (and captures the
        // pointer) once the mouse actually moves past a small threshold.
        panStart = { x: e.clientX, y: e.clientY }
        panStartTransform = transformRef.current
        mode = 'pan-pending'
      } else if (isTouch && pointers.size === 2) {
        for (const id of pointers.keys()) {
          try { el.setPointerCapture(id) } catch { /* not supported */ }
        }
        e.preventDefault()
        // Two-finger gesture combines pan (midpoint translation) + pinch
        // (distance ratio → scale). Single mode handles both.
        startPinch()
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (mode === 'pan-pending' && pointers.size === 1) {
        const moved = Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y)
        if (moved < 4) return
        try { el.setPointerCapture(e.pointerId) } catch { /* not supported */ }
        mode = 'pan'
      }

      if (mode === 'pan' && pointers.size === 1) {
        e.preventDefault()
        const desired = {
          ...panStartTransform,
          x: panStartTransform.x + e.clientX - panStart.x,
          y: panStartTransform.y + e.clientY - panStart.y,
        }
        const clamped = clampTransform(desired)
        setTransform(clamped)

        // Whatever the clamp refused to give is the overscroll. Feed it through
        // the resistance curve and hand it to the wrapper — the clamped value
        // above is still what the rest of the canvas sees.
        const { width: viewW, height: viewH } = viewportRef.current
        const rawX = desired.x - clamped.x
        const rawY = desired.y - clamped.y
        if (rawX !== 0 || rawY !== 0) {
          cancelOverscrollSpring()
          writeOverscroll(
            rubberBandBlock(rawX, viewW),
            rubberBandBlock(rawY, viewH),
          )
        } else if (overscrollValueRef.current.x !== 0 || overscrollValueRef.current.y !== 0) {
          // Dragged back inside the bounds without lifting — release the
          // stretch immediately so it tracks the pointer instead of lagging.
          writeOverscroll(0, 0)
        }

        const cb = onEdgeHitRef.current
        if (cb) {
          if (clamped.x > desired.x) cb('right')
          else if (clamped.x < desired.x) cb('left')
          if (clamped.y > desired.y) cb('bottom')
          else if (clamped.y < desired.y) cb('top')
        }
      } else if (mode === 'pinch' && pointers.size >= 2) {
        e.preventDefault()
        const pts = [...pointers.values()].slice(0, 2)
        const newDist = distOf(pts) || 1
        const newMidGlobal = midOf(pts)
        const newMid = viewportLocal(newMidGlobal.x, newMidGlobal.y)
        const ratio = newDist / pinchStartDist
        const targetScale = Math.min(maxScale, Math.max(minScale, pinchStartTransform.scale * ratio))
        const realFactor = targetScale / pinchStartTransform.scale
        // Zoom anchored at the original midpoint (in viewport coords) PLUS pan
        // by however far the midpoint itself has moved across the screen.
        const x = pinchStartMid.x - (pinchStartMid.x - pinchStartTransform.x) * realFactor + (newMid.x - pinchStartMid.x)
        const y = pinchStartMid.y - (pinchStartMid.y - pinchStartTransform.y) * realFactor + (newMid.y - pinchStartMid.y)
        setTransform(clampTransform({ x, y, scale: targetScale }))
      }
    }

    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const wasTouch = e.pointerType === 'touch'
      pointers.delete(e.pointerId)
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (wasTouch) {
        // Touch policy: ANY gesture requires two fingers. Dropping below 2
        // touches exits the gesture entirely — we do NOT fall back to a
        // one-finger pan (which would feel like the canvas is grabbing
        // single taps).
        if (pointers.size < 2) mode = 'idle'
      } else if (pointers.size === 0) {
        mode = 'idle'
      }
      // Gesture over: let the stretch spring home. Safe to call unconditionally
      // — it returns immediately when there is no overscroll to release.
      if (mode === 'idle') startOverscrollSpring()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove, { passive: false })
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onUp)
    }
  }, [clampTransform, minScale, maxScale, cancelOverscrollSpring, startOverscrollSpring, writeOverscroll])

  const resetZoom = useCallback(() => {
    setTransform(clampTransform({
      x: -worldWidth / 2 + window.innerWidth / 2,
      y: -worldHeight / 2 + window.innerHeight / 2,
      scale: 1,
    }))
  }, [worldWidth, worldHeight, clampTransform])

  const centerOnWorld = useCallback((worldX: number, worldY: number) => {
    const { width: viewW, height: viewH } = viewportRef.current
    setTransform(prev => clampTransform({
      ...prev,
      x: viewW / 2 - worldX * prev.scale,
      y: viewH / 2 - worldY * prev.scale,
    }))
  }, [clampTransform])

  return {
    transform,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    overscrollRef: overscrollRef as React.RefObject<HTMLDivElement>,
    resetZoom,
    centerOnWorld,
    worldWidth,
    worldHeight,
    minScale,
    maxScale,
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
  }
}
