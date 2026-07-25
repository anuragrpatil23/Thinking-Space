import { useEffect, useState } from 'react'
import { acquireScreenWakeLockBlock } from '@/services/lego_blocks/units/screenWakeLockBlock'
import {
  READING_KEEP_SCREEN_AWAKE_EVENT,
  getReadingKeepScreenAwake,
} from '@/services/lego_blocks/units/storageKeyBlock'

/**
 * Holds the display awake while `active` is true and the user hasn't opted out.
 *
 * Callers pass the narrowest possible `active` — a *visible* document in *view*
 * mode — so the lease tracks actual reading rather than "the app is open".
 * Release is automatic on unmount, on losing visibility, and on toggling the
 * preference off mid-read.
 */
export function useScreenWakeLockBlock(active: boolean): void {
  const [enabled, setEnabled] = useState(getReadingKeepScreenAwake)

  useEffect(() => {
    const sync = () => setEnabled(getReadingKeepScreenAwake())
    window.addEventListener(READING_KEEP_SCREEN_AWAKE_EVENT, sync)
    return () => window.removeEventListener(READING_KEEP_SCREEN_AWAKE_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!active || !enabled) return
    return acquireScreenWakeLockBlock()
  }, [active, enabled])
}
