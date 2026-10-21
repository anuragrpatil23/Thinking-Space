// The "This session: N created · M edited" strip over the explorer tree. With
// several agents writing at once it becomes a scope picker: the strip shows
// the chosen scope (all recent sessions, or one), and the chevron opens an
// inline list of sessions to choose from. Clicking the strip itself toggles
// the "only touched files" filter, as before.

import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  SessionTelemetry,
  SessionTelemetrySession,
  SessionTelemetryView,
} from '@/services/orchestrators/sessionTelemetryOrch'

export interface SessionTelemetryStripBlockProps {
  telemetry: SessionTelemetry
  /** The session the explorer is scoped to; null = all recent sessions. */
  selected: SessionTelemetrySession | null
  filterOn: boolean
  listOpen: boolean
  onToggleFilter: () => void
  onToggleList: () => void
  onSelectSession: (sessionKey: string | null) => void
  /** Where the work happened: "sfresearch" or "sfresearch +1" (null = no
   *  project folder matched; the line falls back to "This session"). */
  projectLabel?: string | null
  /** Full breakdown for the tooltip, e.g. "sfresearch (8), sfai (1)". */
  projectDetail?: string | null
}

function formatAgo(ms: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

function Counts({ view, compact = false }: { view: SessionTelemetryView; compact?: boolean }) {
  if (!compact) {
    return (
      <span className="shrink-0 tabular-nums">
        {view.createdCount} created · {view.editedCount} edited
      </span>
    )
  }
  // Same green/amber as the tree dots, so the list reads without words.
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 tabular-nums"
      title={`${view.createdCount} created · ${view.editedCount} edited`}
    >
      <span className="flex items-center gap-0.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {view.createdCount}
      </span>
      <span className="flex items-center gap-0.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {view.editedCount}
      </span>
    </span>
  )
}

export default function SessionTelemetryStripBlock({
  telemetry,
  selected,
  filterOn,
  listOpen,
  onToggleFilter,
  onToggleList,
  onSelectSession,
  projectLabel = null,
  projectDetail = null,
}: SessionTelemetryStripBlockProps) {
  const { sessions } = telemetry
  const multiple = sessions.length > 1
  const view = selected ?? telemetry.all
  const baseLabel = selected
    ? (multiple ? selected.topic || 'Untitled session' : 'This session')
    : multiple ? `All ${sessions.length} sessions` : 'This session'
  /* With one session in view, its project is the more useful name. With a
     chooser of several, the session names stay — they are how you pick. */
  const label = projectLabel && (!multiple || selected) && baseLabel === 'This session'
    ? projectLabel
    : baseLabel
  const scopeTitle = selected
    ? `AI session: ${selected.topic}`
    : sessions.map(s => `• ${s.topic}`).join('\n')
  const nowMs = Date.now()

  return (
    <div className="mt-2">
      <div
        className={cn(
          /* A quiet status line, not a boxed control: it is read at a
             glance far more often than it is clicked. */
          'ltm-explorer-session-strip flex w-full items-center rounded-md text-[12px] transition-colors',
          /* Selected: a soft tinted chip the exact size of the line, so the
             tree being filtered is obvious and nothing shifts. */
          filterOn ? 'bg-emerald-500/10 text-foreground' : 'text-muted-foreground',
        )}
      >
        <button
          type="button"
          onClick={onToggleFilter}
          title={`${scopeTitle}${projectDetail ? `\nProjects: ${projectDetail}` : ''}\nClick to ${filterOn ? 'show all files again' : 'show only the files touched'}`}
          className={cn(
            /* Focus ring for the keyboard only; a click left a ring around the
               whole line. */
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filterOn ? 'hover:bg-emerald-500/10' : 'hover:bg-muted/50',
          )}
        >
          {filterOn
            ? <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
            : <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
          <span className="min-w-0 truncate">{label}:</span>
          <Counts view={view} />
          {filterOn && (
            <span className="ml-auto shrink-0 pl-2 font-medium text-emerald-700 dark:text-emerald-400">Show all</span>
          )}
        </button>
        {multiple && (
          <button
            type="button"
            onClick={onToggleList}
            aria-expanded={listOpen}
            aria-label="Choose AI session"
            title="Choose which AI session to show"
            className="flex shrink-0 items-center self-stretch rounded-md px-1.5 hover:bg-muted/50"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', listOpen && 'rotate-180')} />
          </button>
        )}
      </div>

      {multiple && listOpen && (
        <div role="listbox" className="mt-1 overflow-hidden rounded-md border border-border/60 bg-background text-[11px]">
          {[null, ...sessions].map(session => {
            const isSelected = session ? selected?.sessionKey === session.sessionKey : selected === null
            const rowView = session ?? telemetry.all
            return (
              <button
                key={session?.sessionKey ?? '__all__'}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectSession(session?.sessionKey ?? null)}
                title={session ? session.topic : 'Every AI session from the last 12 hours'}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:bg-muted/60',
                  isSelected && 'bg-muted/70 text-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {session ? (session.topic || 'Untitled session') : 'All sessions'}
                </span>
                {session && (
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">
                    {formatAgo(session.endedMs, nowMs)}
                  </span>
                )}
                <Counts view={rowView} compact />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
