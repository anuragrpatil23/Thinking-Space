import { useCallback, useEffect, useRef, useState } from 'react'

/* Hover-to-peek for a document header the user has hidden.

   Hiding the header (nav collapsed, or the eye toggle) is a reading posture,
   not a request to lose the file's name and actions for good. A thin strip at
   the top edge brings the header back as an overlay while the pointer is over
   it, and lets it go once the pointer leaves.

   Both ends are delayed on purpose. An instant reveal is what makes the macOS
   full-screen menu bar a nuisance: it fires every time the pointer passes on
   its way to the tab strip. The hide delay forgives a pointer that overshoots
   the header's bottom edge by a few pixels.

   The header's menus are portalled to the body, so moving into an open menu
   counts as leaving the header. While a menu surface is open the hide is
   re-checked instead of applied; that re-check only runs while a peek is open
   and a menu is up, so it is bounded by interaction, not by time on screen
   (docs/contracts/ENERGY.md). */

const PEEK_REVEAL_DELAY_MS_BLOCK = 150
const PEEK_HIDE_DELAY_MS_BLOCK = 300
const OPEN_MENU_SELECTOR_BLOCK = '.context-menu-surface'

export function useHeaderPeekBlock(enabled: boolean): {
  peeking: boolean
  /** Spread on the invisible top-edge trigger strip. */
  zoneProps: { onMouseEnter: () => void; onMouseLeave: () => void }
  /** Spread on the element wrapping the revealed header. */
  regionProps: { onMouseEnter: () => void; onMouseLeave: () => void }
} {
  const [peeking, setPeeking] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimerBlock = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      clearTimerBlock()
      setPeeking(false)
    }
  }, [clearTimerBlock, enabled])

  useEffect(() => clearTimerBlock, [clearTimerBlock])

  const scheduleRevealBlock = useCallback(() => {
    if (!enabled) return
    clearTimerBlock()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setPeeking(true)
    }, PEEK_REVEAL_DELAY_MS_BLOCK)
  }, [clearTimerBlock, enabled])

  const scheduleHideBlock = useCallback(() => {
    clearTimerBlock()
    const attemptBlock = () => {
      if (document.querySelector(OPEN_MENU_SELECTOR_BLOCK)) {
        timerRef.current = window.setTimeout(attemptBlock, PEEK_HIDE_DELAY_MS_BLOCK)
        return
      }
      timerRef.current = null
      setPeeking(false)
    }
    timerRef.current = window.setTimeout(attemptBlock, PEEK_HIDE_DELAY_MS_BLOCK)
  }, [clearTimerBlock])

  return {
    peeking: enabled && peeking,
    zoneProps: { onMouseEnter: scheduleRevealBlock, onMouseLeave: () => { if (!peeking) clearTimerBlock() } },
    regionProps: { onMouseEnter: clearTimerBlock, onMouseLeave: scheduleHideBlock },
  }
}
