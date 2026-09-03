import { useCallback, useEffect, useRef, useState } from 'react'
import {
  advanceReaderChromeStateBlock,
  createReaderChromeStateBlock,
  type ReaderChromeStateBlock,
} from '@/services/lego_blocks/units/readerChromeVisibilityBlock'
import { useNativeChromeImmersionBlock } from '@/components/lego_blocks/hooks/shared/useNativeChromeImmersionBlock'

/* Drives auto-hiding reader chrome from a scroll container.

   Scroll is sampled on a rAF rather than handled inline: scroll events fire far
   more often than frames on a trackpad, and the state machine only ever
   produces one answer per frame anyway. No timers are involved, so this stays
   inside the energy contract's no-unconditional-interval rule — everything here
   is driven by real scroll events and stops when they do.

   While chrome is hidden the hook also holds a native-iOS immersion lease, so
   the SwiftUI top bar slides away with the in-app toolbar instead of leaving a
   native strip floating over a full-bleed page. */
export function useReaderChromeVisibilityBlock(params: {
  scrollRef: React.RefObject<HTMLElement | null>
  enabled: boolean
}): { chromeVisible: boolean; revealChrome: () => void; toggleChrome: () => void } {
  const { scrollRef, enabled } = params
  const [visible, setVisible] = useState(true)
  const stateRef = useRef<ReaderChromeStateBlock>(createReaderChromeStateBlock())
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setVisible(true)
      stateRef.current = createReaderChromeStateBlock()
      return
    }

    const target = scrollRef.current
    if (!target) return

    const sampleBlock = () => {
      frameRef.current = null
      const next = advanceReaderChromeStateBlock(stateRef.current, {
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
      })
      const changed = next.visible !== stateRef.current.visible
      stateRef.current = next
      if (changed) setVisible(next.visible)
    }

    const handleScrollBlock = () => {
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(sampleBlock)
    }

    target.addEventListener('scroll', handleScrollBlock, { passive: true })
    return () => {
      target.removeEventListener('scroll', handleScrollBlock)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [enabled, scrollRef])

  const revealChrome = useCallback(() => {
    stateRef.current = { ...stateRef.current, visible: true, anchorScrollTop: stateRef.current.lastScrollTop }
    setVisible(true)
  }, [])

  const toggleChrome = useCallback(() => {
    setVisible((prev) => {
      stateRef.current = {
        ...stateRef.current,
        visible: !prev,
        anchorScrollTop: stateRef.current.lastScrollTop,
      }
      return !prev
    })
  }, [])

  useNativeChromeImmersionBlock(enabled && !visible)

  return { chromeVisible: enabled ? visible : true, revealChrome, toggleChrome }
}
