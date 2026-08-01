import { Button } from '@/components/lego_blocks/units/ui/button'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import type { AiTelemetryEvent } from '@/services/orchestrators/aiTelemetryOrch'

interface AiTelemetryPanelBlockProps {
  events: AiTelemetryEvent[]
  loading?: boolean
  onRefresh: () => void
  onClear: () => void
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatTokens(event: AiTelemetryEvent): string {
  const input = event.inputTokens ?? '-'
  const output = event.outputTokens ?? '-'
  const total = event.totalTokens ?? '-'
  return `in:${input} out:${output} total:${total}`
}

function summarizeChange(event: AiTelemetryEvent): string {
  const metadata = event.metadata ?? {}
  const action = typeof metadata.action === 'string' ? metadata.action : null
  const filePath = typeof metadata.filePath === 'string' ? metadata.filePath : null
  const reason = typeof metadata.reason === 'string' ? metadata.reason : null

  if (event.useCase.endsWith('.assist') && action) {
    return `Applied ${action} assist suggestion`
  }
  if (event.useCase === 'steward.metadata.proposal_generation' && filePath) {
    const label = filePath.split('/').pop() || filePath
    return `Generated metadata proposal for ${label}`
  }
  if (reason) return reason
  if (event.status === 'error' && event.errorMessage) return event.errorMessage
  return 'Assistant response generated'
}

export default function AiTelemetryPanelBlock({
  events,
  loading = false,
  onRefresh,
  onClear,
}: AiTelemetryPanelBlockProps) {
  return (
    <SettingsGroupBlock
      heading="AI telemetry"
      description="Latest AI actions across chat, assist, and steward workflows."
    >
      <SettingsRowBlock
        label="Recorded events"
        description={`${events.length} event${events.length === 1 ? '' : 's'} kept on this device.`}
        control={(
          <>
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={onClear} disabled={events.length === 0 || loading}>
              Clear
            </Button>
          </>
        )}
      />
      {events.length === 0 ? (
        <SettingsRowBlock label="No telemetry events yet." />
      ) : (
        <SettingsRowBlock stacked>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/70 text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Use Case</th>
                  <th className="py-2 pr-3 font-medium">Provider / Model</th>
                  <th className="py-2 pr-3 font-medium">What Changed</th>
                  <th className="py-2 pr-3 font-medium">Tokens</th>
                  <th className="py-2 pr-3 font-medium">Latency</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map(event => (
                  <tr key={event.id} className="border-b border-border/40 align-top">
                    <td className="py-2 pr-3 text-muted-foreground">{formatTimestamp(event.requestedAt)}</td>
                    <td className="py-2 pr-3">{event.useCase}</td>
                    <td className="py-2 pr-3">
                      {event.provider}
                      <div className="text-muted-foreground">{event.model}</div>
                    </td>
                    <td className="max-w-[28ch] py-2 pr-3 text-muted-foreground">{summarizeChange(event)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatTokens(event)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{event.latencyMs ?? '-'} ms</td>
                    <td className="py-2">
                      <span className={event.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                        {event.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsRowBlock>
      )}
    </SettingsGroupBlock>
  )
}
