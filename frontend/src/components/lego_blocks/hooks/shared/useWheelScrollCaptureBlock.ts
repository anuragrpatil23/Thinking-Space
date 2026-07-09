import { useEffect } from 'react'

/**
 * Capture wheel/trackpad scroll for an overflowing scroll container so it scrolls
 * in place instead of leaking to the canvas underneath (pan/zoom). Same contract
 * the drill table uses, generalized to an axis:
 *
 *  - Only the on-axis component of the gesture is captured; a cross-axis gesture
 *    passes through untouched. For a horizontal strip that means a two-finger
 *    horizontal swipe scrolls the strip, but a vertical swipe still pans the
 *    board — you're never trapped inside the element.
 *  - At the scroll boundary in the wheel's direction the event is released so the
 *    canvas resumes (no dead zone at the ends).
 *  - Does nothing while the container isn't actually overflowing on that axis.
 *
 * The listener is attached natively (non-passive) so preventDefault can stop the
 * canvas from also handling the wheel.
 */
export function useWheelScrollCaptureBlock(
  ref: React.RefObject<HTMLElement | null>,
  axis: 'x' | 'y',
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const overflowing =
        axis === 'x'
          ? el.scrollWidth - el.clientWidth > 1
          : el.scrollHeight - el.clientHeight > 1
      if (!overflowing) return
      const primary = axis === 'x' ? e.deltaX : e.deltaY
      const cross = axis === 'x' ? e.deltaY : e.deltaX
      // Cross-axis-dominant gestures belong to the canvas, not this element.
      if (Math.abs(primary) <= Math.abs(cross)) return
      const atStart = axis === 'x' ? el.scrollLeft <= 0 : el.scrollTop <= 0
      const atEnd =
        axis === 'x'
          ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
          : el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((primary < 0 && atStart) || (primary > 0 && atEnd)) return
      e.preventDefault()
      e.stopPropagation()
      if (axis === 'x') el.scrollLeft += primary
      else el.scrollTop += primary
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, axis])
}
