import { useState } from 'react'
import {
  computeTimePhaseBlock,
  isDarkPhaseBlock,
  type CanvasTimePhase,
} from '@/services/lego_blocks/units/timeOfDayBlock'
import { useVisibleIntervalBlock } from './useVisibleIntervalBlock'

export type { CanvasTimePhase }
export { isDarkPhaseBlock }

const RECHECK_INTERVAL_MS = 60_000

export function useTimeOfDayBlock(): CanvasTimePhase {
  const [phase, setPhase] = useState<CanvasTimePhase>(() => computeTimePhaseBlock())

  // Recomputed on resume as well as on the interval, so a canvas left open
  // overnight is not still painted for yesterday afternoon when you come back.
  useVisibleIntervalBlock(() => {
    const next = computeTimePhaseBlock()
    setPhase(prev => (prev === next ? prev : next))
  }, RECHECK_INTERVAL_MS)

  return phase
}
