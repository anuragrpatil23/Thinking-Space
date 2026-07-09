import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Detect whether a component is rendered inside a dark-themed scope.
 *
 * The app toggles a `.dark` class on scoped wrappers (canvas tiles, anchor
 * panels — covering explicit dark mode AND the light-mode night phase), not
 * only on the document root. So dark-ness is a property of the component's
 * ancestry: attach the returned ref to the block's root element and this hook
 * reports whether any ancestor carries `.dark`, re-checking on class changes
 * anywhere in the document.
 *
 * Used by AI-activity blocks to pick the dark palette variant from
 * `getProjectColor(name, isDark)`.
 */
export function useDarkModeClassBlock<T extends HTMLElement = HTMLDivElement>(): {
  hostRef: RefObject<T>
  isDark: boolean
} {
  const hostRef = useRef<T>(null)
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const update = () => setIsDark(!!hostRef.current?.closest('.dark'))
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    })
    return () => obs.disconnect()
  }, [])
  return { hostRef, isDark }
}
