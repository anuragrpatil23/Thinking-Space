import { useEffect } from 'react'
import { acquireNativeChromeImmersionBlock } from '@/services/lego_blocks/units/nativeChromeImmersionBlock'

/**
 * Hold a native-chrome immersion lease while `active` is true — the iOS
 * native top bar + veil hide so a fullscreen web overlay (focus mode) owns
 * the screen. No-op on surfaces without native chrome: App.tsx only folds
 * the immersion state into the bridge when the native chrome is enabled.
 */
export function useNativeChromeImmersionBlock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return acquireNativeChromeImmersionBlock()
  }, [active])
}
