import { useEffect } from 'react'

/**
 * Capture wheel/trackpad scroll for an overflowing scroll container so it scrolls
 * in place instead of leaking to the canvas underneath (pan/zoom). Same contract
 * the drill table uses, generalized to an axis — while the cursor is over the
 * element it OWNS the wheel:
 *
 *  - Both trackpad axes drive the scroll: for a horizontal strip a horizontal
 *    swipe (deltaX) scrolls it, and a plain vertical swipe (deltaY) does too, so
 *    you don't have to remember to swipe sideways. Whichever component is present
 *    is applied to the element's scroll offset.
 *  - At the scroll boundary in that direction the event is released so the canvas
 *    resumes (no dead zone at the ends — pan past the element once it's scrolled
 *    to its edge).
 *  - Does nothing while the container isn't actually overflowing on that axis, so
 *    a strip that fits never traps the wheel.
 *
 * The listener is attached natively (non-passive) so preventDefault can stop the
 * canvas from also handling the wheel. Re-attaches when `ready` changes so it
 * still binds if the scroll container mounts after the first render (e.g. behind
 * a loading gate).
 */
export function useWheelScrollCaptureBlock(
  ref: React.RefObject<HTMLElement | null>,
  axis: 'x' | 'y',
  ready = true,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    const onWheel = (e: WheelEvent) => {
      const overflowing =
        axis === 'x'
          ? el.scrollWidth - el.clientWidth > 1
          : el.scrollHeight - el.clientHeight > 1
      if (!overflowing) return
      // Prefer the on-axis component; fall back to the cross-axis delta so a
      // plain vertical trackpad scroll still moves a horizontal strip.
      const onAxis = axis === 'x' ? e.deltaX : e.deltaY
      const crossAxis = axis === 'x' ? e.deltaY : e.deltaX
      const delta = onAxis !== 0 ? onAxis : crossAxis
      if (delta === 0) return
      const atStart = axis === 'x' ? el.scrollLeft <= 0 : el.scrollTop <= 0
      const atEnd =
        axis === 'x'
          ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
          : el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return
      e.preventDefault()
      e.stopPropagation()
      if (axis === 'x') el.scrollLeft += delta
      else el.scrollTop += delta
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, axis, ready])
}
