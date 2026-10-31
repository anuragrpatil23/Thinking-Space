// The AI section's status card in the ⋯ menu — the engine's answer to "is it
// OK?" without opening anything. Same shape as the Sync and Git cards above it.

import { cn } from '@/lib/utils'
import type { AiEngineStatusBlock } from '@/components/lego_blocks/hooks/shared/useAiEngineStatusBlock'
import {
  describeEngineSpeedBlock,
  describeEngineStateBlock,
  ENGINE_DOT_CLASS,
} from '@/services/lego_blocks/units/intelligence/engineStatusBlock'

export default function AiEngineStatusCardBlock({ status }: { status: AiEngineStatusBlock }) {
  const { engine, running, queued, recentTokensPerSecond } = status
  const view = describeEngineStateBlock(engine)
  const failure = engine.lastFailure
  const speed = describeEngineSpeedBlock(engine.speed, recentTokensPerSecond)
  return (
    <div className="space-y-1 rounded-md bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span>Engine:</span>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ENGINE_DOT_CLASS[view.tone])} />
        <span className="text-foreground">{view.label}</span>
      </div>
      {view.detail && <div className="truncate">{view.detail}</div>}
      {engine.model && <div className="truncate">{engine.model}</div>}
      <div className="tabular-nums">
        Running <span className="text-foreground">{running}</span> · Queued <span className="text-foreground">{queued}</span>
      </div>
      {speed && <div className="truncate">Speed: <span className="text-foreground">{speed}</span></div>}
      {failure && (
        <div className="truncate">
          Last failure: <span className="text-foreground">
            {failure.at ? `${new Date(failure.at).toLocaleTimeString()} · ` : ''}{failure.reason ?? 'unknown'}
          </span>
        </div>
      )}
    </div>
  )
}
