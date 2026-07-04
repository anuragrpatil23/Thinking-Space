// Diagnostics panel for the intelligence subsystem. Read-only surface that
// shows provider status, model capability probes, and a live tail of the
// last N intelligence requests (title generations, tool loops, etc.). Also
// lets the user switch the default provider and clear the on-disk cache.
//
// Not an orchestrator — it doesn't compose services, it just reflects state
// from the orchestrator/telemetry unit.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { availability, diagnose, type DiagnosticsSnapshot } from '@/services/orchestrators/intelligenceOrch'
import {
  readDefaultProviderBlock,
  writeDefaultProviderBlock,
} from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import {
  readTelemetryBlock,
  subscribeTelemetryBlock,
  clearTelemetryBlock,
  type TelemetryEntry,
} from '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'
import { clearIntelligenceCacheBlock } from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  'openai-compat': 'Local (OpenAI-compatible)',
  'anthropic': 'Claude (Anthropic API)',
  'claude-cli': 'Claude Code CLI (Pro sub)',
}

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

export default function IntelligenceDiagnosticsBlock() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>(readDefaultProviderBlock())
  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>(() => readTelemetryBlock(20))
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true)
    try {
      if (force) {
        // Force each provider's cached availability to invalidate. Cheapest
        // way: call availability(force=true) on each via the orchestrator by
        // going through diagnose which iterates providers.
        await Promise.all(snapshot?.providers.map(p => availability(p.id).catch(() => null)) ?? [])
      }
      const snap = await diagnose()
      setSnapshot(snap)
    } finally {
      setRefreshing(false)
    }
  }, [snapshot])

  useEffect(() => {
    void refresh(false)
    const off = subscribeTelemetryBlock(() => setTelemetry(readTelemetryBlock(20)))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSwitchDefault = (id: ProviderId) => {
    writeDefaultProviderBlock(id)
    setDefaultProvider(id)
  }

  const onClearCache = async () => {
    await clearIntelligenceCacheBlock()
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Default Provider
        </div>
        <div className="flex flex-wrap gap-2">
          {(['openai-compat', 'anthropic', 'claude-cli'] as ProviderId[]).map(id => (
            <Button
              key={id}
              size="sm"
              variant={defaultProvider === id ? 'default' : 'outline'}
              onClick={() => onSwitchDefault(id)}
            >
              {PROVIDER_LABELS[id]}
            </Button>
          ))}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Every intelligence task (session titles, structured extracts, tool loops) runs on the selected provider.
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Provider Status</div>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={() => { void refresh(true) }}>
            {refreshing ? 'Probing…' : 'Refresh'}
          </Button>
        </div>
        <div className="grid gap-2">
          {snapshot?.providers.map(p => (
            <div key={p.id} className="rounded-md border border-border/50 p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{PROVIDER_LABELS[p.id]}</div>
                <div
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    p.available ? 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-500' : 'bg-red-500/10 dark:bg-red-500/20 text-red-500'
                  }`}
                >
                  {p.available ? 'ready' : p.configured ? 'unreachable' : 'not configured'}
                </div>
              </div>
              {p.defaultModel && (
                <div className="mt-1 text-xs text-muted-foreground">Default model: <code>{p.defaultModel}</code></div>
              )}
              {p.reason && !p.available && (
                <div className="mt-1 text-xs text-red-500">{p.reason}</div>
              )}
              {Object.keys(p.details).length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Detected capabilities</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
{JSON.stringify(p.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Recent Requests</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { clearTelemetryBlock(); setTelemetry([]) }}>
              Clear log
            </Button>
            <Button size="sm" variant="outline" onClick={() => { void onClearCache() }}>
              Purge cache
            </Button>
          </div>
        </div>
        {telemetry.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
            No intelligence requests yet. Session titles and other tasks will appear here as they run.
          </div>
        ) : (
          <div className="space-y-1">
            {telemetry.map(entry => (
              <div key={entry.id} className="rounded-md border border-border/40 px-3 py-2 text-xs">
                <button
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusPill(entry.status)}`}>
                      {entry.status}
                    </span>
                    <span className="font-medium">{entry.taskId}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{entry.model || entry.providerId}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {entry.usage && (
                      <span>
                        {entry.usage.promptTokens}→{entry.usage.completionTokens} tok
                      </span>
                    )}
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
      </div>
    </div>
  )
}
