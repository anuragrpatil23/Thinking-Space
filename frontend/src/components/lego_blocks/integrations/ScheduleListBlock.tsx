// Compact sidebar list of schedules. Each row is a Link to that schedule's
// edit page. The "active" row is highlighted by matching the current URL.

import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Plus, RefreshCw, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { cn } from '@/lib/utils'
import {
  listSchedulesWithStatusOrch,
  listExternalLaunchdAgentsOrch,
  type ScheduleWithStatusBlock,
  type ExternalLaunchdAgentBlock,
} from '@/services/orchestrators/schedulesOrch'
import type {
  ScheduleTriggerSpecBlock,
} from '@/services/lego_blocks/integrations/schedulesBlock'

function pad2(n: number): string { return String(n).padStart(2, '0') }
function summarizeSchedule(trigger: ScheduleTriggerSpecBlock): string {
  if (trigger.kind === 'interval') {
    const s = trigger.seconds
    if (s >= 3600 && s % 3600 === 0) return `Every ${s / 3600}h`
    if (s >= 60 && s % 60 === 0) return `Every ${s / 60}m`
    return `Every ${s}s`
  }
  if (trigger.kind === 'window') {
    const { start, stop } = trigger
    return `${pad2(start.hour)}:${pad2(start.minute)} – ${pad2(stop.hour)}:${pad2(stop.minute)}`
  }
  const times = trigger.entries.map((e) => `${pad2(e.hour)}:${pad2(e.minute)}`)
  // De-dup so calendars expanded across weekdays don't show "09:00 · 09:00 · ..."
  return Array.from(new Set(times)).join(' · ')
}

interface ScheduleListBlockProps {
  /** Called after any list-level refresh so parent can re-sync if it cares. */
  onRefresh?: () => void
}

export default function ScheduleListBlock({ onRefresh }: ScheduleListBlockProps) {
  const [rows, setRows] = useState<ScheduleWithStatusBlock[]>([])
  const [external, setExternal] = useState<ExternalLaunchdAgentBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [externalExpanded, setExternalExpanded] = useState(false)
  const { pathname } = useLocation()

  const refresh = useCallback(async () => {
    try {
      const [next, ext] = await Promise.all([
        listSchedulesWithStatusOrch(),
        listExternalLaunchdAgentsOrch(),
      ])
      setRows(next)
      setExternal(ext.filter((e) => e.managed === 'external'))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    } finally {
      setLoading(false)
      onRefresh?.()
    }
  }, [onRefresh])

  useEffect(() => {
    refresh()
    const handle = setInterval(refresh, 15000)
    return () => clearInterval(handle)
  }, [refresh])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Actions header */}
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2 pb-2">
        <Link
          to="/ai/schedules/new"
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          New schedule
        </Link>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="Refresh" disabled={loading}>
          {loading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {error && (
          <div className="mx-1 mb-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        {!loading && rows.length === 0 && !error && (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No schedules yet.
          </div>
        )}
        <div className="space-y-0.5">
          {rows.map(({ spec, status }) => {
            const to = `/ai/schedules/${spec.key}`
            const isActive = pathname === to
            const enabled = spec.enabled
            const pill = !enabled
              ? { text: 'Off', cls: 'bg-muted text-muted-foreground' }
              : status.loaded
                ? { text: '●', cls: 'bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300' }
                : { text: '!', cls: 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300' }
            return (
              <Link
                key={spec.key}
                to={to}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 text-xs',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent/60',
                )}
                title={spec.description ?? spec.title}
              >
                <span className={cn('inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold', pill.cls)}>
                  {pill.text}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{spec.title}</span>
                  <span className={cn(
                    'block truncate text-[10px]',
                    isActive ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}>
                    {summarizeSchedule(spec.schedule)}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>

        {external.length > 0 && (
          <div className="mt-4 px-1">
            <button
              type="button"
              onClick={() => setExternalExpanded((v) => !v)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/60"
              aria-expanded={externalExpanded}
            >
              {externalExpanded
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
              <span>External agents</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-normal normal-case tracking-normal text-muted-foreground">
                {external.length}
              </span>
            </button>
            {externalExpanded && (
              <div className="mt-1">
                {external.map((agent) => (
                  <div
                    key={agent.label}
                    className="truncate rounded px-2 py-1 font-mono text-[10px] text-muted-foreground"
                    title={agent.label}
                  >
                    {agent.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
