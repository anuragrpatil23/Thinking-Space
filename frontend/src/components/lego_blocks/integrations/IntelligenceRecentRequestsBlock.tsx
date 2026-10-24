// The last background AI tasks (titles, digests, article points, story
// cards...): what ran, on which model, thinking on or off, tokens and time.
// Five at first, all twenty on request; a row opens to its error or preview.

import { useEffect, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  clearTelemetryBlock,
  readTelemetryBlock,
  subscribeTelemetryBlock,
  type TelemetryEntry,
} from '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'
import { clearIntelligenceCacheBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import { cn } from '@/lib/utils'

const FOLDED_ROWS = 5

function formatLatency(ms: number): string {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusPill(status: TelemetryEntry['status']): string {
  if (status === 'ok') return 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-500'
  if (status === 'cache-hit') return 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-500'
  return 'bg-red-500/10 dark:bg-red-500/20 text-red-500'
}

export default function IntelligenceRecentRequestsBlock() {
  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>(() => readTelemetryBlock(20))
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [purged, setPurged] = useState(false)

  useEffect(() => subscribeTelemetryBlock(() => setTelemetry(readTelemetryBlock(20))), [])

  const shown = showAll ? telemetry : telemetry.slice(0, FOLDED_ROWS)
  return (
    <div className="space-y-2">
      {telemetry.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
          No background tasks yet. Session titles, digests and the Feed&apos;s AI reader appear here as they run.
        </div>
      ) : (
        <div className="space-y-1">
          {shown.map(entry => (
            <div key={entry.id} className="rounded-md border border-border/40 px-3 py-2 text-xs">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', statusPill(entry.status))}>{entry.status}</span>
                  <span className="font-medium">{entry.taskId}</span>
                  <span className="truncate text-muted-foreground">· {entry.model || entry.providerId}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  {entry.reasoning && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px]',
                        entry.reasoning === 'on' ? 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-500' : 'bg-muted text-muted-foreground',
                      )}
                      title={entry.reasoning === 'on' ? 'Hidden reasoning ran: it shares this request’s token budget' : 'Hidden reasoning off: a single-shot answer'}
                    >
                      thinking {entry.reasoning}
                    </span>
                  )}
                  {entry.usage && <span>{entry.usage.promptTokens}→{entry.usage.completionTokens} tok</span>}
                  <span>{formatLatency(entry.latencyMs)}</span>
                  <span>{new Date(entry.ts).toLocaleTimeString()}</span>
                </div>
              </button>
              {expandedId === entry.id && (
                <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                  {entry.error && (
                    <div className="text-red-500">
                      <span className="font-mono text-[10px] uppercase">{entry.error.kind}</span>
                      <span> · {entry.error.message}</span>
                    </div>
                  )}
                  {entry.responsePreview && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Response preview</div>
                      <pre className="whitespace-pre-wrap text-[10px]">{entry.responsePreview}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {telemetry.length > FOLDED_ROWS && (
          <Button size="sm" variant="outline" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show fewer' : `Show all ${telemetry.length}`}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => { clearTelemetryBlock(); setTelemetry([]) }} disabled={telemetry.length === 0}>
          Clear log
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="Forget saved answers, so the next run of each task asks the model again"
          onClick={() => { void clearIntelligenceCacheBlock().then(() => setPurged(true)) }}
        >
          {purged ? 'Cache purged' : 'Purge cache'}
        </Button>
      </div>
    </div>
  )
}
