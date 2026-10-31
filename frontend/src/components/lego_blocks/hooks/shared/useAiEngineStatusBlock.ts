// Engine state plus queue depth, for the surfaces that summarise AI work
// without listing it: the AI section of the ⋯ menu and the dot on its button.
//
// Event-driven only. The engine monitor polls while there is work; this hook
// just listens, so an idle app runs no timer for it (docs/contracts/ENERGY.md).
// `refreshWhen` asks for one probe each time it turns true (a menu opening), so
// a surface opened while idle shows the engine as it is now, not as last seen.

import { useEffect, useState } from 'react'
import {
  getEngineStateBlock,
  isEngineSupervisedBlock,
  refreshEngineStateBlock,
  subscribeEngineStateBlock,
} from '@/services/lego_blocks/integrations/intelligence/engineMonitorBlock'
import {
  readTelemetryBlock,
  subscribeTelemetryBlock,
  type TelemetryEntry,
} from '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'
import {
  intelligenceQueueDepthBlock,
  subscribeIntelligenceQueueBlock,
} from '@/services/lego_blocks/integrations/intelligence/jobQueueBlock'
import type { EngineStateBlock } from '@/services/lego_blocks/units/intelligence/engineStatusBlock'

export interface AiEngineStatusBlock {
  engine: EngineStateBlock
  running: number
  queued: number
  /** Whether a supervisor manages this engine — only then is "down" with
   *  nothing queued still worth flagging. */
  supervised: boolean
  /** Output tokens per second across the last few real runs, or null. */
  recentTokensPerSecond: number | null
}

const RECENT_RUNS = 10

function recentTokensPerSecondBlock(entries: TelemetryEntry[]): number | null {
  let tokens = 0
  let ms = 0
  let n = 0
  for (const e of entries) {
    if (e.status !== 'ok' || !e.usage?.completionTokens || e.latencyMs <= 0) continue
    tokens += e.usage.completionTokens
    ms += e.latencyMs
    if (++n >= RECENT_RUNS) break
  }
  return ms > 0 ? tokens / (ms / 1000) : null
}

export function useAiEngineStatusBlock(refreshWhen = false): AiEngineStatusBlock {
  const [engine, setEngine] = useState(getEngineStateBlock)
  const [depth, setDepth] = useState(intelligenceQueueDepthBlock)
  const [tps, setTps] = useState(() => recentTokensPerSecondBlock(readTelemetryBlock()))

  useEffect(() => subscribeEngineStateBlock(() => setEngine(getEngineStateBlock())), [])
  useEffect(() => subscribeIntelligenceQueueBlock(() => setDepth(intelligenceQueueDepthBlock())), [])
  useEffect(() => subscribeTelemetryBlock(() => setTps(recentTokensPerSecondBlock(readTelemetryBlock()))), [])
  useEffect(() => {
    if (refreshWhen) void refreshEngineStateBlock().catch(() => undefined)
  }, [refreshWhen])

  return {
    engine,
    running: depth.inFlight,
    queued: depth.queued,
    supervised: isEngineSupervisedBlock(),
    recentTokensPerSecond: tps,
  }
}
