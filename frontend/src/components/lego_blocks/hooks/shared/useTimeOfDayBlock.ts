import { useEffect, useState } from 'react'
import {
  computeTimePhaseBlock,
  isDarkPhaseBlock,
  type CanvasTimePhase,
} from '@/services/lego_blocks/units/timeOfDayBlock'

export type { CanvasTimePhase }
export { isDarkPhaseBlock }

const RECHECK_INTERVAL_MS = 60_000

export function useTimeOfDayBlock(): CanvasTimePhase {
  const [phase, setPhase] = useState<CanvasTimePhase>(() => computeTimePhaseBlock())

  useEffect(() => {
    const id = setInterval(() => {
      const next = computeTimePhaseBlock()
      setPhase(prev => (prev === next ? prev : next))
    }, RECHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return phase
}
